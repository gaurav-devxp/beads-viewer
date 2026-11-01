import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	summaryContent,
	type AIRequest,
	type ConnectionState,
	type Task,
	type Summary,
	type LaunchOptions,
} from "@bv/contracts";
import { AppError } from "@bv/beads-adapter";
export const secret = () => randomBytes(32).toString("base64url");
export function equal(a: string, b: string) {
	const x = Buffer.from(a),
		y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}
// Real generation in the invoking conversation can take several minutes at high
// effort, and a busy conversation only sees channel events on its next turn.
export const QUEUED_DEADLINE_MS = 30 * 60_000;
export const RUNNING_DEADLINE_MS = 15 * 60_000;
// Viewer bookkeeping, not task content: never valid briefing citations.
const internalFields = new Set([
	"raw",
	"workspaceId",
	"repositoryId",
	"databaseId",
	"revision",
]);
/** Every source ID a briefing may cite for this exact task revision. */
export function allowedSources(task: Task) {
	return {
		fields: [
			...new Set([
				...Object.keys(task).filter((k) => !internalFields.has(k)),
				...Object.keys(task.raw),
			]),
		].sort(),
		comments: task.comments.map((c) => String(c.id)),
		dependencies: [
			...new Set([...task.dependencies, ...task.dependents].map((d) => d.id)),
		],
	};
}
interface Connection {
	state: ConnectionState;
	key: string;
}
export class Bridge extends EventEmitter {
	private connections = new Map<string, Connection>();
	private jobs = new Map<string, AIRequest>();
	private timer: ReturnType<typeof setInterval>;
	constructor(
		private persist: (s: Summary) => void,
		private currentHash: (
			workspaceId: string,
			taskId: string,
		) => Promise<string>,
	) {
		super();
		this.timer = setInterval(() => this.sweep(), 1000);
		this.timer.unref();
	}
	open(sessionId: string, options: LaunchOptions) {
		if (
			!/^[A-Za-z0-9-]{8,200}$/.test(sessionId) ||
			sessionId.includes("CLAUDE_")
		)
			throw new AppError(
				422,
				"A substituted invoking session ID is required; never guess a transcript ID.",
			);
		const now = Date.now(),
			id = randomUUID(),
			key = secret();
		const state: ConnectionState = {
			id,
			host: "claude-code",
			sessionId,
			state: "connected",
			delivery: "manual",
			createdAt: now,
			lastSeen: now,
			expiresAt: options.lifetimeSeconds
				? now + options.lifetimeSeconds * 1000
				: null,
		};
		this.connections.set(id, {
			state,
			key,
		});
		return { connection: { ...state }, relayKey: key };
	}
	state(id: string) {
		this.sweep();
		const c = this.connections.get(id);
		if (!c) throw new AppError(404, "Unknown launch connection");
		return { ...c.state };
	}
	authorize(id: string, key: string) {
		const c = this.connections.get(id);
		if (!c || !equal(c.key, key))
			throw new AppError(403, "Connection binding mismatch");
		return c;
	}
	assertSession(id: string, key: string, sessionId: string) {
		const c = this.touch(id, key);
		if (c.state.sessionId !== sessionId)
			throw new AppError(
				403,
				"This viewer belongs to a different Claude session",
			);
		return c;
	}
	channelReady(id: string, key: string, sessionId: string) {
		const c = this.assertSession(id, key, sessionId);
		c.state.delivery = "channel";
		this.emit("change", id);
		return { ...c.state };
	}
	private touch(id: string, key: string) {
		const c = this.authorize(id, key);
		this.sweep();
		if (c.state.state !== "connected")
			throw new AppError(409, c.state.reason || "Relay disconnected");
		c.state.lastSeen = Date.now();
		return c;
	}
	enqueue(connectionId: string, source: Task) {
		if (this.state(connectionId).state !== "connected")
			throw new AppError(
				409,
				"This viewer's AI connection was closed. Re-run /beads-viewer:open for a new connection; task editing and cached briefings remain available.",
			);
		const existing = [...this.jobs.values()].find(
			(j) =>
				j.connectionId === connectionId &&
				j.workspaceId === source.workspaceId &&
				j.taskId === source.id &&
				j.sourceHash === source.revision &&
				["queued", "running"].includes(j.state),
		);
		if (existing) return existing;
		if (
			[...this.jobs.values()].filter(
				(j) =>
					j.connectionId === connectionId &&
					["queued", "running"].includes(j.state),
			).length >= 10
		)
			throw new AppError(429, "Relay queue is full");
		const now = Date.now(),
			j: AIRequest = {
				id: randomUUID(),
				connectionId,
				workspaceId: source.workspaceId,
				taskId: source.id,
				sourceHash: source.revision,
				operation: "summarize",
				source,
				createdAt: now,
				deadline: now + QUEUED_DEADLINE_MS,
				state: "queued",
			};
		this.jobs.set(j.id, j);
		this.emit("change", connectionId);
		this.emit("request", j);
		return j;
	}
	deliveryFailed(requestId: string) {
		const j = this.jobs.get(requestId);
		if (!j || j.state !== "queued") return;
		j.deliveryError =
			"Claude could not be notified. Run the briefing command below in the conversation that opened this viewer.";
		this.emit("change", j.connectionId);
	}
	claim(id: string, key: string, sessionId: string, requestId: string) {
		this.assertSession(id, key, sessionId);
		const j = this.jobs.get(requestId);
		if (!j || j.connectionId !== id)
			throw new AppError(403, "Request belongs to a different launch");
		if (j.state !== "queued")
			throw new AppError(
				409,
				"Request is no longer queued; it may be running, completed or cancelled",
			);
		j.state = "running";
		j.deadline = Date.now() + RUNNING_DEADLINE_MS;
		this.emit("change", id);
		return j;
	}
	list(connectionId: string, workspaceId: string, taskId: string) {
		this.sweep();
		return [...this.jobs.values()].filter(
			(j) =>
				j.connectionId === connectionId &&
				j.workspaceId === workspaceId &&
				j.taskId === taskId,
		);
	}
	private owned(id: string, key: string, requestId: string) {
		this.touch(id, key);
		const j = this.jobs.get(requestId);
		if (!j || j.connectionId !== id)
			throw new AppError(403, "Request belongs to a different launch");
		if (j.state !== "running")
			throw new AppError(409, "Request is no longer running");
		return j;
	}
	async complete(
		id: string,
		key: string,
		requestId: string,
		sourceHash: string,
		result: unknown,
	) {
		const j = this.owned(id, key, requestId);
		if (j.sourceHash !== sourceHash)
			throw new AppError(409, "Result source hash does not match request");
		const content = summaryContent.parse(result);
		const allowed = allowedSources(j.source);
		const known = {
			field: new Set(allowed.fields),
			comment: new Set(allowed.comments),
			dependency: new Set(allowed.dependencies),
		};
		// Report every bad reference at once so one corrected retry can succeed.
		const invalid = content.blocks.flatMap((b) =>
			b.sources
				.filter((ref) => !known[ref.kind].has(ref.id))
				.map((ref) => `${b.id} → ${ref.kind}:${ref.id}`),
		);
		if (invalid.length)
			throw new AppError(
				422,
				`Unknown source references: ${invalid.join(", ")}. The request is still running: correct every listed reference and call complete_request again. ` +
					`Allowed field IDs: ${allowed.fields.join(", ")}. Comment IDs: ${allowed.comments.join(", ") || "(none)"}. Dependency IDs: ${allowed.dependencies.join(", ") || "(none)"}.`,
			);
		const current = await this.currentHash(j.workspaceId, j.taskId);
		this.owned(id, key, requestId);
		if (current !== sourceHash) {
			j.state = "failed";
			j.error =
				"Source changed while Claude was working; result was rejected. Retry on the current source.";
			this.emit("change", id);
			throw new AppError(409, j.error);
		}
		const c = this.connections.get(id)!;
		const s: Summary = {
			...content,
			id: randomUUID(),
			workspaceId: j.workspaceId,
			taskId: j.taskId,
			sourceHash,
			generatedAt: new Date().toISOString(),
			host: c.state.host,
			sessionId: c.state.sessionId,
			connectionId: id,
		};
		this.persist(s);
		j.result = s;
		j.state = "complete";
		this.emit("change", id);
		return s;
	}
	fail(id: string, key: string, requestId: string, error: string) {
		const j = this.owned(id, key, requestId);
		j.state = "failed";
		j.error = error.slice(0, 1000);
		this.emit("change", id);
	}
	cancel(id: string, requestId: string) {
		const j = this.jobs.get(requestId);
		if (!j || j.connectionId !== id) throw new AppError(404, "Unknown request");
		if (["queued", "running"].includes(j.state)) {
			j.state = "cancelled";
			j.error = "Cancelled by browser";
			this.emit("change", id);
		}
		return j;
	}
	detach(id: string, key: string, reason = "Disconnected by host") {
		this.authorize(id, key);
		this.disconnect(id, reason);
	}
	disconnect(id: string, reason = "Disconnected by browser") {
		const c = this.connections.get(id);
		if (!c || c.state.state !== "connected") return;
		c.state.state = "disconnected";
		c.state.reason = reason;
		for (const j of this.jobs.values())
			if (j.connectionId === id && ["queued", "running"].includes(j.state)) {
				j.state = "failed";
				j.error = reason;
			}
		this.emit("change", id);
	}
	sweep() {
		const now = Date.now();
		for (const [id, c] of this.connections)
			if (
				c.state.state === "connected" &&
				c.state.expiresAt !== null &&
				now >= c.state.expiresAt
			) {
				this.disconnect(id, "Viewer connection lifetime limit reached");
				c.state.state = "expired";
			}
		for (const j of this.jobs.values()) {
			if (["queued", "running"].includes(j.state) && now >= j.deadline) {
				j.state = "failed";
				j.error =
					"Claude did not complete this request in time. Generate it again and use the briefing command in the conversation that opened this viewer.";
				this.emit("change", j.connectionId);
			}
			if (
				now - j.createdAt > 3600000 &&
				!["queued", "running"].includes(j.state)
			)
				this.jobs.delete(j.id);
		}
	}
	close() {
		clearInterval(this.timer);
		for (const [id] of this.connections)
			this.disconnect(id, "Viewer process stopped");
	}
}
