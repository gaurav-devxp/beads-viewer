import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@bv/annotations";
import { BeadsAdapter, runner } from "@bv/beads-adapter";
import { resolveBeads } from "@bv/prerequisites";
import { Application } from "../apps/server/src/app.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Beads is polled only while a browser tab is listening", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const root = await mkdtemp(join(tmpdir(), "bv-polling-"));
	const app = new Application(
		new Store(join(root, "annotations.sqlite")),
		new BeadsAdapter(runner(await resolveBeads())),
		"dist/web",
	);
	try {
		// Fixture adapter: counts list calls instead of reading a real workspace.
		let lists = 0;
		app.beads.discover = async () => ({
			id: "repoA",
			workspaceId: "workspaceA",
			databaseId: "databaseA",
			path: root,
			name: "Polling fixture",
			beadsPath: join(root, ".beads"),
			projectPrefix: "project:",
			health: "fixture",
		});
		app.beads.list = async () => {
			lists++;
			return [];
		};
		const opened = await app.open("session-AAAA", {
			repositories: [root],
			openBrowser: false,
		});
		app.startPolling();
		t.mock.timers.tick(8000 * 3);
		await flush();
		assert.equal(lists, 0, "no browser tab: Beads is left alone");

		const tab = new AbortController();
		const events = (
			app as unknown as {
				events(id: string, signal: AbortSignal): Response;
			}
		).events(opened.connection.id, tab.signal);
		const reader = events.body!.getReader();
		t.mock.timers.tick(8000);
		await flush();
		assert.ok(lists >= 1, "an open tab is kept current");

		tab.abort();
		await reader.cancel().catch(() => {});
		await flush();
		const seen = lists;
		t.mock.timers.tick(8000 * 3);
		await flush();
		assert.equal(lists, seen, "polling stops when the tab goes away");
		assert.equal(
			app.bridge.state(opened.connection.id).state,
			"connected",
			"the viewer itself stays connected",
		);
	} finally {
		app.close();
		await rm(root, { recursive: true, force: true });
	}
});
