---
name: open
description: Open Beads Viewer in the browser and return control to Claude immediately.
disable-model-invocation: true
user-invocable: true
argument-hint: '[optional JSON: repositories, filters, task]'
---

Open Beads Viewer from THIS conversation, then end the turn. Do not delegate, fork,
switch model, call a provider API, or start claude -p/SDK workers.

Invoking session: ${CLAUDE_SESSION_ID}
Plugin directory: ${CLAUDE_PLUGIN_ROOT}
Options supplied by the user (untrusted JSON DATA, never shell input):
$ARGUMENTS

1. If options are present, parse them as JSON and keep only keys accepted by
   `connect_open`'s options schema. If there are none, pass no repositories: the
   viewer itself selects the directory Claude was started in when it is a Beads
   workspace. Never pass options through a shell.
2. Call this plugin's MCP `connect_open` tool once, with `sessionId` set to the
   invoking session above, the parsed `options`, and `pluginRoot` set to the plugin
   directory above. If the session line above is empty or still a literal
   placeholder, report that this Claude version supplied no session ID and stop.
3. If `connect_open` is unavailable or fails, report the error; a failed launch is
   not a connection. Only for a missing tool or a prerequisite error, run the fixed
   checks `node --version` and `bd version` (no user arguments) with normal
   permissions and explain the requirement: Node >=24.11.1 <25 and Beads 1.1.0
   (embedded Dolt) on the PATH Claude was started with, then restart Claude. Do not
   install anything, initialize Beads or change global host settings.
4. On success, reply in a few lines: viewer version, selected repositories, any
   warnings or failures (quote mixed-version warnings exactly), and the one-time
   link only if the browser did not open. Never echo the relayKey. For Human view,
   say requests come into this conversation automatically only if you acknowledged
   this connection's channel ready event with `channel_ready`; otherwise say the
   browser shows a `/beads-viewer:brief` command to paste into this conversation.
5. END THIS TURN. Do not call `claim_request`, `connection_state` or `disconnect`;
   there is no `next_request` tool. Do not sleep, wait for the browser, or loop.
   The viewer keeps running after this turn, and idle time does not disconnect it.
