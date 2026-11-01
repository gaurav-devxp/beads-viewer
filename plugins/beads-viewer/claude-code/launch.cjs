"use strict";
// Kept intentionally small: diagnostics run before importing server/SQLite code.
var path = require("node:path");
var fs = require("node:fs");
function fail(error) {
	process.stderr.write(
		"Beads Viewer [" +
			(error.code || "STARTUP_FAILED") +
			"]: " +
			error.message +
			"\n",
	);
	process.exitCode = 1;
}
async function main() {
	var root = __dirname;
	var manifestPath = path.join(root, "compatibility.json");
	if (!fs.existsSync(manifestPath))
		throw new Error(
			"Prebuilt package metadata is missing. Run the contributor build/package commands or install the complete prebuilt plugin.",
		);
	var policy = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	var value = process.versions.node.split(".").map(Number);
	var min = policy.prerequisites.node.minimum.split(".").map(Number);
	var max = policy.prerequisites.node.maximumExclusive.split(".").map(Number);
	function cmp(a, b) {
		for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
		return 0;
	}
	if (
		!/^\d+\.\d+\.\d+$/.test(process.versions.node) ||
		cmp(value, min) < 0 ||
		cmp(value, max) >= 0
	) {
		var error = new Error(
			"Node.js " +
				process.versions.node +
				" is unsupported; install/select " +
				policy.prerequisites.node.range +
				" and restart Claude Code.",
		);
		error.code = "NODE_UNSUPPORTED";
		throw error;
	}
	var preflight;
	try {
		preflight = require(path.join(root, "runtime", "prerequisites.cjs"));
	} catch (cause) {
		if (cause.code !== "MODULE_NOT_FOUND") throw cause;
		throw new Error(
			"Prebuilt runtime is missing. Install the complete beads-viewer package; a source checkout must be built and packaged by its contributor first.",
		);
	}
	if (
		process.argv.length > 3 ||
		(process.argv[2] && process.argv[2] !== "--check")
	)
		throw new Error(
			"Supported launcher option: --check (read-only prerequisite diagnostics).",
		);
	var selected = await preflight.checkDependencies();
	if (process.argv[2] === "--check") {
		process.stdout.write(
			JSON.stringify({
				ok: true,
				node: selected.node,
				beads: selected.beads,
				requiredNode: policy.prerequisites.node.range,
			}) + "\n",
		);
		return;
	}
	process.env.BV_WEB_ROOT = path.join(root, "runtime", "web");
	await import(
		require("node:url").pathToFileURL(path.join(root, "runtime", "mcp.mjs"))
			.href
	);
}
main().catch(fail);
