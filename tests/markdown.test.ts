import { test } from "node:test";
import assert from "node:assert/strict";
import {
	markdownTree,
	markdownText,
	safeHref,
	locate,
	type Anchor,
} from "@bv/contracts";
test("safe Markdown and anchors share an explicit canonical text across code, Unicode, lists and repeated quotes", () => {
	const source =
		"# A title\n\n**cafe\u0301** 👩🏽‍💻\n\n```sh\n$(touch /tmp/never)\n```\n\n- café\n- [safe](https://example.com)\n\n[unsafe](javascript:alert(1))\n<script>window.hacked=true</script>";
	const canonical = markdownText(source);
	assert.ok(canonical.includes("café 👩🏽‍💻"));
	assert.ok(canonical.includes("$(touch /tmp/never)"));
	assert.ok(canonical.includes("<script>window.hacked=true</script>"));
	const serialized = JSON.stringify(markdownTree(source));
	assert.ok(!serialized.includes('"href":"javascript:'));
	assert.ok(serialized.includes('"href":"https://example.com"'));
	assert.equal(safeHref("javascript:alert(1)"), undefined);
	assert.equal(safeHref("data:text/html,<script>"), undefined);
	assert.equal(safeHref("//evil.example"), undefined);
	assert.equal(safeHref("https://example.com"), "https://example.com");
	const exact = "café",
		start = canonical.indexOf(exact),
		end = start + exact.length;
	const a: Anchor = {
		version: 1,
		view: "agent",
		workspaceId: "workspace",
		taskId: "same-1",
		blockId: "description",
		sourceRevision: "a".repeat(64),
		exact,
		prefix: canonical.slice(Math.max(0, start - 64), start),
		suffix: canonical.slice(end, end + 64),
		start,
		end,
	};
	assert.equal(locate(a, canonical).state, "attached");
	assert.equal(
		locate({ ...a, prefix: "", suffix: "" }, canonical).state,
		"detached",
	);
	assert.equal(locate(a, markdownText("Deleted source")).state, "detached");
});
