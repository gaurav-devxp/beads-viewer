import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { filesIn } from "./lib/archive.mjs";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const root = resolve(
	process.argv[2] || `artifacts/beads-viewer-${version}-claude-code`,
);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sums = (await readFile(join(root, "SHA256SUMS.txt"), "utf8"))
	.trim()
	.split("\n");
const recorded = new Set();
for (const line of sums) {
	const split = line.indexOf("  "),
		expected = line.slice(0, split),
		path = line.slice(split + 2);
	assert.match(expected, /^[0-9a-f]{64}$/);
	assert.ok(!path.split("/").includes("..") && !path.startsWith("/"));
	recorded.add(path);
	assert.equal(sha(await readFile(join(root, path))), expected, path);
}
for (const file of await filesIn(root)) {
	assert.ok(
		file.relative === "SHA256SUMS.txt" || recorded.has(file.relative),
		"Unchecked file: " + file.relative,
	);
	assert.ok(
		!/(^|\/)(node_modules|tests|src|launcher|\.git)(\/|$)/.test(file.relative),
		file.relative,
	);
	assert.ok(!/\.(exe|dll|dylib|so|node)$/i.test(file.relative), file.relative);
	assert.ok(
		!/(^|\/)(node|bd|dolt)(\.exe)?$/i.test(file.relative),
		file.relative,
	);
	const bytes = await readFile(file.path);
	const magic = bytes.subarray(0, 4).toString("hex");
	assert.ok(
		![
			"7f454c46",
			"cffaedfe",
			"feedfacf",
			"cefaedfe",
			"feedface",
			"cafebabe",
		].includes(magic) && bytes.subarray(0, 2).toString() !== "MZ",
		"Native executable: " + file.relative,
	);
}
for (const file of [
	"launch.cjs",
	"compatibility.json",
	"runtime/prerequisites.cjs",
	"runtime/mcp.mjs",
	"runtime/web/index.html",
	".mcp.json",
	".claude-plugin/plugin.json",
	"skills/open/SKILL.md",
	"sbom.cdx.json",
	"package-manifest.json",
])
	assert.ok((await stat(join(root, file))).isFile(), file);
const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));
assert.equal(mcp.mcpServers["beads-viewer"].command, "node");
assert.deepEqual(mcp.mcpServers["beads-viewer"].args, [
	"${CLAUDE_PLUGIN_ROOT}/launch.cjs",
]);
const manifest = JSON.parse(
	await readFile(join(root, "package-manifest.json"), "utf8"),
);
assert.equal(manifest.distribution, "portable-prebuilt-javascript");
assert.deepEqual(manifest.bundledExecutables, []);
assert.deepEqual(manifest.externalDependencies, ["Node.js", "Beads"]);
const sbom = JSON.parse(await readFile(join(root, "sbom.cdx.json"), "utf8"));
assert.equal(sbom.bomFormat, "CycloneDX");
assert.ok(sbom.components.length > 5);
assert.ok(
	!sbom.components.some(
		(c) =>
			c.name === "Node.js" ||
			c.name === "Beads" ||
			c.name.startsWith("github.com/"),
	),
);
const archive = root + ".zip",
	archiveBytes = await readFile(archive);
assert.equal(
	sha(archiveBytes),
	(await readFile(archive + ".sha256", "utf8")).split("  ")[0],
);
const result = {
	artifact: basename(archive),
	filesVerified: recorded.size,
	checksums: "PASS",
	portableLayout: "PASS",
	bundledNativeExecutables: 0,
	installedNodeConfig: "PASS",
	sbom: "JSON parsed; schema/license audit remains a release check",
	platformExecution:
		"See separate native test records; layout is not execution proof",
};
await writeFile(
	"docs/claude-code/evidence/portable/package-verification.json",
	JSON.stringify(result, null, 2),
);
console.log(result);
