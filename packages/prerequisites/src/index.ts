import { access, realpath, stat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, delimiter, extname } from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import compatibility from "../../../compatibility.json" with { type: "json" };
export { compatibility };
export class PrerequisiteError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "PrerequisiteError";
	}
}
export interface Command {
	executable: string;
	prefixArgs: string[];
	path: string;
}
export interface InstalledBeads extends Command {
	version: string;
	source: "PATH" | "override";
}
const recovery =
	"Check the PATH inherited by the host, then restart the host or reconnect the beads-viewer MCP server. No dependencies were installed or changed.";
function tuple(value: string) {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	return m ? m.slice(1).map(Number) : null;
}
export function supportsNode(version: string) {
	const v = tuple(version),
		min = tuple(compatibility.prerequisites.node.minimum)!,
		max = tuple(compatibility.prerequisites.node.maximumExclusive)!;
	const compare = (a: number[], b: number[]) => {
		for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
		return 0;
	};
	return !!v && compare(v, min) >= 0 && compare(v, max) < 0;
}
export function assertNode(
	version = process.versions.node,
	loadSQLite: () => unknown = () =>
		createRequire(import.meta.url)("node:sqlite"),
) {
	if (!supportsNode(version))
		throw new PrerequisiteError(
			"NODE_UNSUPPORTED",
			`Node.js ${version} is unsupported. Beads Viewer requires ${compatibility.prerequisites.node.range}. Select a supported installed Node.js and restart the host. Do not use the host's internal runtime.`,
		);
	try {
		const sqlite = loadSQLite() as { DatabaseSync?: unknown };
		if (typeof sqlite?.DatabaseSync !== "function")
			throw new Error("DatabaseSync unavailable");
	} catch {
		throw new PrerequisiteError(
			"SQLITE_UNAVAILABLE",
			`The selected Node.js lacks node:sqlite.DatabaseSync. Use a standard supported Node.js installation with SQLite enabled; check NODE_OPTIONS for disabled SQLite. ${recovery}`,
		);
	}
}
export function parseBeadsVersion(output: string) {
	const match = /^bd version (\S+)(?:\s|$)/m.exec(output);
	if (
		!match ||
		!compatibility.prerequisites.beads.supportedVersions.includes(match[1])
	)
		throw new PrerequisiteError(
			"BEADS_UNSUPPORTED",
			`Unsupported Beads version (${(match?.[1] || "unrecognized output").slice(0, 80).replace(/[^A-Za-z0-9.+-]/g, "?")}). This adapter supports ${compatibility.prerequisites.beads.supportedVersions.join(", ")} (${compatibility.prerequisites.beads.storageMode} ${compatibility.prerequisites.beads.backend}). Check bd version and select a compatible existing installation; do not migrate user data automatically.`,
		);
	return match[1];
}
export function executableNames(platform: NodeJS.Platform = process.platform) {
	return platform === "win32"
		? ["bd.exe", "bd", "bd.js", "bd.cjs", "bd.mjs", "bd.cmd", "bd.bat"]
		: ["bd"];
}
export function pathValue(env: NodeJS.ProcessEnv) {
	return (
		Object.entries(env).find(([k]) => k.toUpperCase() === "PATH")?.[1] || ""
	);
}
async function commandFor(
	path: string,
	platform: NodeJS.Platform,
): Promise<Command> {
	const resolved = await realpath(path).catch(() => {
		throw new PrerequisiteError(
			"BEADS_NOT_FOUND",
			`Beads executable not found at the configured path. Install/configure Beads using your usual setup, or set BV_BD_BINARY to its existing absolute executable path. ${recovery}`,
		);
	});
	if (/\.(cmd|bat)$/i.test(path) || /\.(cmd|bat)$/i.test(resolved))
		throw new PrerequisiteError(
			"BEADS_SHELL_SHIM",
			`The Beads command resolves to a Windows shell shim (${extname(path)}). Set BV_BD_BINARY to the actual existing bd.exe or the package's verified JavaScript CLI entry point. Task arguments will not be interpolated through cmd.exe. ${recovery}`,
		);
	const info = await stat(resolved);
	if (!info.isFile())
		throw new PrerequisiteError(
			"BEADS_NOT_EXECUTABLE",
			"The selected Beads path is not a file. " + recovery,
		);
	if (/\.(?:[cm]?js)$/i.test(resolved))
		return {
			executable: process.execPath,
			prefixArgs: [resolved],
			path: resolved,
		};
	if (
		platform === "win32" &&
		![".exe", ".com"].includes(extname(resolved).toLowerCase())
	) {
		const file = await open(resolved, "r");
		let native = false;
		try {
			const signature = Buffer.alloc(2);
			await file.read(signature, 0, 2, 0);
			native = signature.toString() === "MZ";
		} finally {
			await file.close();
		}
		if (!native)
			throw new PrerequisiteError(
				"BEADS_SHELL_SHIM",
				"The Windows Beads command resolves to an extensionless script/shim. Set BV_BD_BINARY to its existing bd.exe or verified JavaScript CLI entry point; shell interpolation is disabled. " +
					recovery,
			);
	}
	if (platform !== "win32")
		await access(resolved, constants.X_OK).catch(() => {
			throw new PrerequisiteError(
				"BEADS_NOT_EXECUTABLE",
				"The selected Beads file is not executable. Choose a working Beads installation. " +
					recovery,
			);
		});
	return { executable: resolved, prefixArgs: [], path: resolved };
}
export async function resolveBeads(
	options: {
		binary?: string;
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
	} = {},
): Promise<Command & { source: "PATH" | "override" }> {
	const env = options.env || process.env,
		platform = options.platform || process.platform,
		override = options.binary ?? env.BV_BD_BINARY;
	if (override !== undefined) {
		if (!isAbsolute(override))
			throw new PrerequisiteError(
				"BEADS_PATH_INVALID",
				"BV_BD_BINARY must be an absolute path to your existing Beads executable or JavaScript CLI entry point.",
			);
		return { ...(await commandFor(override, platform)), source: "override" };
	}
	const directories = pathValue(env)
		.split(platform === "win32" ? ";" : delimiter)
		.map((p) => p.replace(/^"(.*)"$/, "$1"))
		.filter((p) => isAbsolute(p));
	let candidateError: unknown;
	for (const directory of directories)
		for (const name of executableNames(platform)) {
			const candidate = join(directory, name);
			try {
				await stat(candidate);
			} catch {
				continue;
			}
			try {
				return { ...(await commandFor(candidate, platform)), source: "PATH" };
			} catch (e) {
				candidateError ??= e;
			}
		}
	if (candidateError) throw candidateError;
	throw new PrerequisiteError(
		"BEADS_NOT_FOUND",
		`Beads (bd) was not found on the host process PATH. Beads is a prerequisite: install/configure it yourself, confirm bd version works, or set BV_BD_BINARY to its absolute executable path. ${recovery}`,
	);
}
export function executeCommand(
	command: Command,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
	timeout = 10000,
): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile(
			command.executable,
			[...command.prefixArgs, ...args],
			{
				cwd,
				env,
				shell: false,
				windowsHide: true,
				timeout,
				maxBuffer: 2 * 1024 * 1024,
			},
			(error, out) => {
				if (error) {
					reject(
						new PrerequisiteError(
							"BEADS_PROBE_FAILED",
							`The selected Beads installation could not run ${args[0] || "its check"} (${error.code || "execution failed"}). Confirm it works in this host environment. ${recovery}`,
						),
					);
					return;
				}
				resolve(out);
			},
		),
	);
}
export async function probeBeads(
	command: Command,
	cwd = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
	capabilities = true,
): Promise<string> {
	const cleanEnv = { ...env };
	for (const key of Object.keys(cleanEnv))
		if (/^(BD_|BEADS_)/.test(key)) delete cleanEnv[key];
	const deadline = Date.now() + 20000;
	const run = (args: string[]) => {
		const remaining = deadline - Date.now();
		if (remaining <= 0)
			throw new PrerequisiteError(
				"BEADS_PROBE_TIMEOUT",
				"Beads prerequisite checks exceeded their 20 second startup budget. " +
					recovery,
			);
		return executeCommand(
			command,
			args,
			cwd,
			cleanEnv,
			Math.min(10000, remaining),
		);
	};
	const version = parseBeadsVersion(await run(["version"]));
	if (capabilities)
		for (const [name, flags] of Object.entries(
			compatibility.prerequisites.beads.requiredFlags,
		)) {
			const help = await run([name, "--help"]);
			if (flags.some((flag) => !help.includes(flag)))
				throw new PrerequisiteError(
					"BEADS_CAPABILITIES",
					`The selected Beads installation does not support the required ${name} options. Use a validated compatible Beads installation; no workspace was initialized or migrated.`,
				);
		}
	return version;
}
export async function checkDependencies(
	options: {
		binary?: string;
		env?: NodeJS.ProcessEnv;
		capabilities?: boolean;
	} = {},
) {
	assertNode();
	const command = await resolveBeads(options);
	const version = await probeBeads(
		command,
		process.cwd(),
		options.env,
		options.capabilities ?? true,
	);
	return {
		node: { version: process.versions.node, executable: process.execPath },
		beads: { ...command, version } as InstalledBeads,
	};
}
