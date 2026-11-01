import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	sessionInbox,
	briefingRequestMessage,
} from "../plugins/beads-viewer/claude-code/src/inbox.ts";

test("session inbox writes Claude Code's auth line, then one user message", async () => {
	const root = await mkdtemp(join(tmpdir(), "bv-inbox-"));
	const path = join(root, "inbox.sock");
	const received: string[] = [];
	const server = createServer((socket) => {
		let buffer = "";
		socket.on("data", (d) => (buffer += d));
		socket.on("end", () => {
			received.push(...buffer.split("\n").filter(Boolean));
			socket.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(path, resolve));
	try {
		assert.equal(sessionInbox({}), null, "no socket: no automatic delivery");
		const post = sessionInbox({
			CLAUDE_CODE_MESSAGING_SOCKET: path,
			CLAUDE_CODE_MESSAGING_TOKEN: "session-token",
		})!;
		await post("hello");
		assert.deepEqual(received.map((line) => JSON.parse(line)), [
			{ type: "auth", token: "session-token" },
			{ type: "user", message: { role: "user", content: "hello" } },
		]);
		await assert.rejects(
			sessionInbox({ CLAUDE_CODE_MESSAGING_SOCKET: join(root, "missing") })!(
				"x",
			),
		);
	} finally {
		server.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("briefing request messages carry IDs only", () => {
	const text = briefingRequestMessage({
		connectionId: "c-1",
		requestId: "r-1",
		sessionId: "s-1",
	});
	assert.match(text, /^Beads Viewer request:/);
	for (const id of ["c-1", "r-1", "s-1"]) assert.ok(text.includes(id));
});
