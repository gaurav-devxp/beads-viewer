import { createServer } from "node:http";
import { join, dirname, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDependencies } from "@bv/prerequisites";
import { Store } from "@bv/annotations";
import { BeadsAdapter, runner } from "@bv/beads-adapter";
import { Application } from "./app.ts";
export function dataDirectory() {
	if (process.env.BV_DATA_DIR) return resolve(process.env.BV_DATA_DIR);
	return platform() === "win32"
		? join(
				process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
				"Beads Viewer",
			)
		: platform() === "darwin"
			? join(homedir(), "Library", "Application Support", "Beads Viewer")
			: join(
					process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
					"beads-viewer",
				);
}
export function openBrowser(url: string): Promise<string | null> {
	const [binary, args] =
		platform() === "darwin"
			? ["/usr/bin/open", [url]]
			: platform() === "win32"
				? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	return new Promise((resolve) =>
		execFile(
			binary,
			args,
			{ shell: false, windowsHide: true, timeout: 5000 },
			(e) =>
				resolve(
					e
						? "Browser did not open automatically. Use the one-time local URL returned by connect_open."
						: null,
				),
		),
	);
}
export async function startRuntime(
	options: {
		binary?: string;
		webRoot?: string;
		dataDir?: string;
		port?: number;
	} = {},
) {
	const selected = await checkDependencies({
		binary: options.binary,
		capabilities: false,
	});
	const dataDir = options.dataDir || dataDirectory();
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	const app = new Application(
		new Store(join(dataDir, "annotations.sqlite")),
		new BeadsAdapter(runner(selected.beads)),
		options.webRoot ||
			process.env.BV_WEB_ROOT ||
			join(dirname(fileURLToPath(import.meta.url)), "web"),
	);
	const server = createServer(async (req, res) => {
		const abort = new AbortController();
		res.on("close", () => abort.abort());
		try {
			let size = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				size += chunk.length;
				if (size > 2000000) {
					res.writeHead(413);
					res.end("Request too large");
					return;
				}
				chunks.push(chunk);
			}
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers))
				if (value !== undefined)
					headers.set(name, Array.isArray(value) ? value.join(",") : value);
			const request = new Request(app.origin + (req.url || "/"), {
				method: req.method,
				headers,
				body: ["GET", "HEAD"].includes(req.method || "GET")
					? undefined
					: Buffer.concat(chunks),
				signal: abort.signal,
			});
			const response = await app.handle(request);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			if (response.body) {
				const reader = response.body.getReader();
				try {
					while (true) {
						const { value, done } = await reader.read();
						if (done) break;
						if (abort.signal.aborted) break;
						if (!res.write(value))
							await new Promise<void>((resolve) => {
								const done = () => {
									res.off("drain", done);
									res.off("close", done);
									resolve();
								};
								res.once("drain", done);
								res.once("close", done);
							});
					}
				} finally {
					await reader.cancel().catch(() => {});
				}
			}
			res.end();
		} catch {
			if (!res.headersSent) res.writeHead(500);
			res.end("Viewer request failed");
		}
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(options.port || 0, "127.0.0.1", () => resolve());
		});
	} catch (e) {
		app.close();
		throw e;
	}
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Unable to bind loopback");
	app.origin = `http://127.0.0.1:${address.port}`;
	// Per-process instance record. No adoption of an arbitrary process/last session, and no PID-based killing.
	const registry = join(dataDir, `instance-${app.instanceId}.json`);
	await writeFile(
		registry,
		JSON.stringify({
			instanceId: app.instanceId,
			pid: process.pid,
			origin: app.origin,
			startedAt: new Date().toISOString(),
		}),
		{ mode: 0o600 },
	);
	app.startPolling();
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		app.close();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(registry, { force: true });
	};
	return { app, server, close };
}
