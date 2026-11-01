import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { fixtures } from "../fixtures.ts";
import { Store } from "@bv/annotations";
import { Application } from "../../apps/server/src/app.ts";
// Direct HTTP handler transport allows deterministic API assertions without an external
// server; all task operations use real disposable bd workspaces. Summary completion
// below is explicitly a synthetic transport fixture, NEVER a real session proof.
test("multi-repository workflow, source comments, summary annotations and reload", async ({
	page,
}, testInfo) => {
	const f = await fixtures();
	const app = new Application(
		new Store(join(f.root, "data", "annotations.sqlite")),
		f.adapter,
		"dist/web",
	);
	app.origin = "http://127.0.0.1:4173";
	const opened = await app.open("browser-transport-fixture", {
		repositories: f.paths,
		openBrowser: false,
	});
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.route("http://127.0.0.1:4173/**", async (route) => {
		const r = route.request();
		if (new URL(r.url()).pathname === "/api/events") {
			await route.fulfill({
				status: 200,
				contentType: "text/event-stream",
				body: ": routed test transport\n\n",
			});
			return;
		}
		const response = await app.handle(
			new Request(r.url(), {
				method: r.method(),
				headers: { ...r.headers(), host: "127.0.0.1:4173" },
				body: ["GET", "HEAD"].includes(r.method())
					? undefined
					: r.postData() || "{}",
			}),
		);
		await route.fulfill({
			status: response.status,
			headers: Object.fromEntries(response.headers),
			body: Buffer.from(await response.arrayBuffer()),
		});
	});
	try {
		await page.goto(opened.url);
		await expect(
			page.getByRole("heading", { name: /All tasks/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "First task", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Second task", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "First task", exact: true }).click();
		await expect(
			page.getByRole("tab", { name: "Agent view", exact: true }),
		).toHaveAttribute("aria-selected", "true");
		await page
			.getByLabel("Ordinary comment", { exact: true })
			.fill("Persistent browser comment");
		await page
			.getByRole("button", { name: "Post comment", exact: true })
			.click();
		await expect(
			page.getByText("Persistent browser comment", { exact: true }),
		).toBeVisible();
		const block = page.locator('[data-anchor-block="description"]');
		await block.evaluate((element) => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			const node = walker.nextNode()!;
			const range = document.createRange(),
				text = node.textContent!,
				start = text.indexOf("café");
			range.setStart(node, start);
			range.setEnd(node, start + 4);
			const selected = window.getSelection()!;
			selected.removeAllRanges();
			selected.addRange(range);
			element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		});
		await page
			.getByRole("button", { name: "Add inline comment", exact: true })
			.click();
		await page
			.getByLabel("Inline comment", { exact: true })
			.fill("Persistent Agent inline");
		await page
			.getByRole("button", { name: "Post inline comment", exact: true })
			.click();
		await expect(
			page.getByText("Persistent Agent inline", { exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Edit task", exact: true }).click();
		await page.getByLabel("Title", { exact: true }).fill("Draft survives tabs");
		await page.getByRole("tab", { name: "Human view", exact: true }).click();
		await expect(
			page.getByText("There is no cached summary for this task yet.", {
				exact: false,
			}),
		).toBeVisible();
		await page.getByRole("tab", { name: "Agent view", exact: true }).click();
		await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
			"Draft survives tabs",
		);
		page.once("dialog", (d) => d.accept());
		await page
			.getByRole("button", { name: "Cancel edits", exact: true })
			.click();
		await page.getByRole("tab", { name: "Human view", exact: true }).click();
		await page
			.getByRole("button", { name: "Generate briefing", exact: true })
			.click();
		// The request exists once the browser shows its one-request command.
		await expect(page.getByLabel("Claude briefing command")).toBeVisible();
		const queued = app.bridge
			.list(opened.connection.id, f.repos[0].workspaceId, "same-collision")
			.at(-1)!;
		await expect(page.getByLabel("Claude briefing command")).toHaveValue(
			`/beads-viewer:brief ${JSON.stringify({ connectionId: opened.connection.id, requestId: queued.id })}`,
		);
		const job = app.bridge.claim(
			opened.connection.id,
			opened.relayKey,
			"browser-transport-fixture",
			queued.id,
		);
		expect(job).toBeTruthy();
		await app.bridge.complete(
			opened.connection.id,
			opened.relayKey,
			job!.id,
			job!.sourceHash,
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
					text:
						kind === "overview"
							? "Browser transport fixture briefing."
							: "No additional facts supplied.",
					sources: [{ kind: "field", id: "description" }],
				})),
				omissions: [],
			},
		);
		await page.reload();
		await expect(
			page.getByText("Browser transport fixture briefing.", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("Persistent browser comment", { exact: true }),
		).toBeVisible();
		const human = page.locator('[data-anchor-block="overview"]');
		await human.evaluate((element) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			const selection = window.getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		});
		await page
			.getByRole("button", { name: "Add inline comment", exact: true })
			.click();
		await page
			.getByLabel("Inline comment", { exact: true })
			.fill("Persistent Human inline");
		await page
			.getByRole("button", { name: "Post inline comment", exact: true })
			.click();
		await expect(
			page.getByText("Persistent Human inline", { exact: true }),
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByText("Persistent Human inline", { exact: true }),
		).toBeVisible();
		await page.getByRole("tab", { name: "Agent view", exact: true }).click();
		await expect(
			page.getByText("Persistent Agent inline", { exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Close dialog", exact: true })
			.click();
		await page.getByRole("button", { name: "Filters", exact: false }).click();
		await page.getByLabel("Core", { exact: true }).check();
		await expect(
			page.getByRole("button", { name: "First task", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Second task", exact: true }),
		).toHaveCount(0);
		await page.screenshot({
			path: `docs/claude-code/evidence/workspace-${testInfo.project.name}.png`,
			fullPage: true,
		});
		expect(errors).toEqual([]);
	} finally {
		app.close();
		await f.cleanup();
	}
});
