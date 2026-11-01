import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
	anchor,
	summaryContent,
	type Repository,
	type Summary,
	type Thread,
	type Reply,
	type Anchor,
} from "@bv/contracts";
import { z } from "zod";
const replySchema = z
	.object({
		id: z.string().uuid(),
		author: z.string().max(200),
		text: z.string().min(1).max(100000),
		createdAt: z.string().datetime(),
	})
	.strict();
const threadSchema = z
	.object({
		id: z.string().uuid(),
		anchor,
		resolved: z.boolean(),
		replies: z.array(replySchema).min(1),
		createdAt: z.string().datetime(),
	})
	.strict();
const summarySchema = z
	.object({
		id: z.string().uuid(),
		workspaceId: z.string(),
		taskId: z.string(),
		sourceHash: z.string(),
		generatedAt: z.string().datetime(),
		host: z.enum(["claude-code", "codex"]),
		sessionId: z.string(),
		connectionId: z.string(),
		schemaVersion: z.literal(1),
		promptVersion: z.literal("briefing-1"),
		blocks: z.array(z.unknown()),
		omissions: z.array(z.string()),
	})
	.strict();
export class Store {
	readonly db: DatabaseSync;
	constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(path);
		chmodSync(path, 0o600);
		this.db.exec(
			"PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
		);
		const v = (this.db.prepare("PRAGMA user_version").get() as any)
			.user_version;
		if (v > 2)
			throw new Error(
				"Annotation database is newer than this viewer; no downgrade performed",
			);
		this.db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE IF NOT EXISTS repositories (id TEXT NOT NULL, workspace TEXT PRIMARY KEY, storage TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, task TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS threads_task ON threads(workspace,task);
   CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, task TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS summaries_task ON summaries(workspace,task);
   CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, response TEXT, created INTEGER NOT NULL);
   COMMIT;`);
		if (v === 1)
			this.db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE repositories_v2 (id TEXT NOT NULL, workspace TEXT PRIMARY KEY, storage TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
   INSERT INTO repositories_v2 SELECT id, workspace, storage, data FROM repositories;
   DROP TABLE repositories;
   ALTER TABLE repositories_v2 RENAME TO repositories;
   COMMIT;`);
		this.db.exec("PRAGMA user_version=2;");
	}
	repositories(): Repository[] {
		return this.db
			.prepare("SELECT data FROM repositories ORDER BY rowid")
			.all()
			.map((x: any) => JSON.parse(x.data));
	}
	register(r: Repository) {
		const existing = this.repositories().find(
			(x) => x.databaseId === r.databaseId || x.path === r.path,
		);
		if (existing) {
			if (existing.path === r.path && existing.databaseId !== r.databaseId)
				throw new Error(
					"Registered root now points at another Beads database. Existing registration was preserved; explicit registry replacement is required.",
				);
			if (existing.projectPrefix !== r.projectPrefix) {
				const updated = { ...existing, projectPrefix: r.projectPrefix };
				this.db
					.prepare("UPDATE repositories SET data=? WHERE workspace=?")
					.run(JSON.stringify(updated), existing.workspaceId);
				return updated;
			}
			return existing;
		}
		this.db
			.prepare("INSERT INTO repositories VALUES (?,?,?,?)")
			.run(r.id, r.workspaceId, r.databaseId, JSON.stringify(r));
		return r;
	}
	unregister(workspace: string) {
		this.db
			.prepare("DELETE FROM repositories WHERE workspace=?")
			.run(workspace);
	}
	threads(workspace: string, task: string): Thread[] {
		return this.db
			.prepare(
				"SELECT data FROM threads WHERE workspace=? AND task=? ORDER BY rowid",
			)
			.all(workspace, task)
			.map((x: any) => JSON.parse(x.data));
	}
	summaries(workspace: string, task: string): Summary[] {
		return this.db
			.prepare(
				"SELECT data FROM summaries WHERE workspace=? AND task=? ORDER BY rowid DESC",
			)
			.all(workspace, task)
			.map((x: any) => JSON.parse(x.data));
	}
	saveSummary(s: Summary) {
		summaryContent.parse({
			schemaVersion: s.schemaVersion,
			promptVersion: s.promptVersion,
			blocks: s.blocks,
			omissions: s.omissions,
		});
		summarySchema.parse(s);
		this.db
			.prepare("INSERT INTO summaries VALUES (?,?,?,?,?)")
			.run(s.id, s.workspaceId, s.taskId, s.sourceHash, JSON.stringify(s));
	}
	private put(t: Thread) {
		threadSchema.parse(t);
		this.db
			.prepare(
				"INSERT INTO threads VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
			)
			.run(t.id, t.anchor.workspaceId, t.anchor.taskId, JSON.stringify(t));
		return t;
	}
	add(a: Anchor, text: string, author: string) {
		return this.put({
			id: randomUUID(),
			anchor: anchor.parse(a),
			resolved: false,
			replies: [this.reply(text, author)],
			createdAt: new Date().toISOString(),
		});
	}
	private reply(text: string, author: string): Reply {
		return replySchema.parse({
			id: randomUUID(),
			author,
			text,
			createdAt: new Date().toISOString(),
		});
	}
	edit(
		workspace: string,
		task: string,
		threadId: string,
		change: {
			text?: string;
			resolved?: boolean;
			anchor?: Anchor;
		},
		author: string,
	) {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const t = this.threads(workspace, task).find((t) => t.id === threadId);
			if (!t) throw new Error("Thread not found");
			if (change.text) t.replies.push(this.reply(change.text, author));
			if (change.resolved !== undefined) t.resolved = change.resolved;
			if (change.anchor) {
				if (
					change.anchor.workspaceId !== workspace ||
					change.anchor.taskId !== task
				)
					throw new Error("Reattachment identity mismatch");
				t.anchor = change.anchor;
			}
			this.put(t);
			this.db.exec("COMMIT");
			return t;
		} catch (e) {
			this.db.exec("ROLLBACK");
			throw e;
		}
	}
	// Claims survive a crash: uncertain Beads writes are not repeated automatically.
	claim(
		key: string,
		fingerprint: string,
	): {
		state: string;
		response?: any;
	} | null {
		this.db
			.prepare("DELETE FROM requests WHERE created < ? AND state != ?")
			.run(Date.now() - 7 * 86400000, "pending");
		const result = this.db
			.prepare("INSERT OR IGNORE INTO requests VALUES (?,?,?,NULL,?)")
			.run(key, fingerprint, "pending", Date.now());
		if (result.changes) return null;
		const row = this.db
			.prepare("SELECT * FROM requests WHERE id=?")
			.get(key) as any;
		if (row.fingerprint !== fingerprint)
			throw new Error(
				"Idempotency key was already used for a different request",
			);
		return {
			state: row.state,
			response: row.response ? JSON.parse(row.response) : undefined,
		};
	}
	finish(key: string, response: any) {
		this.db
			.prepare("UPDATE requests SET state=?,response=? WHERE id=?")
			.run("complete", JSON.stringify(response), key);
	}
	export() {
		return {
			format: "beads-viewer-annotations",
			version: 1,
			exportedAt: new Date().toISOString(),
			threads: this.db
				.prepare("SELECT data FROM threads")
				.all()
				.map((x: any) => JSON.parse(x.data)),
			summaries: this.db
				.prepare("SELECT data FROM summaries")
				.all()
				.map((x: any) => JSON.parse(x.data)),
		};
	}
	import(data: unknown) {
		const x = z
			.object({
				format: z.literal("beads-viewer-annotations"),
				version: z.literal(1),
				exportedAt: z.string(),
				threads: z.array(threadSchema).max(100000),
				summaries: z.array(summarySchema).max(100000),
			})
			.strict()
			.parse(data);
		for (const s of x.summaries)
			summaryContent.parse({
				schemaVersion: s.schemaVersion,
				promptVersion: s.promptVersion,
				blocks: s.blocks,
				omissions: s.omissions,
			});
		this.db.exec("BEGIN IMMEDIATE");
		try {
			// Merge-only import never overwrites an existing local thread or immutable revision.
			for (const t of x.threads)
				this.db
					.prepare("INSERT OR IGNORE INTO threads VALUES (?,?,?,?)")
					.run(t.id, t.anchor.workspaceId, t.anchor.taskId, JSON.stringify(t));
			for (const s of x.summaries)
				this.db
					.prepare("INSERT OR IGNORE INTO summaries VALUES (?,?,?,?,?)")
					.run(s.id, s.workspaceId, s.taskId, s.sourceHash, JSON.stringify(s));
			this.db.exec("COMMIT");
			return { threads: x.threads.length, summaries: x.summaries.length };
		} catch (e) {
			this.db.exec("ROLLBACK");
			throw e;
		}
	}
	close() {
		this.db.close();
	}
}
