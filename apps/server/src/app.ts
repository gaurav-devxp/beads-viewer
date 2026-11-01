import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { userInfo } from "node:os";
import { z } from "zod";
import {
	anchor,
	markdownText,
	editable,
	id,
	launchOptions,
	type Repository,
	type Snapshot,
	type Anchor,
} from "@bv/contracts";
import { Store } from "@bv/annotations";
import { BeadsAdapter, AppError, hash } from "@bv/beads-adapter";
import { Bridge, secret, equal } from "@bv/host-bridge";
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
	new Response(JSON.stringify(value), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...headers,
		},
	});
const errorResponse = (e: unknown) =>
	json(
		{ error: e instanceof Error ? e.message : "Unknown error" },
		e instanceof AppError
			? e.code
			: e instanceof z.ZodError || e instanceof SyntaxError
				? 400
				: 500,
	);
interface Session {
	connectionId: string;
	csrf: string;
	expiresAt: number;
}
export class Application {
	readonly instanceId = randomUUID();
	readonly bridge: Bridge;
	origin = "http://127.0.0.1:0";
	private credentials = new Map<
		string,
		{
			connectionId: string;
			expiresAt: number;
			filters: Record<string, string>;
		}
	>();
	private sessions = new Map<string, Session>();
	private scopes = new Map<string, Set<string>>();
	private locks = new Map<string, Promise<unknown>>();
	private poll?: ReturnType<typeof setInterval>;
	constructor(
		readonly store: Store,
		readonly beads: BeadsAdapter,
		readonly webRoot: string,
	) {
		this.bridge = new Bridge(
			(s) => store.saveSummary(s),
			async (w, t) => (await beads.detail(this.repository(w), t)).revision,
		);
	}
	repository(workspaceId: string) {
		const r = this.store
			.repositories()
			.find((x) => x.workspaceId === workspaceId);
		if (!r) throw new AppError(404, "Unregistered workspace");
		return r;
	}
	private scoped(connectionId: string, workspaceId: string) {
		if (!this.scopes.get(connectionId)?.has(workspaceId))
			throw new AppError(403, "Workspace was not selected for this launch");
		return this.repository(workspaceId);
	}
	async open(sessionId: string, input: unknown) {
		const options = launchOptions.parse(input);
		const opened = this.bridge.open(sessionId, options);
		this.scopes.set(opened.connection.id, new Set());
		const failures: {
				path: string;
				error: string;
			}[] = [],
			notices: string[] = [];
		for (const path of options.repositories) {
			try {
				const result = await this.register(opened.connection.id, path);
				if (result.registrationNotice) notices.push(result.registrationNotice);
			} catch (e) {
				failures.push({ path, error: String(e) });
			}
		}
		const credential = secret(),
			filters = { ...options.filters };
		if (options.task) {
			filters.task = options.task.taskId;
			filters.workspace = options.task.workspaceId;
			filters.tab = options.task.tab;
		}
		this.credentials.set(credential, {
			connectionId: opened.connection.id,
			expiresAt: Date.now() + 60000,
			filters,
		});
		return {
			...opened,
			url: `${this.origin}/#launch=${credential}`,
			failures,
			notices,
			notice:
				"Same-turn relay occupies this Claude conversation until disconnected, interrupted, idle, or its lifetime limit is reached.",
		};
	}
	async register(
		connectionId: string,
		path: string,
		projectPrefix = "project:",
	) {
		this.bridge.state(connectionId);
		const discovered = await this.beads.discover(path, projectPrefix);
		const r = this.store.register(discovered);
		const registrationNotice =
			r.workspaceId !== discovered.workspaceId
				? "Shared Beads storage is already registered as " +
					r.path +
					". Tasks are shown once."
				: undefined;
		this.scopes.get(connectionId)!.add(r.workspaceId);
		this.bridge.emit("change", connectionId);
		return { ...r, registrationNotice };
	}
	async snapshot(connectionId: string): Promise<Snapshot> {
		const repositories = this.store
			.repositories()
			.filter((r) => this.scopes.get(connectionId)?.has(r.workspaceId));
		const tasks: Snapshot["tasks"] = [],
			errors: Snapshot["errors"] = [];
		await Promise.all(
			repositories.map(async (r) => {
				try {
					tasks.push(...(await this.beads.list(r)));
				} catch (e) {
					errors.push({
						workspaceId: r.workspaceId,
						error: e instanceof Error ? e.message : String(e),
					});
				}
			}),
		);
		return {
			repositories: repositories.map((r) => ({
				...r,
				health:
					errors.find((e) => e.workspaceId === r.workspaceId)?.error ||
					"healthy",
			})),
			tasks,
			errors,
			connection: this.bridge.state(connectionId),
			observedAt: new Date().toISOString(),
			allowedRepositories: [],
		};
	}
	private session(request: Request) {
		const connectionId =
			request.headers.get("x-bv-connection") ||
			new URL(request.url).searchParams.get("connection");
		if (!connectionId)
			throw new AppError(401, "Browser launch binding is required");
		const name = `bv_${connectionId}=`;
		const token = request.headers
			.get("cookie")
			?.split(";")
			.map((s) => s.trim())
			.find((s) => s.startsWith(name))
			?.slice(name.length);
		const session = token ? this.sessions.get(token) : undefined;
		if (session && session.connectionId !== connectionId)
			throw new AppError(403, "Browser connection mismatch");
		if (!session || session.expiresAt < Date.now())
			throw new AppError(
				401,
				"Browser session expired. Re-run /beads-viewer:open for a new one-time launch link.",
			);
		return session;
	}
	private checkOrigin(request: Request) {
		const url = new URL(this.origin);
		if (request.headers.get("host") !== url.host)
			throw new AppError(403, "Invalid Host header");
		const origin = request.headers.get("origin");
		if (origin && origin !== this.origin)
			throw new AppError(403, "Cross-origin requests are not allowed");
		if (request.headers.get("sec-fetch-site") === "cross-site")
			throw new AppError(403, "Cross-site requests are not allowed");
		if (!["GET", "HEAD"].includes(request.method) && origin !== this.origin)
			throw new AppError(403, "Same-origin request required");
	}
	async handle(request: Request): Promise<Response> {
		try {
			this.checkOrigin(request);
			const url = new URL(request.url),
				path = url.pathname;
			if (path === "/health") return json({ instanceId: this.instanceId });
			if (path === "/api/exchange" && request.method === "POST") {
				const { credential } = z
					.object({ credential: z.string().min(40).max(100) })
					.strict()
					.parse(await request.json());
				const c = this.credentials.get(credential);
				if (!c || c.expiresAt < Date.now())
					throw new AppError(401, "Launch link expired or already used");
				this.credentials.delete(credential);
				const token = secret(),
					session = {
						connectionId: c.connectionId,
						csrf: secret(),
						expiresAt: Date.now() + 12 * 3600000,
					};
				this.sessions.set(token, session);
				return json(
					{
						csrf: session.csrf,
						connectionId: c.connectionId,
						filters: c.filters,
					},
					200,
					{
						"Set-Cookie": `bv_${c.connectionId}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
					},
				);
			}
			if (!path.startsWith("/api/")) return await this.static(path);
			const session = this.session(request),
				connectionId = session.connectionId;
			if (path === "/api/session" && request.method === "GET")
				return json({
					csrf: session.csrf,
					connection: this.bridge.state(connectionId),
				});
			if (path === "/api/events" && request.method === "GET")
				return this.events(connectionId, request.signal);
			if (path === "/api/snapshot" && request.method === "GET")
				return json(await this.snapshot(connectionId));
			if (path === "/api/export" && request.method === "GET") {
				const data = this.store.export();
				const allowed = this.scopes.get(connectionId)!;
				return json(
					{
						...data,
						threads: data.threads.filter((t) =>
							allowed.has(t.anchor.workspaceId),
						),
						summaries: data.summaries.filter((s) => allowed.has(s.workspaceId)),
					},
					200,
					{
						"Content-Disposition":
							'attachment; filename="beads-viewer-annotations.json"',
					},
				);
			}
			const match = path.match(
				/^\/api\/tasks\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/,
			);
			if (match && request.method === "GET") {
				const [, workspaceId, taskId] = match;
				id.parse(workspaceId);
				id.parse(taskId);
				const r = this.scoped(connectionId, workspaceId);
				return json({
					task: await this.beads.detail(r, taskId),
					threads: this.store.threads(workspaceId, taskId),
					summaries: this.store.summaries(workspaceId, taskId),
					jobs: this.bridge.list(connectionId, workspaceId, taskId),
				});
			}
			if (!equal(request.headers.get("x-bv-csrf") || "", session.csrf))
				throw new AppError(403, "CSRF token missing or invalid");
			const key = z
				.string()
				.uuid()
				.parse(request.headers.get("idempotency-key"));
			const bodyText = await request.text();
			if (bodyText.length > 2000000)
				throw new AppError(413, "Request is too large");
			const body = bodyText ? JSON.parse(bodyText) : {};
			const fingerprint = hash({
				path,
				method: request.method,
				body,
				connectionId,
			});
			const claimed = this.store.claim(key, fingerprint);
			if (claimed) {
				if (claimed.state === "pending")
					throw new AppError(
						409,
						"A previous write may still be running or its result is uncertain after restart. Inspect Beads before retrying with a new key.",
					);
				if (claimed.response.receipt) {
					const receipt = claimed.response.receipt;
					const task = await this.beads.detail(
						this.scoped(connectionId, receipt.workspaceId),
						receipt.taskId,
					);
					return json(
						receipt.kind === "comments" ? task.comments : task,
						claimed.response.status,
					);
				}
				return new Response(claimed.response.body, {
					status: claimed.response.status,
					headers: { "Content-Type": "application/json" },
				});
			}
			let response: Response;
			try {
				response = await this.mutate(
					request.method,
					path,
					body,
					connectionId,
					match,
				);
			} catch (e) {
				response = errorResponse(e);
			}
			const result = await response.clone().text();
			const parsed = JSON.parse(result);
			if (response.ok && parsed?.raw && parsed?.workspaceId && parsed?.id)
				this.store.finish(key, {
					status: response.status,
					receipt: {
						kind: "task",
						workspaceId: parsed.workspaceId,
						taskId: parsed.id,
					},
				});
			else if (response.ok && match?.[3] === "comments")
				this.store.finish(key, {
					status: response.status,
					receipt: {
						kind: "comments",
						workspaceId: match[1],
						taskId: match[2],
					},
				});
			else this.store.finish(key, { status: response.status, body: result });
			return response;
		} catch (e) {
			return errorResponse(e);
		}
	}
	private async locked<T>(
		workspace: string,
		work: () => Promise<T>,
	): Promise<T> {
		const previous = this.locks.get(workspace) || Promise.resolve();
		const next = previous.catch(() => {}).then(work);
		this.locks.set(workspace, next);
		try {
			return await next;
		} finally {
			if (this.locks.get(workspace) === next) this.locks.delete(workspace);
		}
	}
	private async mutate(
		method: string,
		path: string,
		body: any,
		connectionId: string,
		match: RegExpMatchArray | null,
	): Promise<Response> {
		if (method === "POST" && path === "/api/disconnect") {
			this.bridge.disconnect(connectionId);
			return json({ disconnected: true });
		}
		if (method === "POST" && path === "/api/import") {
			const allowed = this.scopes.get(connectionId)!;
			if (
				!Array.isArray(body.threads) ||
				!Array.isArray(body.summaries) ||
				body.threads.some((t: any) => !allowed.has(t?.anchor?.workspaceId)) ||
				body.summaries.some((s: any) => !allowed.has(s?.workspaceId))
			)
				throw new AppError(
					403,
					"Import contains workspaces not selected for this launch",
				);
			return json(this.store.import(body));
		}
		if (method === "POST" && path === "/api/repositories/remove") {
			const { workspaceId } = z
				.object({ workspaceId: id })
				.strict()
				.parse(body);
			this.scoped(connectionId, workspaceId);
			this.scopes.get(connectionId)!.delete(workspaceId);
			return json({ removed: workspaceId });
		}
		if (method === "POST" && path === "/api/tasks") {
			const { workspaceId, task } = z
				.object({ workspaceId: id, task: editable })
				.strict()
				.parse(body);
			const r = this.scoped(connectionId, workspaceId);
			const result = await this.locked(workspaceId, () =>
				this.beads.create(r, task),
			);
			this.bridge.emit("change", connectionId);
			return json(result, 201);
		}
		if (!match) throw new AppError(404, "Unknown API operation");
		const [, workspaceId, taskId, action] = match;
		id.parse(workspaceId);
		id.parse(taskId);
		const r = this.scoped(connectionId, workspaceId);
		return this.locked(workspaceId, async () => {
			let result: unknown;
			if (method === "PATCH" && !action) {
				const x = z
					.object({ task: editable, revision: z.string().length(64) })
					.strict()
					.parse(body);
				result = await this.beads.update(r, taskId, x.task, x.revision);
			} else if (method === "DELETE" && !action) {
				const x = z
					.object({ revision: z.string().length(64), confirm: id })
					.strict()
					.parse(body);
				result = await this.beads.delete(r, taskId, x.revision, x.confirm);
			} else if (method === "POST" && action === "comments") {
				const { text } = z
					.object({ text: z.string().min(1).max(100000) })
					.strict()
					.parse(body);
				result = await this.beads.comment(r, taskId, text);
			} else if (method === "POST" && action === "dependencies") {
				const x = z
					.object({ target: id, remove: z.boolean().default(false) })
					.strict()
					.parse(body);
				result = await this.beads.dependency(r, taskId, x.target, x.remove);
			} else if (method === "POST" && action === "summarize") {
				z.object({}).strict().parse(body);
				const job = this.bridge.enqueue(
					connectionId,
					await this.beads.detail(r, taskId),
				);
				result = { id: job.id, state: job.state };
			} else if (method === "POST" && action === "cancel") {
				const { requestId } = z
					.object({ requestId: z.string().uuid() })
					.strict()
					.parse(body);
				const job = this.bridge.cancel(connectionId, requestId);
				result = { id: job.id, state: job.state, error: job.error };
			} else if (method === "POST" && action === "threads") {
				const x = z
					.object({ anchor, text: z.string().min(1).max(100000) })
					.strict()
					.parse(body);
				await this.validateAnchor(r, taskId, x.anchor);
				result = this.store.add(
					x.anchor,
					x.text,
					`Local ${userInfo().username}`,
				);
			} else if (method === "PATCH" && action === "threads") {
				const x = z
					.object({
						threadId: z.string().uuid(),
						text: z.string().min(1).max(100000).optional(),
						resolved: z.boolean().optional(),
						anchor: anchor.optional(),
					})
					.strict()
					.parse(body);
				if (x.anchor) await this.validateAnchor(r, taskId, x.anchor);
				result = this.store.edit(
					workspaceId,
					taskId,
					x.threadId,
					x,
					`Local ${userInfo().username}`,
				);
			} else throw new AppError(404, "Unsupported API operation");
			this.bridge.emit("change", connectionId);
			return json(result);
		});
	}
	private async validateAnchor(r: Repository, taskId: string, a: Anchor) {
		if (a.workspaceId !== r.workspaceId || a.taskId !== taskId)
			throw new AppError(400, "Annotation identity mismatch");
		let value: string;
		if (a.view === "human") {
			const s = this.store
				.summaries(r.workspaceId, taskId)
				.find((s) => s.id === a.summaryId);
			if (!s || s.sourceHash !== a.sourceRevision)
				throw new AppError(409, "Unknown immutable summary revision");
			const b = s.blocks.find((b) => b.id === a.blockId);
			if (!b) throw new AppError(400, "Unknown summary block");
			value = b.text;
		} else {
			const t = await this.beads.detail(r, taskId);
			if (t.revision !== a.sourceRevision)
				throw new AppError(409, "Task source changed; select text again");
			const allowed = [
				"title",
				"description",
				"design",
				"notes",
				"acceptance_criteria",
			];
			if (!allowed.includes(a.blockId))
				throw new AppError(400, "Invalid source field");
			value = String(t[a.blockId as keyof typeof t] || "");
		}
		const s = markdownText(value);
		if (
			s.slice(a.start, a.end) !== a.exact ||
			s.slice(Math.max(0, a.start - a.prefix.length), a.start) !== a.prefix ||
			s.slice(a.end, a.end + a.suffix.length) !== a.suffix
		)
			throw new AppError(
				409,
				"Selected quote does not match the canonical source",
			);
	}
	private events(connectionId: string, signal: AbortSignal) {
		let clean = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const send = (id: string) => {
					if (id === connectionId)
						controller.enqueue(
							new TextEncoder().encode(
								`event: invalidate\ndata: ${JSON.stringify({ connectionId, at: Date.now() })}\n\n`,
							),
						);
				};
				const timer = setInterval(() => {
					try {
						controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
					} catch {
						clean();
					}
				}, 10000);
				clean = () => {
					clearInterval(timer);
					this.bridge.off("change", send);
					signal.removeEventListener("abort", abort);
				};
				const abort = () => {
					clean();
					try {
						controller.close();
					} catch {
						/* Already closed */
					}
				};
				this.bridge.on("change", send);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
				else send(connectionId);
			},
			cancel: () => clean(),
		});
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				"X-Accel-Buffering": "no",
			},
		});
	}
	startPolling() {
		let running = false;
		const revisions = new Map<string, string>();
		this.poll = setInterval(async () => {
			if (running) return;
			running = true;
			try {
				for (const [connectionId] of this.scopes) {
					if (
						this.bridge.state(connectionId).state === "connected" ||
						this.sessions.size
					) {
						const s = await this.snapshot(connectionId),
							revision = hash({
								tasks: s.tasks.map((t) => [t.workspaceId, t.id, t.revision]),
								errors: s.errors,
							});
						if (revisions.get(connectionId) !== revision) {
							revisions.set(connectionId, revision);
							this.bridge.emit("change", connectionId);
						}
					}
				}
			} finally {
				running = false;
			}
		}, 8000);
		this.poll.unref();
	}
	private async static(path: string) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(path);
		} catch {
			throw new AppError(400, "Invalid path");
		}
		if (decoded.includes("\0")) throw new AppError(400, "Invalid path");
		const root = resolve(this.webRoot),
			file = resolve(root, "." + (decoded === "/" ? "/index.html" : decoded));
		if (!file.startsWith(root + sep))
			throw new AppError(403, "Invalid asset path");
		const data = await readFile(file).catch(() => {
			throw new AppError(
				404,
				"Asset not found. Build the production frontend first.",
			);
		});
		const contentType: Record<string, string> = {
			".html": "text/html; charset=utf-8",
			".js": "text/javascript; charset=utf-8",
			".css": "text/css; charset=utf-8",
			".svg": "image/svg+xml",
		};
		return new Response(data, {
			headers: {
				"Content-Type":
					contentType[extname(file)] || "application/octet-stream",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
				"Content-Security-Policy":
					"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
			},
		});
	}
	close() {
		if (this.poll) clearInterval(this.poll);
		this.bridge.close();
		this.beads.close();
		this.store.close();
	}
}
