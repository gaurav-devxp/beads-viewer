import { test } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { BeadsAdapter, runner } from "@bv/beads-adapter";
import { editable, filterTasks, taskEditable } from "@bv/contracts";
import { fixtures, binary } from "./fixtures.ts";
test("real embedded Beads: colliding IDs, native CRUD/comments/deps, shell-safe arguments, closed and ready filters, conflict, private PATH", async () => {
	const f = await fixtures();
	try {
		const [a, b] = f.repos;
		assert.notEqual(a.workspaceId, b.workspaceId);
		assert.notEqual(a.databaseId, b.databaseId);
		const all = [...(await f.adapter.list(a)), ...(await f.adapter.list(b))];
		assert.equal(all.length, 2);
		assert.equal(filterTasks(all, { project: "Core", labels: "ui" }).length, 1);
		assert.equal(
			filterTasks(all, {
				project: "Core,Operations",
				assignee: "__none",
				labels: "ui,api",
				labelMode: "any",
			}).length,
			2,
		);
		assert.equal(
			filterTasks(all, { labels: "ui,api", labelMode: "all" }).length,
			0,
		);
		const unsafe = `Quotes ' "\nUnicode café 👩🏽‍💻; $(touch /tmp/bv-INJECTION) --json`;
		const privateAdapter = new BeadsAdapter(
			runner(binary, { PATH: "/nonexistent" }),
		);
		const created = await privateAdapter.create(
			a,
			editable.parse({
				title: unsafe,
				description: unsafe,
				labels: ["project:Core", "test"],
				assignee: "tester",
			}),
		);
		assert.equal(created.title, unsafe);
		assert.equal(created.description, unsafe);
		const updated = await privateAdapter.update(
			a,
			created.id,
			{ ...taskEditable(created), status: "closed", priority: 0, assignee: "" },
			created.revision,
		);
		assert.equal(updated.status, "closed");
		assert.equal(
			filterTasks(await f.adapter.list(a), {
				status: "closed",
				assignee: "__none",
			}).length,
			1,
		);
		const comments = await privateAdapter.comment(a, created.id, unsafe);
		assert.equal(comments[0].text, unsafe);
		const independent = JSON.parse(
			(
				await f.exec(binary, ["comments", created.id, "--json"], {
					cwd: a.path,
				})
			).stdout,
		);
		assert.equal(independent[0].text, unsafe);
		await assert.rejects(
			f.adapter.update(
				a,
				created.id,
				{ ...taskEditable(updated), title: "stale" },
				updated.revision,
			),
			/changed outside/,
		);
		let fresh = await f.adapter.detail(a, created.id);
		fresh = await f.adapter.update(
			a,
			created.id,
			{ ...taskEditable(fresh), status: "open", labels: [] },
			fresh.revision,
		);
		assert.equal(fresh.labels.length, 0);
		fresh = await f.adapter.dependency(a, created.id, "same-collision");
		assert.equal(fresh.dependencies.length, 1);
		assert.ok(
			filterTasks(await f.adapter.list(a), { readiness: "blocked" }).some(
				(t) => t.id === created.id,
			),
		);
		await assert.rejects(
			f.adapter.delete(a, created.id, fresh.revision, created.id),
			/relationships/,
		);
		fresh = await f.adapter.dependency(a, created.id, "same-collision", true);
		await f.adapter.delete(a, created.id, fresh.revision, created.id);
		await assert.rejects(f.adapter.detail(a, created.id));
		assert.equal(
			(await f.adapter.detail(b, "same-collision")).title,
			"Second task",
		);
		await assert.rejects(access("/tmp/bv-INJECTION"));
		const remaining = JSON.parse(
			(
				await f.exec(binary, ["list", "--all", "--limit", "0", "--json"], {
					cwd: a.path,
				})
			).stdout,
		);
		assert.equal(remaining.length, 1);
	} finally {
		await f.cleanup();
	}
});
