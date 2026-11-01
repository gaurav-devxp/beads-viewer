import { z } from "zod";
export const text = z.string().max(100000);
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
export const status = z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/);
export const editable = z
	.object({
		title: z.string().trim().min(1).max(1000),
		description: text.default(""),
		status: status.default("open"),
		priority: z.number().int().min(0).max(4).default(2),
		issue_type: z
			.string()
			.regex(/^[a-z][a-z0-9_-]{0,60}$/)
			.default("task"),
		assignee: z.string().max(200).default(""),
		labels: z
			.array(
				z
					.string()
					.min(1)
					.max(150)
					.refine((s) => !s.includes(","), "Labels cannot contain commas"),
			)
			.max(100)
			.default([]),
		design: text.default(""),
		notes: text.default(""),
		acceptance_criteria: text.default(""),
	})
	.strict();
export function taskEditable(task: unknown): Editable {
	const t = task as Record<string, unknown>;
	return editable.parse(
		Object.fromEntries(Object.keys(editable.shape).map((k) => [k, t[k]])),
	);
}
export type Editable = z.infer<typeof editable>;
export interface Task extends Editable {
	id: string;
	workspaceId: string;
	repositoryId: string;
	databaseId: string;
	project: string;
	revision: string;
	created_at: string;
	updated_at: string;
	ready: boolean;
	blocked: boolean;
	dependencies: Relation[];
	dependents: Relation[];
	comments: Comment[];
	raw: Record<string, unknown>;
}
export interface Relation {
	id: string;
	type: string;
	title?: string;
	status?: string;
}
export interface Comment {
	id: string | number;
	author: string;
	text: string;
	created_at: string;
}
export interface Repository {
	id: string;
	workspaceId: string;
	databaseId: string;
	path: string;
	name: string;
	beadsPath: string;
	projectPrefix: string;
	health: string;
}
export const reference = z
	.object({
		kind: z.enum(["field", "comment", "dependency"]),
		id: z.string().min(1).max(200),
	})
	.strict();
export const block = z
	.object({
		id: z.string().regex(/^[a-z][a-z0-9-]{0,60}$/),
		kind: z.enum([
			"overview",
			"state",
			"checklist",
			"blockers",
			"decisions",
			"suggestions",
			"questions",
		]),
		title: z.string().min(1).max(200),
		text: text,
		sources: z.array(reference).max(100),
	})
	.strict();
export const summaryContent = z
	.object({
		schemaVersion: z.literal(1),
		promptVersion: z.literal("briefing-1"),
		blocks: z.array(block).min(1).max(30),
		omissions: z.array(z.string().max(1000)).max(50),
	})
	.strict()
	.superRefine((s, c) => {
		if (new Set(s.blocks.map((b) => b.id)).size !== s.blocks.length)
			c.addIssue({ code: "custom", message: "Block IDs must be unique" });
		for (const k of [
			"overview",
			"state",
			"checklist",
			"blockers",
			"decisions",
			"suggestions",
			"questions",
		])
			if (!s.blocks.some((b) => b.kind === k))
				c.addIssue({ code: "custom", message: `Missing ${k} block` });
	});
export type SummaryContent = z.infer<typeof summaryContent>;
export interface Summary extends SummaryContent {
	id: string;
	workspaceId: string;
	taskId: string;
	sourceHash: string;
	generatedAt: string;
	host: "claude-code" | "codex";
	sessionId: string;
	connectionId: string;
}
export const anchor = z
	.object({
		version: z.literal(1),
		view: z.enum(["agent", "human"]),
		workspaceId: id,
		taskId: id,
		blockId: z.string().min(1).max(200),
		summaryId: z.string().uuid().optional(),
		sourceRevision: z.string().min(1).max(100),
		exact: z.string().min(1).max(10000),
		prefix: z.string().max(64),
		suffix: z.string().max(64),
		start: z.number().int().nonnegative(),
		end: z.number().int().positive(),
	})
	.strict()
	.superRefine((a, c) => {
		if (a.end <= a.start || (a.view === "human" && !a.summaryId))
			c.addIssue({ code: "custom", message: "Invalid anchor range/revision" });
	});
