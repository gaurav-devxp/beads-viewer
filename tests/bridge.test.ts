import { test } from "node:test";
import assert from "node:assert/strict";
import {
	Bridge,
	allowedSources,
	RUNNING_DEADLINE_MS,
	QUEUED_DEADLINE_MS,
} from "@bv/host-bridge";
import { launchOptions } from "@bv/contracts";
import { task, summary } from "./ai-fixtures.ts";

test("a parked viewer stays usable without host polling; one event is emitted per new request", (t) => {
	let now = Date.now();
	t.mock.method(Date, "now", () => now);
	const bridge = new Bridge(
		() => {},
		async () => task.revision,
	);
	try {
		const opened = bridge.open(
			"session-AAAA",
			launchOptions.parse({ idleSeconds: 30 }),
		);
		const emitted: string[] = [];
		bridge.on("request", (j) => emitted.push(j.id));
		now += 31 * 60000;
		assert.equal(bridge.state(opened.connection.id).state, "connected");
		assert.equal(bridge.state(opened.connection.id).expiresAt, null);
		const j = bridge.enqueue(opened.connection.id, task);
		assert.equal(bridge.enqueue(opened.connection.id, task).id, j.id);
		assert.deepEqual(emitted, [j.id]);
		assert.throws(
			() =>
				bridge.claim(
					opened.connection.id,
					opened.relayKey,
					"session-BBBB",
					j.id,
				),
			/different Claude session/,
		);
		assert.equal(j.state, "queued");
		bridge.deliveryFailed(j.id);
		assert.match(j.deliveryError!, /briefing command/);
		bridge.claim(opened.connection.id, opened.relayKey, "session-AAAA", j.id);
		assert.throws(
			() =>
				bridge.claim(
					opened.connection.id,
					opened.relayKey,
					"session-AAAA",
					j.id,
				),
			/no longer queued/,
		);
		// Real generation took over three minutes; it must not expire that early.
		now += 5 * 60000;
		bridge.sweep();
		assert.equal(j.state, "running");
		now += RUNNING_DEADLINE_MS;
		bridge.sweep();
		assert.equal(j.state, "failed");
		assert.equal(bridge.state(opened.connection.id).state, "connected");
		const retry = bridge.enqueue(opened.connection.id, task);
		bridge.cancel(opened.connection.id, retry.id);
		assert.throws(
			() =>
				bridge.claim(
					opened.connection.id,
					opened.relayKey,
					"session-AAAA",
					retry.id,
				),
			/no longer queued/,
		);
	} finally {
		bridge.close();
	}
});

test("on-demand requests isolate sessions and reject invalid references, stale results and cancelled requests", async () => {
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
		assert.throws(
			() =>
				bridge.claim(b.connection.id, b.relayKey, "session-BBBB", request.id),
			/different launch/,
		);
		assert.throws(
			() =>
				bridge.claim(a.connection.id, b.relayKey, "session-AAAA", request.id),
			/binding/,
		);
		const received = bridge.claim(
			a.connection.id,
			a.relayKey,
			"session-AAAA",
			request.id,
		);
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
		bridge.claim(a.connection.id, a.relayKey, "session-AAAA", stale.id);
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
		bridge.claim(a.connection.id, a.relayKey, "session-AAAA", cancelled.id);
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
		bridge.detach(a.connection.id, a.relayKey);
		assert.equal(bridge.state(a.connection.id).state, "disconnected");
		assert.equal(bridge.state(b.connection.id).state, "connected");
	} finally {
		bridge.close();
	}
});
test("an explicitly requested connection lifetime expires and fails its pending job", () => {
	const bridge = new Bridge(
		() => {},
		async () => task.revision,
	);
	try {
		const a = bridge.open(
			"session-AAAA",
			launchOptions.parse({ lifetimeSeconds: 60 }),
		);
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

test("queued requests wait long enough for a busy conversation", (t) => {
	let now = Date.now();
	t.mock.method(Date, "now", () => now);
	const bridge = new Bridge(
		() => {},
		async () => task.revision,
	);
	try {
		const a = bridge.open("session-AAAA", launchOptions.parse({}));
		const j = bridge.enqueue(a.connection.id, task);
		now += 20 * 60000;
		bridge.sweep();
		assert.equal(j.state, "queued");
		now += QUEUED_DEADLINE_MS;
		bridge.sweep();
		assert.equal(j.state, "failed");
	} finally {
		bridge.close();
	}
});

test("top-level task fields are citable and every bad reference is reported in one rejection", async () => {
	const source = {
		...task,
		comments: [{ id: 7, author: "a", text: "c", created_at: "" }],
		dependencies: [{ id: "same-2", type: "blocks" }],
	};
	const allowed = allowedSources(source);
	for (const field of ["project", "ready", "assignee", "acceptance_criteria", "title"])
		assert.ok(allowed.fields.includes(field), field);
	for (const internal of ["raw", "revision", "workspaceId", "databaseId"])
		assert.ok(!allowed.fields.includes(internal), internal);
	assert.deepEqual(allowed.comments, ["7"]);
	assert.deepEqual(allowed.dependencies, ["same-2"]);
	const saved: unknown[] = [];
	const bridge = new Bridge(
		(s) => saved.push(s),
		async () => task.revision,
	);
	try {
		const a = bridge.open("session-AAAA", launchOptions.parse({}));
		const j = bridge.enqueue(a.connection.id, source);
		bridge.claim(a.connection.id, a.relayKey, "session-AAAA", j.id);
		const cited = (sources: { kind: "field" | "comment" | "dependency"; id: string }[]) => ({
			...summary,
			blocks: summary.blocks.map((b, i) => (i === 0 ? { ...b, sources } : b)),
		});
		await assert.rejects(
			bridge.complete(
				a.connection.id,
				a.relayKey,
				j.id,
				task.revision,
				cited([
					{ kind: "field", id: "invented" },
					{ kind: "comment", id: "99" },
					{ kind: "dependency", id: "nope-1" },
				]),
			),
			(e: Error) =>
				/field:invented/.test(e.message) &&
				/comment:99/.test(e.message) &&
				/dependency:nope-1/.test(e.message) &&
				/Allowed field IDs: .*project/.test(e.message) &&
				/still running/.test(e.message),
		);
		assert.equal(j.state, "running");
		const result = await bridge.complete(
			a.connection.id,
			a.relayKey,
			j.id,
			task.revision,
			cited([
				{ kind: "field", id: "project" },
				{ kind: "field", id: "ready" },
				{ kind: "field", id: "assignee" },
				{ kind: "comment", id: "7" },
				{ kind: "dependency", id: "same-2" },
			]),
		);
		assert.equal(result.taskId, task.id);
		assert.equal(saved.length, 1);
	} finally {
		bridge.close();
	}
});
