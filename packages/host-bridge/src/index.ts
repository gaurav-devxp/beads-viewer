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
interface Connection {
	state: ConnectionState;
	key: string;
	idleMs: number;
	lastWork: number;
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
			createdAt: now,
			lastSeen: now,
			expiresAt: now + options.lifetimeSeconds * 1000,
		};
		this.connections.set(id, {
			state,
			key,
			idleMs: options.idleSeconds * 1000,
			lastWork: now,
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
				"Claude relay disconnected. Re-run /beads-viewer:open; CRUD and cached summaries remain available.",
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
				deadline: now + 180000,
				state: "queued",
			};
		this.connections.get(connectionId)!.lastWork = now;
		this.jobs.set(j.id, j);
		this.emit("change", connectionId);
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
	async next(
		id: string,
		key: string,
		waitMs = 10000,
		signal?: AbortSignal,
	): Promise<AIRequest | null> {
		this.touch(id, key);
		waitMs = Math.min(Math.max(waitMs, 0), 10000);
		const take = () => {
			this.touch(id, key);
			const j = [...this.jobs.values()].find(
				(j) => j.connectionId === id && j.state === "queued",
			);
			if (j) {
				j.state = "running";
				this.emit("change", id);
			}
			return j || null;
		};
		const immediate = take();
		if (immediate || !waitMs) return immediate;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				clean();
				try {
					this.touch(id, key);
					resolve(null);
				} catch (e) {
					reject(e);
				}
			}, waitMs);
			const clean = () => {
				clearTimeout(timer);
				this.off("change", onChange);
				signal?.removeEventListener("abort", abort);
			};
			const check = () => {
				try {
					const j = take();
					if (j) {
						clean();
						resolve(j);
					}
				} catch (e) {
					clean();
					reject(e);
				}
			};
			const onChange = (changed: string) => {
				if (changed === id) queueMicrotask(check);
			};
			const abort = () => {
				clean();
				this.detach(id, key, "Host interrupted the queue wait");
				reject(new AppError(499, "Relay wait cancelled"));
			};
			this.on("change", onChange);
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
		});
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
		for (const b of content.blocks)
			for (const ref of b.sources) {
				const valid =
					ref.kind === "field"
						? Object.hasOwn(j.source.raw, ref.id)
						: ref.kind === "comment"
							? j.source.comments.some((c) => String(c.id) === ref.id)
							: [...j.source.dependencies, ...j.source.dependents].some(
									(d) => d.id === ref.id,
								);
				if (!valid)
					throw new AppError(
						422,
						`Unknown source reference ${ref.kind}:${ref.id}`,
					);
			}
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
		c.lastWork = Date.now();
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
				(now >= c.state.expiresAt ||
					now - c.state.lastSeen > 180000 ||
					(![...this.jobs.values()].some(
						(j) =>
							j.connectionId === id && ["queued", "running"].includes(j.state),
					) &&
						now - c.lastWork > c.idleMs))
			) {
				this.disconnect(
					id,
					now >= c.state.expiresAt
						? "Relay lifetime limit reached"
						: "Relay idle limit or host heartbeat expired",
				);
				c.state.state = "expired";
			}
		for (const j of this.jobs.values()) {
			if (["queued", "running"].includes(j.state) && now >= j.deadline) {
				j.state = "failed";
				j.error = "AI request deadline exceeded";
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
