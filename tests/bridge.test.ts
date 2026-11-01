import { test } from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "@bv/host-bridge";
import {
	editable,
	launchOptions,
	type Task,
	type SummaryContent,
} from "@bv/contracts";
const task: Task = {
	...editable.parse({ title: "Source" }),
	id: "same-1",
	workspaceId: "workspaceA",
	repositoryId: "repoA",
	databaseId: "databaseA",
	project: "Unspecified",
	revision: "a".repeat(64),
	created_at: "",
	updated_at: "",
	ready: true,
	blocked: false,
	dependencies: [],
	dependents: [],
	comments: [],
	raw: { title: "Source" },
};
export const summary: SummaryContent = {
	schemaVersion: 1,
	promptVersion: "briefing-1",
	blocks: (
		[
			"overview",
			"state",
			"checklist",
			"blockers",
			"decisions",
			"suggestions",
			"questions",
		] as const
	).map((kind) => ({
		id: kind,
		kind,
		title: kind,
		text:
			kind === "overview"
				? "Source briefing"
				: "No additional source facts supplied.",
		sources: [{ kind: "field", id: "title" }],
	})),
	omissions: [],
};
test("relay isolates A/B, rejects invalid references and stale/cancelled results, and bounds waits", async () => {
	const saved: unknown[] = [];
	let revision = task.revision;
	const bridge = new Bridge(
		(s) => saved.push(s),
		async () => revision,
	);
	try {
		const a = bridge.open("session-AAAA", launchOptions.parse({})),
			b = bridge.open("session-BBBB", launchOptions.parse({}));
		const request = bridge.enqueue(a.connection.id, task);
		assert.equal(await bridge.next(b.connection.id, b.relayKey, 0), null);
		await assert.rejects(
			bridge.next(a.connection.id, b.relayKey, 0),
			/binding/,
		);
		const received = await bridge.next(a.connection.id, a.relayKey, 0);
		assert.equal(received?.id, request.id);
		await assert.rejects(
			bridge.complete(
				b.connection.id,
				b.relayKey,
				request.id,
				task.revision,
				summary,
			),
			/different launch/,
		);
		await assert.rejects(
			bridge.complete(a.connection.id, a.relayKey, request.id, task.revision, {
				...summary,
				blocks: summary.blocks.map((x) => ({
					...x,
					sources: [{ kind: "field", id: "invented" }],
				})),
			}),
			/Unknown source/,
		);
		const result = await bridge.complete(
			a.connection.id,
			a.relayKey,
			request.id,
			task.revision,
			summary,
		);
		assert.equal(result.sessionId, "session-AAAA");
		assert.equal(saved.length, 1);
		const stale = bridge.enqueue(a.connection.id, task);
		await bridge.next(a.connection.id, a.relayKey, 0);
		revision = "b".repeat(64);
		await assert.rejects(
			bridge.complete(
				a.connection.id,
				a.relayKey,
				stale.id,
				task.revision,
				summary,
			),
			/Source changed/,
		);
		assert.equal(saved.length, 1);
		revision = task.revision;
		const cancelled = bridge.enqueue(a.connection.id, task);
		await bridge.next(a.connection.id, a.relayKey, 0);
		bridge.cancel(a.connection.id, cancelled.id);
		await assert.rejects(
			bridge.complete(
				a.connection.id,
				a.relayKey,
				cancelled.id,
				task.revision,
				summary,
			),
			/no longer running/,
		);
		const controller = new AbortController(),
			wait = bridge.next(a.connection.id, a.relayKey, 10000, controller.signal);
		controller.abort();
		await assert.rejects(wait, /cancelled/);
		assert.equal(bridge.state(a.connection.id).state, "disconnected");
		assert.equal(bridge.state(b.connection.id).state, "connected");
		const before = Date.now();
		assert.equal(await bridge.next(b.connection.id, b.relayKey, 25), null);
		assert.ok(Date.now() - before < 500);
	} finally {
		bridge.close();
	}
});
test("idle and lifetime expiry fail active jobs without affecting other connections", () => {
	const bridge = new Bridge(
		() => {},
		async () => task.revision,
	);
	try {
		const a = bridge.open("session-AAAA", launchOptions.parse({}));
		const j = bridge.enqueue(a.connection.id, task);
		const original = Date.now;
		try {
			Date.now = () => original() + 31 * 60000;
			assert.equal(bridge.state(a.connection.id).state, "expired");
			assert.equal(j.state, "failed");
		} finally {
			Date.now = original;
		}
	} finally {
		bridge.close();
	}
});
