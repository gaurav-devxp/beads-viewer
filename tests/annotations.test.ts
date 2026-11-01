import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "@bv/annotations";
import { canonical, locate, type Anchor, type Summary } from "@bv/contracts";
const a: Anchor = {
	version: 1,
	view: "agent",
	workspaceId: "workspaceA",
	taskId: "same-1",
	blockId: "description",
	sourceRevision: "a".repeat(64),
	exact: "café 👩🏽‍💻",
	prefix: "First ",
	suffix: "; then",
	start: 6,
	end: 19,
};
test("canonical Unicode/CRLF and repeated quote anchoring are conservative", () => {
	const value = canonical(
		"First cafe\u0301 👩🏽‍💻; then café 👩🏽‍💻.\r\n```echo $HOME```",
	);
	const end = 6 + a.exact.length;
	assert.deepEqual(locate({ ...a, end }, value), {
		state: "attached",
		start: 6,
		end,
	});
	assert.deepEqual(locate({ ...a, prefix: "", suffix: "" }, value), {
		state: "detached",
		reason: "Repeated quotation is ambiguous; reattach explicitly",
	});
	assert.equal(locate(a, "The quote was removed").state, "detached");
	assert.equal(locate(a, "New paragraph. " + value).state, "attached");
});
test("both views, replies, resolution, immutable revisions, dedup and transactional export/import survive restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "bv-annotations-"));
	let store = new Store(join(root, "annotations.sqlite"));
	try {
		const agent = store.add(a, "Native source thread", "Local tester");
		const summaryId = randomUUID();
		const human = store.add(
			{ ...a, view: "human", summaryId, blockId: "overview" },
			"Summary thread",
			"Local tester",
		);
		store.edit(
			a.workspaceId,
			a.taskId,
			agent.id,
			{ text: "Reply", resolved: true },
			"Local tester",
		);
		const s: Summary = {
			id: summaryId,
			workspaceId: a.workspaceId,
			taskId: a.taskId,
			sourceHash: a.sourceRevision,
			generatedAt: new Date().toISOString(),
			host: "claude-code",
			sessionId: "session-A",
			connectionId: randomUUID(),
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
				text: a.exact,
				sources: [],
			})),
			omissions: [],
		};
		store.saveSummary(s);
		store.saveSummary({ ...s, id: randomUUID(), sourceHash: "b".repeat(64) });
		const req = randomUUID();
		assert.equal(store.claim(req, "request"), null);
		assert.equal(store.claim(req, "request")?.state, "pending");
		store.finish(req, { ok: true });
		assert.deepEqual(store.claim(req, "request")?.response, { ok: true });
		assert.throws(() => store.claim(req, "different"));
		const exported = store.export();
		store.close();
		store = new Store(join(root, "annotations.sqlite"));
		const persisted = store.threads(a.workspaceId, a.taskId);
		assert.equal(persisted.length, 2);
		assert.equal(persisted[0].replies.length, 2);
		assert.equal(persisted[0].resolved, true);
		assert.equal(
			persisted.find((t) => t.id === human.id)?.anchor.summaryId,
			summaryId,
		);
		assert.equal(store.summaries(a.workspaceId, a.taskId).length, 2);
		const other = new Store(join(root, "import", "annotations.sqlite"));
		try {
			other.import(exported);
			other.import(exported);
			assert.equal(other.threads(a.workspaceId, a.taskId).length, 2);
			assert.throws(() => other.import({ ...exported, version: 2 }));
			assert.equal(other.summaries(a.workspaceId, a.taskId).length, 2);
		} finally {
			other.close();
		}
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});
test("schema 1 to 2 migration preserves data and allows separate worktrees of one repository", async () => {
	const { DatabaseSync } = await import("node:sqlite");
	const root = await mkdtemp(join(tmpdir(), "bv-upgrade-"));
	const path = join(root, "annotations.sqlite");
	const old = new DatabaseSync(path);
	old.exec(
		"CREATE TABLE repositories (id TEXT PRIMARY KEY, workspace TEXT UNIQUE NOT NULL, storage TEXT UNIQUE NOT NULL, data TEXT NOT NULL); PRAGMA user_version=1;",
	);
	const repository = {
		id: "same-repository",
		workspaceId: "worktree-A",
		databaseId: "database-A",
		name: "A",
		path: "/test/A",
		beadsPath: "/test/A/.beads",
		projectPrefix: "project:",
		health: "healthy",
	};
	old
		.prepare("INSERT INTO repositories VALUES (?,?,?,?)")
		.run(
			repository.id,
			repository.workspaceId,
			repository.databaseId,
			JSON.stringify(repository),
		);
	old.close();
	const store = new Store(path);
	try {
		assert.equal(store.repositories().length, 1);
		store.register({
			...repository,
			workspaceId: "worktree-B",
			databaseId: "database-B",
			path: "/test/B",
		});
		assert.equal(store.repositories().length, 2);
		assert.equal(
			(store.db.prepare("PRAGMA user_version").get() as any).user_version,
			2,
		);
		assert.equal(
			store.register({
				...repository,
				workspaceId: "worktree-C",
				path: "/test/C",
			}).workspaceId,
			"worktree-A",
		);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});
