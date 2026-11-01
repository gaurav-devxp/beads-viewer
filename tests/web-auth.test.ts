import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { Store } from "@bv/annotations";
import { BeadsAdapter, runner } from "@bv/beads-adapter";
import { resolveBeads } from "@bv/prerequisites";
import { Application } from "../apps/server/src/app.ts";

test("browser auth query succeeds after launch exchange and cookie reload, and rejects a lost session", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "bv-web-auth-"));
	const app = new Application(
		new Store(join(root, "annotations.sqlite")),
		new BeadsAdapter(runner(await resolveBeads())),
		"dist/web",
	);
	app.origin = "http://127.0.0.1:4173";
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	t.after(async () => {
		client.clear();
		app.close();
		await rm(root, { recursive: true, force: true });
	});
	const opened = await app.open("web-auth-regression", {
		filters: { q: "café & checkout" },
	});
	const location = new URL(opened.url);
	const browser = new EventTarget();
	let navigationEvents = 0;
	browser.addEventListener("popstate", () => navigationEvents++);
	const globals = {
		location,
		history: {
			replaceState(_data: unknown, _unused: string, url: string) {
				location.href = new URL(url, location.href).href;
			},
		},
		window: browser,
		PopStateEvent: class extends Event {},
	};
	for (const [key, value] of Object.entries(globals)) {
		const original = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value,
		});
		t.after(() => {
			if (original) Object.defineProperty(globalThis, key, original);
			else Reflect.deleteProperty(globalThis, key);
		});
	}
	let cookie = "";
	const requests: string[] = [];
	// Only the browser transport is simulated; requests use the real application
	// authentication handlers, cookies and one-use credential validation.
	t.mock.method(
		globalThis,
		"fetch",
		async (path: string, init: RequestInit) => {
			assert.equal(location.hash, "", "credential removed before API calls");
			assert.equal(init.credentials, "same-origin");
			requests.push(path);
			const headers = new Headers(init.headers);
			headers.set("host", location.host);
			headers.set("origin", location.origin);
			if (cookie) headers.set("cookie", cookie);
			const response = await app.handle(
				new Request(new URL(path, location.href), { ...init, headers }),
			);
			const sessionCookie = response.headers.get("set-cookie");
			if (sessionCookie) cookie = sessionCookie.split(";")[0];
			return response;
		},
	);
	const { authenticate, snapshot } = await import("../apps/web/src/api.ts");
	const options = { queryKey: ["auth"], queryFn: authenticate };
	const launch = await client.fetchQuery(options);
	assert.deepEqual(launch, { connectionId: opened.connection.id });
	assert.equal(client.getQueryState(["auth"])?.status, "success");
	assert.equal(location.searchParams.get("connection"), opened.connection.id);
	assert.equal(location.searchParams.get("q"), "café & checkout");
	assert.equal(navigationEvents, 1);
	assert.equal((await snapshot()).connection.id, opened.connection.id);

	client.clear();
	const reload = await client.fetchQuery(options);
	assert.deepEqual(reload, launch);
	assert.equal(client.getQueryState(["auth"])?.status, "success");
	assert.deepEqual(requests, [
		"/api/exchange",
		"/api/snapshot",
		"/api/session",
	]);

	cookie = "";
	client.clear();
	await assert.rejects(client.fetchQuery(options), /Browser session expired/);
	assert.equal(client.getQueryState(["auth"])?.status, "error");
});
