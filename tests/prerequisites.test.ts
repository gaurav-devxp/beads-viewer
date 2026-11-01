import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	writeFile,
	chmod,
	rm,
	symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	assertNode,
	supportsNode,
	parseBeadsVersion,
	resolveBeads,
	executableNames,
	probeBeads,
} from "@bv/prerequisites";
import { runner } from "@bv/beads-adapter";
test("Node range and SQLite diagnostics precede server import", () => {
	for (const version of [
		"18.20.0",
		"20.0.0",
		"22.0.0",
		"24.11.0",
		"25.0.0",
		"24.12.0-rc.1",
		"garbage",
	]) {
		assert.equal(supportsNode(version), false);
		assert.throws(
			() =>
				assertNode(version, () => {
					throw Error("must not be loaded");
				}),
			{ code: "NODE_UNSUPPORTED" },
		);
	}
	assert.ok(supportsNode("24.11.1"));
	assert.ok(supportsNode("24.12.0"));
	assert.throws(() => assertNode("24.11.1", () => ({})), {
		code: "SQLITE_UNAVAILABLE",
	});
	assert.throws(
		() =>
			assertNode("24.11.1", () => {
				throw Error("disabled");
			}),
		{ code: "SQLITE_UNAVAILABLE" },
	);
	assertNode("24.11.1", () => ({ DatabaseSync: function () {} }));
	assert.equal(parseBeadsVersion("bd version 1.1.0 (commit)"), "1.1.0");
	for (const text of ["bd version 1.2.0", "bd version 1.1.0-beta", "not bd"])
		assert.throws(() => parseBeadsVersion(text), { code: "BEADS_UNSUPPORTED" });
});
test("PATH resolution handles explicit paths, symlinks and failures without using a shell", async () => {
	const root = await mkdtemp(join(tmpdir(), "Beads prerequisite café "));
	try {
		await assert.rejects(
			resolveBeads({ env: { PATH: join(root, "missing") } }),
			{ code: "BEADS_NOT_FOUND" },
		);
		await assert.rejects(resolveBeads({ binary: "relative/bd" }), {
			code: "BEADS_PATH_INVALID",
		});
		await assert.rejects(resolveBeads({ binary: join(root, "absent") }), {
			code: "BEADS_NOT_FOUND",
		});
		const tools = join(root, "tools with spaces");
		await mkdir(tools);
		await writeFile(join(tools, "bd"), "not executable");
		await chmod(join(tools, "bd"), 0o600);
		await assert.rejects(resolveBeads({ env: { PATH: tools } }), {
			code: "BEADS_NOT_EXECUTABLE",
		});
		await chmod(join(tools, "bd"), 0o700);
		const result = await resolveBeads({ env: { PATH: tools } });
		assert.equal(result.path, join(tools, "bd"));
		assert.equal(result.source, "PATH");
		const linked = join(root, "bd-link");
		await symlink(join(tools, "bd"), linked);
		assert.equal((await resolveBeads({ binary: linked })).path, result.path);
		// Simulates only Windows candidate lookup/shim policy on this filesystem, not native Windows execution.
		await writeFile(join(root, "bd.cmd"), "@echo off\r\n");
		await assert.rejects(
			resolveBeads({ env: { Path: root }, platform: "win32" }),
			{ code: "BEADS_SHELL_SHIM" },
		);
		assert.equal(executableNames("win32")[0], "bd.exe");
		await writeFile(join(root, "bd"), "#!/bin/sh\n");
		await assert.rejects(
			resolveBeads({ env: { Path: root }, platform: "win32" }),
			{ code: "BEADS_SHELL_SHIM" },
		);
		await writeFile(join(root, "bd.exe"), "test lookup fixture");
		assert.equal(
			(await resolveBeads({ env: { Path: root }, platform: "win32" })).path,
			join(root, "bd.exe"),
		);
		const entry = join(root, 'Beads "entry".cjs');
		await writeFile(entry, "");
		const js = await resolveBeads({ binary: entry });
		assert.equal(js.executable, process.execPath);
		assert.deepEqual(js.prefixArgs, [entry]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("real installed Beads is discovered and probed without a private runtime", async () => {
	const selected = await resolveBeads();
	assert.equal(await probeBeads(selected), "1.1.0");
	const run = runner(selected);
	assert.match(await run(["version"], process.cwd()), /^bd version 1\.1\.0/);
	run.dispose?.();
});
