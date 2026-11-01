import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Store } from "@bv/annotations";
import { BeadsAdapter, runner } from "@bv/beads-adapter";
import { resolveBeads } from "@bv/prerequisites";
import { Application } from "../apps/server/src/app.ts";
import { createViewerServer } from "../plugins/beads-viewer/claude-code/src/server.ts";
import { task, summary } from "./ai-fixtures.ts";
import identity from "../plugins/beads-viewer/claude-code/.claude-plugin/plugin.json" with { type: "json" };

test("MCP opens without polling, acknowledges channels and completes exact requests with a manual fallback", async () => {
	const root = await mkdtemp(join(tmpdir(), "bv-channel-"));
	const environment = {
		project: process.env.CLAUDE_PROJECT_DIR,
		plugin: process.env.CLAUDE_PLUGIN_ROOT,
	};
	// The invoking directory here is a plain folder, not a Beads workspace.
	process.env.CLAUDE_PROJECT_DIR = root;
	process.env.CLAUDE_PLUGIN_ROOT = "/plugins/beads-viewer/claude-code-new";
	const app = new Application(
		new Store(join(root, "annotations.sqlite")),
		new BeadsAdapter(runner(await resolveBeads())),
		"dist/web",
	);
	// Transport/schema fixture only; this is not model inference or a real task read.
	app.beads.detail = async () => task;
	app.store.register({
		id: task.repositoryId,
		workspaceId: task.workspaceId,
		databaseId: task.databaseId,
		path: root,
		name: "Transport fixture",
		beadsPath: join(root, ".beads"),
		projectPrefix: "project:",
		health: "fixture",
	});
	let openedBrowsers = 0;
	const { mcp, close } = createViewerServer({
		startRuntime: async () => ({ app, close: async () => app.close() }),
		openBrowser: async () => {
			openedBrowsers++;
			return null;
		},
	});
	const client = new Client({ name: "channel-fixture", version: "1.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const events: { content: string; meta: Record<string, string> }[] = [];
	client.setNotificationHandler(
		z.object({
			method: z.literal("notifications/claude/channel"),
			params: z.object({ content: z.string(), meta: z.record(z.string()) }),
		}),
		({ params }) => {
			events.push(params);
		},
	);
	const call = (name: string, args: Record<string, unknown>) =>
		client.callTool({ name, arguments: args });
	const body = (result: Awaited<ReturnType<typeof call>>) => {
		assert.ok(Array.isArray(result.content));
		const block = result.content[0];
		assert.equal(block.type, "text");
		return JSON.parse(block.text as string);
	};
	try {
		await mcp.connect(serverTransport);
		await client.connect(clientTransport);
		assert.deepEqual(
			client.getServerCapabilities()?.experimental?.["claude/channel"],
			{},
		);
		assert.match(client.getInstructions()!, /Never poll/);
		assert.ok(
			!(await client.listTools()).tools.some(
				(tool) => tool.name === "next_request",
			),
		);
		const opened = body(
			await call("connect_open", {
				sessionId: "session-AAAA",
				pluginRoot: "/plugins/beads-viewer/claude-code-new",
			}),
		);
		assert.equal(openedBrowsers, 1);
		assert.equal(opened.viewer.version, identity.version);
		assert.equal(app.version, identity.version);
		assert.deepEqual(opened.selectedRepositories, []);
		assert.deepEqual(opened.failures, []);
		assert.equal(opened.warnings.length, 1);
		assert.match(opened.warnings[0], /not a usable Beads workspace/);
		assert.equal(
			opened.connection.delivery,
			"manual",
			"writing a probe is not an acknowledgement",
		);
		assert.equal(opened.connection.expiresAt, null);
		const probe = events.find(
			(e) => e.meta.connection_id === opened.connection.id,
		)!;
		assert.equal(probe.meta.kind, "ready");
		assert.equal(
			(
				await call("channel_ready", {
					connectionId: opened.connection.id,
					sessionId: "session-BBBB",
					nonce: probe.meta.nonce,
				})
			).isError,
			true,
		);
		assert.equal(
			(
				await call("channel_ready", {
					connectionId: opened.connection.id,
					sessionId: "session-AAAA",
					nonce: "x".repeat(43),
				})
			).isError,
			true,
		);
		await call("channel_ready", {
			connectionId: opened.connection.id,
			sessionId: "session-AAAA",
			nonce: probe.meta.nonce,
		});
		assert.equal(app.bridge.state(opened.connection.id).delivery, "channel");
		const queued = app.bridge.enqueue(opened.connection.id, task);
		await new Promise((resolve) => setImmediate(resolve));
		const event = events.find((e) => e.meta.request_id === queued.id)!;
		assert.equal(event.meta.kind, "brief");
		assert.ok(!JSON.stringify(event).includes(opened.relayKey));
		assert.ok(!JSON.stringify(event).includes(task.title));
		assert.equal(
			queued.state,
			"queued",
			"a notification alone does not claim or generate",
		);
		assert.equal(
			(
				await call("claim_request", {
					connectionId: opened.connection.id,
					sessionId: "session-BBBB",
					requestId: queued.id,
				})
			).isError,
			true,
		);
		const claimed = body(
			await call("claim_request", {
				connectionId: opened.connection.id,
				sessionId: "session-AAAA",
				requestId: queued.id,
			}),
		);
		assert.equal(claimed.request.state, "running");
		assert.ok(claimed.allowedSources.fields.includes("project"));
		assert.ok(claimed.allowedSources.fields.includes("title"));
		assert.ok(!claimed.allowedSources.fields.includes("raw"));
		assert.ok(Date.parse(claimed.deadline) > Date.now() + 10 * 60000);
		assert.equal(
			(
				await call("claim_request", {
					connectionId: opened.connection.id,
					sessionId: "session-AAAA",
					requestId: queued.id,
				})
			).isError,
			true,
		);
		const completed = await call("complete_request", {
			connectionId: opened.connection.id,
			relayKey: claimed.relayKey,
			requestId: queued.id,
			sourceHash: task.revision,
			result: summary,
		});
		assert.ok(!completed.isError, JSON.stringify(completed.content));
		assert.equal(app.store.summaries(task.workspaceId, task.id).length, 1);

		// A second viewer never acknowledges channel delivery. Its ordinary manual
		// claim still works; it cannot claim the first viewer's jobs.
		const manual = body(
			await call("connect_open", {
				sessionId: "session-BBBB",
				options: { openBrowser: false },
				pluginRoot: "/plugins/beads-viewer/claude-code-old",
			}),
		);
		assert.ok(
			manual.warnings.some((w: string) => /Mixed plugin versions/.test(w)),
			"a skill/server version mismatch is reported",
		);
		assert.equal(
			(
				await call("claim_request", {
					connectionId: manual.connection.id,
					sessionId: "session-BBBB",
					requestId: queued.id,
				})
			).isError,
			true,
		);
		const send = serverTransport.send.bind(serverTransport);
		serverTransport.send = async (message, options) => {
			if (
				"method" in message &&
				message.method === "notifications/claude/channel"
			)
				throw new Error("Simulated channel transport failure");
			return send(message, options);
		};
		// A channel connection whose event cannot be written falls back to the command.
		const undelivered = app.bridge.enqueue(opened.connection.id, {
			...task,
			revision: "c".repeat(64),
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.match(undelivered.deliveryError!, /briefing command/);
		// A manual connection sends nothing; the browser shows the command at once.
		const manualJob = app.bridge.enqueue(manual.connection.id, task);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(manualJob.notifiedAt, undefined);
		assert.equal(manualJob.deliveryError, undefined);
		const manualClaim = body(
			await call("claim_request", {
				connectionId: manual.connection.id,
				sessionId: "session-BBBB",
				requestId: manualJob.id,
			}),
		);
		assert.equal(manualClaim.request.id, manualJob.id);
		await call("complete_request", {
			connectionId: manual.connection.id,
			relayKey: manualClaim.relayKey,
			requestId: manualJob.id,
			sourceHash: task.revision,
			result: summary,
		});
		assert.equal(app.bridge.state(manual.connection.id).delivery, "manual");
		assert.equal(app.bridge.state(opened.connection.id).state, "connected");
		assert.equal(app.store.summaries(task.workspaceId, task.id).length, 2);
	} finally {
		await client.close();
		await close();
		await rm(root, { recursive: true, force: true });
		for (const [name, value] of [
			["CLAUDE_PROJECT_DIR", environment.project],
			["CLAUDE_PLUGIN_ROOT", environment.plugin],
		] as const)
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
	}
});

test("without Channels, requests are posted into the invoking conversation's inbox", async () => {
	const root = await mkdtemp(join(tmpdir(), "bv-inbox-mcp-"));
	const app = new Application(
		new Store(join(root, "annotations.sqlite")),
		new BeadsAdapter(runner(await resolveBeads())),
		"dist/web",
	);
	app.beads.detail = async () => task;
	app.store.register({
		id: task.repositoryId,
		workspaceId: task.workspaceId,
		databaseId: task.databaseId,
		path: root,
		name: "Inbox fixture",
		beadsPath: join(root, ".beads"),
		projectPrefix: "project:",
		health: "fixture",
	});
	const posted: string[] = [];
	let failNext = false;
	const { mcp, close } = createViewerServer({
		startRuntime: async () => ({ app, close: async () => app.close() }),
		openBrowser: async () => null,
		postToConversation: async (text) => {
			if (failNext) throw new Error("inbox unavailable");
			posted.push(text);
		},
	});
	const client = new Client({ name: "inbox-fixture", version: "1.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	try {
		await mcp.connect(serverTransport);
		await client.connect(clientTransport);
		const result = await client.callTool({
			name: "connect_open",
			arguments: { sessionId: "session-INBOX", options: { openBrowser: false } },
		});
		const opened = JSON.parse(
			(result.content as { type: string; text: string }[])[0].text,
		);
		assert.equal(opened.connection.delivery, "inbox");
		const job = app.bridge.enqueue(opened.connection.id, task);
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(posted.length, 1);
		assert.ok(posted[0].includes(job.id));
		assert.ok(posted[0].includes(opened.connection.id));
		assert.ok(posted[0].includes("session-INBOX"));
		assert.ok(!posted[0].includes(opened.relayKey), "no private key");
		assert.ok(!posted[0].includes(task.title), "no task text");
		assert.equal(job.notifiedVia, "inbox");
		assert.ok(job.notifiedAt);
		app.bridge.cancel(opened.connection.id, job.id);
		failNext = true;
		const second = app.bridge.enqueue(opened.connection.id, {
			...task,
			revision: "b".repeat(64),
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.match(second.deliveryError!, /briefing command/);
		assert.equal(second.state, "queued", "the manual command still works");
	} finally {
		await client.close();
		await close();
		await rm(root, { recursive: true, force: true });
	}
});
