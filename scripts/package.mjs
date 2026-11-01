import {
	readFile,
	writeFile,
	cp,
	mkdir,
	rm,
	readdir,
	stat,
} from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { filesIn, writeZip } from "./lib/archive.mjs";
const policy = JSON.parse(await readFile("compatibility.json", "utf8"));
const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log(
		"Build: npm run build; package: npm run package:plugin. Requires no Go, ZIP utility or runtime binaries. --release is blocked until acceptance gates pass.",
	);
	process.exit(0);
}
if (args.some((arg) => !["--release", "--experimental"].includes(arg)))
	throw new Error(
		"Unknown packaging option. This portable package has no OS/CPU target or bundled runtime inputs.",
	);
if (args.includes("--release"))
	throw new Error("Release blocked: " + policy.releaseGates.join("; "));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const identity = JSON.parse(
	await readFile(
		"plugins/beads-viewer/claude-code/.claude-plugin/plugin.json",
		"utf8",
	),
);
if (identity.version !== pkg.version)
	throw new Error("Root and plugin versions disagree");
const meta = JSON.parse(await readFile("dist/mcp.mjs.meta.json", "utf8"));
const external = [
	...new Set(
		Object.values(meta.outputs).flatMap((o) =>
			(o.imports || []).filter((i) => i.external).map((i) => i.path),
		),
	),
];
if (external.some((p) => !p.startsWith("node:") && !builtinModules.includes(p)))
	throw new Error("Unbundled production dependency found");
const output = resolve("artifacts", `beads-viewer-${pkg.version}-claude-code`);
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "runtime"), { recursive: true });
for (const name of [
	".claude-plugin",
	"skills",
	"optional-alias",
	".mcp.json",
	"launch.cjs",
])
	await cp(join("plugins/beads-viewer/claude-code", name), join(output, name), {
		recursive: true,
	});
for (const name of ["mcp.mjs", "prerequisites.cjs"]) {
	await cp(join("dist", name), join(output, "runtime", name));
	await cp(
		join("dist", name + ".LEGAL.txt"),
		join(output, "runtime", name + ".LEGAL.txt"),
	).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
}
await cp("dist/web", join(output, "runtime/web"), { recursive: true });
await cp("compatibility.json", join(output, "compatibility.json"));
await writeFile(
	join(output, "README.md"),
	(
		await readFile("plugins/beads-viewer/claude-code/README.md", "utf8")
	).replaceAll("../../../docs/claude-code/", ""),
);
for (const name of [
	"STATUS.md",
	"VERIFICATION.md",
	"PORTABLE_RUNTIME.md",
])
	await cp(join("docs/claude-code", name), join(output, name));
