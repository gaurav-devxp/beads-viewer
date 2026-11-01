import { build } from "esbuild";
import { build as vite } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const [entry, outfile] of [
	["apps/server/src/main.ts", "dist/server.mjs"],
	["plugins/beads-viewer/claude-code/src/mcp.ts", "dist/mcp.mjs"],
]) {
	const result = await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		platform: "node",
		target: "node24",
		format: "esm",
		packages: "bundle",
		banner: {
			js: 'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);',
		},
		sourcemap: false,
		metafile: true,
		legalComments: "linked",
	});
	await writeFile(
		outfile + ".meta.json",
		JSON.stringify(result.metafile, null, 2),
	);
}
await build({
	entryPoints: ["packages/prerequisites/src/index.ts"],
	outfile: "dist/prerequisites.cjs",
	bundle: true,
	platform: "node",
	target: "node18",
	format: "cjs",
	define: { "import.meta.url": "__PREREQUISITE_MODULE_URL__" },
	banner: {
		js: 'const __PREREQUISITE_MODULE_URL__ = require("node:url").pathToFileURL(__filename).href;',
	},
	sourcemap: false,
	legalComments: "linked",
});
await vite({ configFile: "apps/web/vite.config.ts" });