export type Anchor = z.infer<typeof anchor>;
export interface Reply {
	id: string;
	author: string;
	text: string;
	createdAt: string;
}
export interface Thread {
	id: string;
	anchor: Anchor;
	resolved: boolean;
	replies: Reply[];
	createdAt: string;
}
export interface ConnectionState {
	id: string;
	sessionId: string;
	host: "claude-code" | "codex";
	state: "connected" | "disconnected" | "expired";
	createdAt: number;
	lastSeen: number;
	expiresAt: number;
	reason?: string;
}
export interface AIRequest {
	id: string;
	connectionId: string;
	workspaceId: string;
	taskId: string;
	sourceHash: string;
	operation: "summarize";
	source: Task;
	createdAt: number;
	deadline: number;
	state: "queued" | "running" | "complete" | "failed" | "cancelled";
	error?: string;
	result?: Summary;
}
export interface Snapshot {
	repositories: Repository[];
	tasks: Task[];
	errors: {
		workspaceId: string;
		error: string;
	}[];
	connection: ConnectionState;
	observedAt: string;
	allowedRepositories: {
		name: string;
		registered: boolean;
	}[];
}
export interface Detail {
	task: Task;
	threads: Thread[];
	summaries: Summary[];
	jobs: AIRequest[];
}
export const launchOptions = z
	.object({
		repositories: z.array(z.string().min(1).max(4096)).max(30).default([]),
		openBrowser: z.boolean().default(true),
		filters: z.record(z.string().max(500)).default({}),
		task: z
			.object({
				workspaceId: id,
				taskId: id,
				tab: z.enum(["agent", "human"]).default("agent"),
			})
			.optional(),
		idleSeconds: z.number().int().min(30).max(600).default(120),
		lifetimeSeconds: z.number().int().min(60).max(1800).default(900),
	})
	.strict();
export type LaunchOptions = z.infer<typeof launchOptions>;
export type Filters = Record<string, string>;
export function filterTasks(tasks: Task[], f: Filters): Task[] {
	const values = (k: string) => (f[k] || "").split(",").filter(Boolean);
	const facets = [
		"workspaceId",
		"project",
		"status",
		"priority",
		"issue_type",
		"assignee",
		"labels",
	];
	const result = tasks.filter((t) => {
		if (
			f.q &&
			![t.id, t.title, t.description, ...t.labels]
				.join(" ")
				.toLocaleLowerCase()
				.includes(f.q.toLocaleLowerCase())
		)
			return false;
		if (f.readiness === "ready" && !t.ready) return false;
		if (f.readiness === "blocked" && !(t.blocked || t.status === "blocked"))
			return false;
		return facets.every((k) => {
			const v = values(k);
			if (!v.length) return true;
			if (k === "labels") {
				if (v.includes("__none") && !t.labels.length) return true;
				return f.labelMode === "all"
					? v.every((x) => t.labels.includes(x))
					: v.some((x) => t.labels.includes(x));
			}
			const value =
				k === "assignee" ? t.assignee || "__none" : String(t[k as keyof Task]);
			return v.includes(value);
		});
	});
	const sort = f.sort || "updated_at",
		sign = f.direction === "asc" ? 1 : -1;
	return result.sort(
		(a, b) =>
			sign *
				(sort === "priority"
					? a.priority - b.priority
					: String(a[sort as keyof Task] || "").localeCompare(
							String(b[sort as keyof Task] || ""),
						)) || a.id.localeCompare(b.id),
	);
}
// Canonical text normalization: NFC/LF and UTF-16 offsets.
// Markdown anchors use markdownText(source), shared by the renderer and API.
export function canonical(s: string): string {
	return s.replace(/\r\n?/g, "\n").normalize("NFC");
}
export function locate(
	a: Anchor,
	value: string,
):
	| {
			state: "attached";
			start: number;
			end: number;
	  }
	| {
			state: "detached";
			reason: string;
	  } {
	const s = canonical(value);
	const matches: number[] = [];
	let at = s.indexOf(a.exact);
	while (at >= 0) {
		matches.push(at);
		at = s.indexOf(a.exact, at + 1);
	}
	if (!matches.length)
		return { state: "detached", reason: "Selected source text was removed" };
	const context = matches.filter(
		(p) =>
			(!a.prefix ||
				s.slice(Math.max(0, p - a.prefix.length), p) === a.prefix) &&
			(!a.suffix ||
				s.slice(p + a.exact.length, p + a.exact.length + a.suffix.length) ===
					a.suffix),
	);
	const candidates = context.length ? context : matches;
	if (candidates.length !== 1)
		return {
			state: "detached",
			reason: "Repeated quotation is ambiguous; reattach explicitly",
		};
	return {
		state: "attached",
		start: candidates[0],
		end: candidates[0] + a.exact.length,
	};
}
export {
	markdownTree,
	markdownText,
	safeHref,
	type MarkdownNode,
} from "./markdown.ts";
