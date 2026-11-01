import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	mkdtemp,
	cp,
	chmod,
	readdir,
	stat,
	rm,
	writeFile,
	readFile,
	open,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const root = await mkdtemp(join(tmpdir(), "Beads Viewer portable 安全 ")),
	plugin = join(root, "Read Only Plugin");
const source = resolve(
		process.argv[2] || `artifacts/beads-viewer-${version}-claude-code`,
	),
	lines = [];
const report = (line) => {
	lines.push(line);
	console.log(line);
};
async function mode(dir, writable) {
	for (const name of await readdir(dir)) {
		const p = join(dir, name);
		if ((await stat(p)).isDirectory()) await mode(p, writable);
		else await chmod(p, writable ? 0o600 : 0o444);
	}
	await chmod(dir, writable ? 0o700 : 0o555);
}
// File descriptors avoid requiring extra sockets for the prerequisite check.
async function diagnostic() {
	const out = await open(join(root, "doctor.json"), "w"),
		err = await open(join(root, "doctor.err"), "w");
	try {
		const child = spawn(
			process.execPath,
			[join(plugin, "launch.cjs"), "--check"],
			{
				cwd: root,
				env: { ...process.env, BV_DATA_DIR: join(root, "Data") },
				stdio: ["ignore", out.fd, err.fd],
			},
		);
		const code = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", resolve);
		});
		if (code !== 0)
			throw new Error(await readFile(join(root, "doctor.err"), "utf8"));
		return JSON.parse(await readFile(join(root, "doctor.json"), "utf8"));
	} finally {
		await out.close();
		await err.close();
	}
}
let client;
try {
	await cp(source, plugin, { recursive: true });
	await mode(plugin, false);
	const check = await diagnostic();
	report(
		"Read-only installed package outside checkout, spaces/Unicode: prerequisite checks PASS",
	);
	report("Installed Node: " + check.node.version);
	report(
		"Installed Beads: " + check.beads.version + " via " + check.beads.source,
	);
	client = new Client({ name: "portable-package-probe", version: "1.0.0" });
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [join(plugin, "launch.cjs")],
		cwd: root,
		env: { ...process.env, BV_DATA_DIR: join(root, "Data") },
		stderr: "pipe",
	});
	transport.stderr?.on("data", () => {});
	await client.connect(transport);
	report("Installed Node → prebuilt MCP: PASS");
	report(
		"MCP tools: " +
			(await client.listTools()).tools.map((t) => t.name).join(", "),
	);
	const result = await client.callTool({
		name: "connect_open",
		arguments: {
			sessionId: "probe-no-inference",
			options: { repositories: [], openBrowser: false },
		},
	});
	if (result.isError) {
		report(
			"connect_open: " +
				result.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n")
					.slice(0, 1000),
		);
		process.exitCode = 1;
	} else
		report(
			"connect_open returned a browser launch; credentials redacted. No model inference was run.",
		);
} catch (error) {
	report("Probe blocked/failed: " + error.message);
	process.exitCode = 1;
} finally {
	if (client) await client.close();
	await writeFile(
		"docs/claude-code/evidence/portable/runtime-probe.txt",
		lines.join("\n") + "\n",
	);
	await mode(plugin, true).catch(() => {});
	await rm(root, { recursive: true, force: true });
}