// Preserve old evidence in source; the new package includes only the current portable reports.
await cp(
	"docs/claude-code/evidence/portable",
	join(output, "evidence/portable"),
	{
		recursive: true,
		filter: (path) => basename(path) !== "package.log",
	},
);
const notices = join(output, "notices");
await mkdir(notices, { recursive: true });
await cp("LICENSE", join(notices, "Beads-Viewer-LICENSE.txt"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const used = new Set();
for (const input of Object.keys(meta.inputs)) {
	const match = /^(node_modules\/(?:@[^/]+\/)?[^/]+)/.exec(input);
	if (match) used.add(match[1]);
}
const components = [];
for (const path of [...used].sort()) {
	const entry = lock.packages[path];
	if (!entry)
		throw new Error("Missing lockfile entry for shipped library " + path);
	const name = path.slice("node_modules/".length);
	components.push({
		type: "library",
		name,
		version: entry.version,
		scope: "required",
		licenses: entry.license
			? [
					/^[A-Za-z0-9.+-]+$/.test(entry.license)
						? { license: { id: entry.license } }
						: { expression: entry.license },
				]
			: [{ license: { name: "NOASSERTION" } }],
		properties: entry.integrity
			? [{ name: "npm.integrity", value: entry.integrity }]
			: [],
	});
	for (const file of (await readdir(path)).filter((f) =>
		/^(licen[cs]e|notice|copying)/i.test(f),
	)) {
		if ((await stat(join(path, file))).isFile())
			await cp(
				join(path, file),
				join(notices, name.replaceAll("/", "-") + "-" + file),
			);
	}
}
// Vite records the packages actually contributing modules to its browser bundle.
const webInputs = JSON.parse(await readFile("dist/web.meta.json", "utf8"));
for (const name of webInputs.packages) {
	if (components.some((c) => c.name === name)) continue;
	const path = "node_modules/" + name,
		entry = lock.packages[path];
	if (!entry) throw new Error("Missing frontend lock entry " + name);
	components.push({
		type: "library",
		name,
		version: entry.version,
		scope: "required",
		licenses: entry.license
			? [{ license: { id: entry.license } }]
			: [{ license: { name: "NOASSERTION" } }],
		properties: entry.integrity
			? [{ name: "npm.integrity", value: entry.integrity }]
			: [],
	});
	for (const file of (await readdir(path)).filter((f) =>
		/^(licen[cs]e|notice|copying)/i.test(f),
	))
		if ((await stat(join(path, file))).isFile())
			await cp(
				join(path, file),
				join(notices, name.replaceAll("/", "-") + "-" + file),
			);
}
const stamp = new Date().toISOString();
await writeFile(
	join(output, "sbom.cdx.json"),
	JSON.stringify(
		{
			bomFormat: "CycloneDX",
			specVersion: "1.6",
			version: 1,
			metadata: {
				timestamp: stamp,
				component: {
					type: "application",
					name: "Beads Viewer Claude Code plugin",
					version: pkg.version,
				},
			},
			components,
		},
		null,
		2,
	),
);
await writeFile(
	join(output, "package-manifest.json"),
	JSON.stringify(
		{
			schemaVersion: 1,
			name: identity.name,
			host: "claude-code",
			version: pkg.version,
			distribution: policy.distribution,
			status: "experimental",
			builtAt: stamp,
			prerequisites: policy.prerequisites,
			externalDependencies: ["Node.js", "Beads"],
			bundledExecutables: [],
			releaseGates: policy.releaseGates,
		},
		null,
		2,
	),
);
const sha = async (path) =>
	createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
const files = await filesIn(output);
await writeFile(
	join(output, "SHA256SUMS.txt"),
	(
		await Promise.all(
			files.map(async (f) => `${await sha(f.path)}  ${f.relative}`),
		)
	)
		.sort()
		.join("\n") + "\n",
);
const breakdown = {};
for (const f of await filesIn(output)) {
	const key = f.relative.startsWith("runtime/web/")
		? "Frontend"
		: f.relative.startsWith("runtime/")
			? "MCP/backend"
			: f.relative.startsWith("notices/")
				? "Notices"
				: "Metadata/skills";
	breakdown[key] = (breakdown[key] || 0) + f.bytes;
}
const archive = output + ".zip";
await writeZip(output, archive);
await writeFile(
	archive + ".sha256",
	`${await sha(archive)}  ${basename(archive)}\n`,
);
const sizes = {
	distribution: policy.distribution,
	uncompressedBytes: (await filesIn(output)).reduce((n, f) => n + f.bytes, 0),
	compressedBytes: (await stat(archive)).size,
	components: breakdown,
};
await writeFile(output + "-sizes.json", JSON.stringify(sizes, null, 2));
const marketplace = resolve("artifacts", "beads-viewer-local-marketplace");
const plugin = join(marketplace, "plugins/beads-viewer/claude-code");
await mkdir(dirname(plugin), { recursive: true });
await rm(plugin, { recursive: true, force: true });
await cp(output, plugin, { recursive: true });
await mkdir(join(marketplace, ".claude-plugin"), { recursive: true });
await writeFile(
	join(marketplace, ".claude-plugin/marketplace.json"),
	JSON.stringify(
		{
			name: "beads-viewer-local",
			description:
				"Local Beads Viewer builds using installed Node.js and Beads.",
			owner: { name: "Beads Viewer contributors" },
			plugins: [
				{
					name: identity.name,
					source: "./plugins/beads-viewer/claude-code",
					description:
						"Experimental portable plugin; requires installed Node.js and Beads.",
				},
			],
		},
		null,
		2,
	),
);
console.log(
	JSON.stringify(
		{ directory: output, archive, marketplace, ...sizes },
		null,
		2,
	),
);
