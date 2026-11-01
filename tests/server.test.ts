import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, symlink, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "@bv/annotations";
import { Application } from "../apps/server/src/app.ts";
import { markdownText } from "@bv/contracts";
import { fixtures } from "./fixtures.ts";
test("HTTP contract with real Beads: one-use credential, Host/Origin/CSRF, scoped roots, dedup, annotations and launch isolation", async () => {
	const f = await fixtures();
	let app = new Application(
		new Store(join(f.root, "app", "annotations.sqlite")),
		f.adapter,
		"dist/web",
	);
	app.origin = "http://127.0.0.1:4173";
	try {
		const a = await app.open("session-AAAA", {
				repositories: f.paths,
				openBrowser: false,
			}),
			b = await app.open("session-BBBB", {
				repositories: [f.paths[1]],
				openBrowser: false,
			});
		const request = async (
			path: string,
			method = "GET",
			body?: unknown,
			headers: Record<string, string> = {},
		) =>
			app.handle(
				new Request(app.origin + path, {
					method,
					headers: {
						host: "127.0.0.1:4173",
						origin: app.origin,
						"x-bv-connection": a.connection.id,
						...headers,
					},
					body: body === undefined ? undefined : JSON.stringify(body),
				}),
			);
		const credential = new URL(a.url).hash.slice(8);
		const exchanged = await request("/api/exchange", "POST", { credential });
		assert.equal(exchanged.status, 200);
		const cookie = exchanged.headers.get("set-cookie")!.split(";")[0],
			session = await exchanged.json();
		assert.equal(
			(await request("/api/exchange", "POST", { credential })).status,
			401,
		);
		assert.equal((await request("/api/snapshot")).status, 401);
		assert.equal(
			(
				await request("/api/snapshot", "GET", undefined, {
					cookie,
					host: "evil.example",
				})
			).status,
			403,
		);
		assert.equal(
			(
				await request("/api/snapshot", "GET", undefined, {
					cookie,
					origin: "https://evil.example",
				})
			).status,
			403,
		);
		const data = await (
			await request("/api/snapshot", "GET", undefined, { cookie })
		).json();
		assert.equal(data.tasks.length, 2);
		const alias = join(f.root, "shared storage alias");
		await mkdir(alias);
		await symlink(
			f.repos[0].beadsPath,
			join(alias, ".beads"),
			process.platform === "win32" ? "junction" : "dir",
		);
		const duplicate = await app.register(a.connection.id, alias);
		assert.equal(duplicate.workspaceId, f.repos[0].workspaceId);
		assert.match(duplicate.registrationNotice || "", /Shared Beads storage/);
		assert.equal((await app.snapshot(a.connection.id)).tasks.length, 2);
		const missing = f.paths[1] + " unavailable";
		await rename(f.paths[1], missing);
		try {
			const partial = await app.snapshot(a.connection.id);
			assert.equal(partial.tasks.length, 1);
			assert.equal(partial.errors.length, 1);
			assert.equal(partial.errors[0].workspaceId, f.repos[1].workspaceId);
		} finally {
			await rename(missing, f.paths[1]);
		}

		const taskPath = `/api/tasks/${f.repos[0].workspaceId}/same-collision`;
		assert.equal(
			(
				await request(
					taskPath + "/comments",
					"POST",
					{ text: "test" },
					{ cookie },
				)
			).status,
			403,
		);
		const h = {
			cookie,
			"x-bv-csrf": session.csrf,
			"idempotency-key": randomUUID(),
		};
		const one = await request(
			taskPath + "/comments",
			"POST",
			{ text: "Persistent ordinary comment" },
			h,
		);
		assert.equal(one.status, 200);
		assert.equal(
			(
				await request(
					taskPath + "/comments",
					"POST",
					{ text: "Persistent ordinary comment" },
					h,
				)
			).status,
			200,
		);
		assert.equal(
			(await f.adapter.detail(f.repos[0], "same-collision")).comments.length,
			1,
		);
		assert.equal(
			(
				await request(
					"/api/repositories",
					"POST",
					{ path: "/etc" },
					{ ...h, "idempotency-key": randomUUID() },
				)
			).status,
			404,
		);
		const detail = await (
			await request(taskPath, "GET", undefined, { cookie })
		).json();
		const quote = "café 👩🏽‍💻",
			source = markdownText(detail.task.description),
			start = source.indexOf(quote),
			end = start + quote.length;
		const anchor = {
			version: 1,
			view: "agent",
			workspaceId: f.repos[0].workspaceId,
			taskId: "same-collision",
			blockId: "description",
			sourceRevision: detail.task.revision,
			exact: quote,
			start,
			end,
			prefix: source.slice(Math.max(0, start - 64), start),
			suffix: source.slice(end, end + 64),
		};
		const th = await request(
			taskPath + "/threads",
			"POST",
			{ anchor, text: "Inline comment" },
			{ ...h, "idempotency-key": randomUUID() },
		);
		assert.equal(th.status, 200, await th.clone().text());
		assert.equal(
			(
				await request(
					taskPath + "/threads",
					"POST",
					{ anchor: { ...anchor, start: 0 }, text: "invalid" },
					{ ...h, "idempotency-key": randomUUID() },
				)
			).status,
			409,
		);
		// A Beads comment changes the task revision but not the quoted field, so a
		// selection made just before the page refreshed must still anchor.
		const commented = await request(
			taskPath + "/comments",
			"POST",
			{ text: "Ordinary comment before an inline one" },
			{ ...h, "idempotency-key": randomUUID() },
		);
		assert.equal(commented.status, 200, await commented.clone().text());
		const rebased = await request(
			taskPath + "/threads",
			"POST",
			{ anchor, text: "Inline after ordinary comment" },
			{ ...h, "idempotency-key": randomUUID() },
		);
		assert.equal(rebased.status, 200, await rebased.clone().text());
		const latest = await (
			await request(taskPath, "GET", undefined, { cookie })
		).json();
		assert.notEqual(latest.task.revision, anchor.sourceRevision);
		assert.equal(
			(await rebased.json()).anchor.sourceRevision,
			latest.task.revision,
		);
		assert.equal(
			(
				await request(
					taskPath + "/threads",
					"POST",
					{ anchor: { ...anchor, exact: "changed" }, text: "stale quote" },
					{ ...h, "idempotency-key": randomUUID() },
				)
			).status,
			409,
		);
		const jobResponse = await request(
			taskPath + "/summarize",
			"POST",
			{},
			{ ...h, "idempotency-key": randomUUID() },
		);
		assert.equal(jobResponse.status, 200);
		const job = await jobResponse.json();
		assert.throws(
			() =>
				app.bridge.claim(b.connection.id, b.relayKey, "session-BBBB", job.id),
			/different launch/,
		);
		const consumed = app.bridge.claim(
			a.connection.id,
			a.relayKey,
			"session-AAAA",
			job.id,
		);
		assert.equal(consumed?.taskId, "same-collision");
		const summary = await app.bridge.complete(
			a.connection.id,
			a.relayKey,
			consumed!.id,
			consumed!.sourceHash,
			{
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
					text: "Explicit synthetic transport fixture.",
					sources: [{ kind: "field", id: "description" }],
				})),
				omissions: [],
			},
		);
		const humanText = markdownText(summary.blocks[0].text),
			humanAnchor = {
				...anchor,
				view: "human",
				summaryId: summary.id,
				sourceRevision: summary.sourceHash,
				blockId: "overview",
				exact: humanText,
				start: 0,
				end: humanText.length,
				prefix: "",
				suffix: "",
			};
		const humanResponse = await request(
			taskPath + "/threads",
			"POST",
			{ anchor: humanAnchor, text: "Human inline persisted" },
			{ ...h, "idempotency-key": randomUUID() },
		);
		assert.equal(humanResponse.status, 200, await humanResponse.clone().text());
		assert.equal(
			(
				await request(taskPath + "/comments", "POST", undefined, {
					...h,
					"idempotency-key": randomUUID(),
				})
			).status,
			400,
		);
		const malformed = await app.handle(
			new Request(app.origin + taskPath + "/comments", {
				method: "POST",
				headers: {
					host: "127.0.0.1:4173",
					origin: app.origin,
					...h,
					"x-bv-connection": a.connection.id,
					"idempotency-key": randomUUID(),
				},
				body: "{broken",
			}),
		);
		assert.equal(malformed.status, 400);
		const exchangeB = await request("/api/exchange", "POST", {
				credential: new URL(b.url).hash.slice(8),
			}),
			cookieB = exchangeB.headers.get("set-cookie")!.split(";")[0];
		assert.equal(
			(
				await request(taskPath, "GET", undefined, {
					cookie: cookieB,
					"x-bv-connection": b.connection.id,
				})
			).status,
			403,
		);
		const sharedCookie = cookie + "; " + cookieB;
		assert.equal(
			(await request(taskPath, "GET", undefined, { cookie: sharedCookie }))
				.status,
			200,
		);
		assert.equal(
			(
				await request(taskPath, "GET", undefined, {
					cookie: sharedCookie,
					"x-bv-connection": b.connection.id,
				})
			).status,
			403,
		);
		assert.equal(
			(
				await request("/api/tasks/unknown/same-collision", "GET", undefined, {
					cookie,
				})
			).status,
			403,
		);
		app.close();
		app = new Application(
			new Store(join(f.root, "app", "annotations.sqlite")),
			f.adapter,
			"dist/web",
		);
		assert.equal(
			app.store.threads(f.repos[0].workspaceId, "same-collision").length,
			3,
		);
		assert.equal(
			app.store.summaries(f.repos[0].workspaceId, "same-collision").length,
			1,
		);
	} finally {
		app.close();
		await f.cleanup();
	}
});
