import { connect } from "node:net";

/**
 * Posts a message into the Claude Code conversation that started this MCP server,
 * through that session's inbox socket (cross-session messaging:
 * https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).
 * Claude Code exports the socket and token to the session's child processes; an
 * idle conversation starts a new turn with the message, in any Claude Code surface.
 * Returns null when this session has no inbox (older Claude Code, or messaging off).
 */
export function sessionInbox(env: NodeJS.ProcessEnv = process.env) {
	const path = env.CLAUDE_CODE_MESSAGING_SOCKET;
	if (!path) return null;
	const token = env.CLAUDE_CODE_MESSAGING_TOKEN;
	return (text: string) =>
		new Promise<void>((resolve, reject) => {
			let sent = false;
			const socket = connect({ path });
			const timer = setTimeout(() => {
				socket.destroy();
				if (sent) resolve();
				else reject(new Error("Claude's session inbox did not accept the message"));
			}, 5000);
			socket.once("connect", () => {
				// Same line format Claude Code prints for injecting messages: an optional
				// auth line proving this is the session's own child, then one user message.
				if (token) socket.write(JSON.stringify({ type: "auth", token }) + "\n");
				socket.end(
					JSON.stringify({
						type: "user",
						message: { role: "user", content: text },
					}) + "\n",
					() => (sent = true),
				);
			});
			socket.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			socket.once("close", (failed) => {
				clearTimeout(timer);
				if (!failed) resolve();
			});
		});
}

/** IDs only: task text never travels through the inbox. */
export function briefingRequestMessage(ids: {
	connectionId: string;
	requestId: string;
	sessionId: string;
}) {
	return (
		"Beads Viewer request: generate one Human view briefing in this conversation. " +
		`Call the beads-viewer claim_request tool with connectionId "${ids.connectionId}", ` +
		`requestId "${ids.requestId}" and sessionId "${ids.sessionId}", then follow the ` +
		"plugin's briefing instructions and finish with complete_request (or fail_request). " +
		"Posted by the Beads Viewer MCP server this conversation started with /beads-viewer:open; " +
		"it carries IDs only."
	);
}
