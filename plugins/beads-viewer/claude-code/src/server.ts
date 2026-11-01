import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { launchOptions, summaryContent, type AIRequest } from "@bv/contracts";
import { secret, equal, allowedSources } from "@bv/host-bridge";
import type { Application } from "../../../../apps/server/src/app.ts";
import { briefingInstructions } from "./briefing.ts";
import { briefingRequestMessage } from "./inbox.ts";
import identity from "../.claude-plugin/plugin.json" with { type: "json" };
interface ViewerRuntime {
	app: Application;
	close(): Promise<void>;
}
export function createViewerServer(dependencies: {
	startRuntime(): Promise<ViewerRuntime>;
	openBrowser(url: string): Promise<string | null>;
	/** Posts into the invoking conversation (its session inbox), when available. */
	postToConversation?: ((text: string) => Promise<void>) | null;
}) {
	const mcp = new McpServer(
		{ name: identity.name, version: identity.version },
		{
			capabilities: { experimental: { "claude/channel": {} } },
			instructions: briefingInstructions,
		},
	);
	const { startRuntime, openBrowser } = dependencies;
	const postToConversation = dependencies.postToConversation ?? null;
	const probes = new Map<string, string>();
	let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
	let startup: ReturnType<typeof startRuntime> | undefined;
	async function ensureRuntime() {
		if (runtime) return runtime;
		startup ??= startRuntime();
		try {
			const active = await startup;
			if (!runtime) {
				runtime = active;
				runtime.app.version = identity.version;
				runtime.app.bridge.on("request", onRequest);
			}
			return runtime;
		} catch (error) {
			startup = undefined;
			throw error;
		}
	}
	const bindings = new Map<string, string>();
	const bound = (connectionId: string, relayKey: string) => {
		if (bindings.get(connectionId) !== relayKey)
			throw new Error("This MCP process does not own that launch connection");
		if (!runtime) throw new Error("Viewer is not connected");
		return runtime.app;
	};
	const response = (value: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
	});
	const credentials = {
		connectionId: z.string().uuid(),
		relayKey: z.string().min(40).max(100),
	};
	// Generated IDs only: task text, browser content and private relay keys are
	// never sent to Claude through a channel event or the session inbox.
	function onRequest(request: AIRequest) {
		if (!runtime) return;
		const app = runtime.app;
		const connection = app.bridge.state(request.connectionId);
		if (connection.delivery === "channel")
			void mcp.server
				.notification({
					method: "notifications/claude/channel",
					params: {
						content:
							"Generate one requested Beads Viewer briefing: claim_request using this event's IDs, complete_request or fail_request, then return control. Never poll.",
						meta: {
							kind: "brief",
							connection_id: request.connectionId,
							request_id: request.id,
							session_id: connection.sessionId,
						},
					},
				})
				.then(
					() => app.bridge.notified(request.id, "channel"),
					() => app.bridge.deliveryFailed(request.id),
				);
		else if (connection.delivery === "inbox" && postToConversation)
			void postToConversation(
				briefingRequestMessage({
					connectionId: request.connectionId,
					requestId: request.id,
					sessionId: connection.sessionId,
				}),
			).then(
				() => app.bridge.notified(request.id, "inbox"),
				() => app.bridge.deliveryFailed(request.id),
			);
	}
	// No allowed-tools frontmatter: the user's normal host permission policy applies to every tool.
	mcp.registerTool(
		"connect_open",
		{
			description:
				"Open Beads Viewer in the invoking session and return immediately. With no repositories, selects the directory Claude was started in when it is a Beads workspace. Do not poll or disconnect. Channel readiness is acknowledged separately.",
			inputSchema: {
				sessionId: z.string().min(8),
				options: launchOptions.default({}),
				pluginRoot: z
					.string()
					.max(4096)
					.optional()
					.describe(
						"The skill's substituted plugin directory, for a version check",
					),
			},
		},
		async ({ sessionId, options, pluginRoot }) => {
			const active = await ensureRuntime();
			// Claude starts plugin MCP servers in the session's project directory.
			const invoking = process.env.CLAUDE_PROJECT_DIR || process.cwd();
			const automatic = options.repositories.length === 0;
			const result = await active.app.open(
				sessionId,
				automatic ? { ...options, repositories: [invoking] } : options,
				postToConversation ? "inbox" : "manual",
			);
			const warnings: string[] = [];
			const automaticFailed = automatic && result.failures.length > 0;
			if (automaticFailed) {
				warnings.push(
					`The directory Claude was started in (${invoking}) is not a usable Beads workspace: ${result.failures[0].error}. ` +
						'The viewer opened with no repository. Re-run /beads-viewer:open {"repositories":["/path/to/repo"]} to choose one.',
				);
				result.failures = [];
			}
			const runningRoot = process.env.CLAUDE_PLUGIN_ROOT;
			if (
				pluginRoot &&
				runningRoot &&
				!pluginRoot.includes("${") &&
				resolve(pluginRoot) !== resolve(runningRoot)
			)
				warnings.push(
					`Mixed plugin versions: this conversation's /beads-viewer:open skill came from ${pluginRoot}, but the running viewer server came from ${runningRoot}. Restart Claude so it loads one consistent Beads Viewer version.`,
				);
			bindings.set(result.connection.id, result.relayKey);
			const nonce = secret();
			probes.set(result.connection.id, nonce);
			try {
				await mcp.server.notification({
					method: "notifications/claude/channel",
					params: {
						content:
							"Acknowledge Beads Viewer channel readiness with channel_ready, then return control. Do not poll.",
						meta: {
							kind: "ready",
							connection_id: result.connection.id,
							session_id: sessionId,
							nonce,
						},
					},
				});
			} catch {
				// Normal MCP clients and blocked channels retain the manual fallback.
			}
			const browserWarning = options.openBrowser
				? await openBrowser(result.url)
				: null;
			return response({
				...result,
				browserWarning,
				warnings,
				selectedRepositories: automatic
					? automaticFailed
						? []
						: [invoking]
					: options.repositories,
				viewer: { version: identity.version, pluginRoot: runningRoot ?? null },
			});
		},
	);
	mcp.registerTool(
		"register_repository",
		{
			description:
				"Register an explicitly user-selected repository for an owned launch. Never discover by scanning home.",
			inputSchema: {
				...credentials,
				path: z.string().min(1).max(4096),
				projectPrefix: z.string().min(1).max(100).default("project:"),
			},
		},
		async ({ connectionId, relayKey, path, projectPrefix }) =>
			response(
				await bound(connectionId, relayKey).register(
					connectionId,
					path,
					projectPrefix,
				),
			),
	);
	mcp.registerTool(
		"channel_ready",
		{
			description:
				"Acknowledge this plugin's channel probe from the invoking session. Never poll.",
			inputSchema: {
				connectionId: z.string().uuid(),
				sessionId: z.string().min(8),
				nonce: z.string().min(40).max(100),
			},
		},
		async ({ connectionId, sessionId, nonce }) => {
			const key = bindings.get(connectionId);
			const expected = probes.get(connectionId);
			if (!key || !expected || !equal(expected, nonce))
				throw new Error("Unknown or expired channel probe");
			const app = bound(connectionId, key);
			const state = app.bridge.channelReady(connectionId, key, sessionId);
			probes.delete(connectionId);
			return response({ connection: state });
		},
	);
	mcp.registerTool(
		"claim_request",
		{
			description:
				"Claim exactly one browser briefing in the session that opened the viewer; returns immediately. Never poll or guess request IDs.",
			inputSchema: {
				connectionId: z.string().uuid(),
				sessionId: z.string().min(8),
				requestId: z.string().uuid(),
			},
		},
		async ({ connectionId, sessionId, requestId }) => {
			const key = bindings.get(connectionId);
			if (!key)
				throw new Error("This MCP process does not own that launch connection");
			const app = bound(connectionId, key);
			const request = app.bridge.claim(connectionId, key, sessionId, requestId);
			return response({
				connectionId,
				relayKey: key,
				request,
				// Cite only these IDs; anything else is rejected by complete_request.
				allowedSources: allowedSources(request.source),
				deadline: new Date(request.deadline).toISOString(),
			});
		},
	);
	mcp.registerTool(
		"complete_request",
		{
			description:
				"Publish structured results generated by THIS main Claude turn; validates source hash, source links, session and launch binding.",
			inputSchema: {
				...credentials,
				requestId: z.string().uuid(),
				sourceHash: z.string().length(64),
				result: summaryContent,
			},
		},
		async ({ connectionId, relayKey, requestId, sourceHash, result }) =>
			response(
				await bound(connectionId, relayKey).bridge.complete(
					connectionId,
					relayKey,
					requestId,
					sourceHash,
					result,
				),
			),
	);
	mcp.registerTool(
		"fail_request",
		{
			description:
				"Report an owned job failure without fabricating a briefing.",
			inputSchema: {
				...credentials,
				requestId: z.string().uuid(),
				error: z.string().min(1).max(1000),
			},
		},
		async ({ connectionId, relayKey, requestId, error }) => {
			bound(connectionId, relayKey).bridge.fail(
				connectionId,
				relayKey,
				requestId,
				error,
			);
			return response({ failed: true });
		},
	);
	mcp.registerTool(
		"connection_state",
		{
			description: "Read state for this exact launch.",
			inputSchema: credentials,
		},
		async ({ connectionId, relayKey }) =>
			response(bound(connectionId, relayKey).bridge.state(connectionId)),
	);
	mcp.registerTool(
		"disconnect",
		{
			description:
				"Stop the relay for this launch; retain browser CRUD, summaries and annotations until MCP process exits.",
			inputSchema: credentials,
		},
		async ({ connectionId, relayKey }) => {
			bound(connectionId, relayKey).bridge.detach(connectionId, relayKey);
			return response({ disconnected: true });
		},
	);
	async function close() {
		try {
			const active = runtime || (startup ? await startup : undefined);
			if (active) await active.close();
		} catch {
			/* Startup failures are reported by connect_open. */
		}
		await mcp.close();
	}
	return { mcp, close };
}
