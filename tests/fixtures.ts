import {
	execFile,
	type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveBeads } from "@bv/prerequisites";
import { BeadsAdapter, runner } from "@bv/beads-adapter";
const exec = promisify(execFile);
const selectedBeads = await resolveBeads({ binary: process.env.BV_TEST_BD });
// Disposable fixture creation needs the same safe argument prefix as a Node CLI entry.
export const binary = selectedBeads.executable;
const selectedExec = (
	file: string,
	args: readonly string[] = [],
	options: ExecFileOptionsWithStringEncoding = {},
) =>
	exec(file, [...(file === binary ? selectedBeads.prefixArgs : []), ...args], {
		...options,
		encoding: "utf8",
	});
export async function fixtures() {
	const root = await mkdtemp(join(tmpdir(), "Beads Viewer café ")),
		paths = [join(root, "first repository"), join(root, "second repository")];
	const { mkdir } = await import("node:fs/promises");
	for (const path of paths) {
		await mkdir(path);
		await selectedExec(
			binary,
			[
				"init",
				"--non-interactive",
				"--skip-agents",
				"--skip-hooks",
				"--prefix",
				"same",
			],
			{ cwd: path, timeout: 60000 },
		);
		await selectedExec(
			binary,
			[
				"--sandbox",
				"--dolt-auto-commit",
				"off",
				"create",
				"--id",
				"same-collision",
				"--title",
				path === paths[0] ? "First task" : "Second task",
				"--description",
				"First café 👩🏽‍💻; then café 👩🏽‍💻.\n```\n$(touch /tmp/bv-INJECTION)\n```",
				"--labels",
				path === paths[0] ? "project:Core,ui" : "project:Operations,api",
				"--json",
			],
			{ cwd: path, timeout: 20000 },
		);
	}
	const adapter = new BeadsAdapter(runner(selectedBeads));
	const repos = [];
	for (const path of paths) repos.push(await adapter.discover(path));
	return {
		root,
		paths,
		repos,
		adapter,
		exec: selectedExec,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}
