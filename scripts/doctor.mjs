import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try {
	const { checkDependencies } = require("../dist/prerequisites.cjs");
	console.log(
		JSON.stringify({ ok: true, ...(await checkDependencies()) }, null, 2),
	);
} catch (error) {
	console.error(
		error.code === "MODULE_NOT_FOUND"
			? "Beads Viewer: prebuilt prerequisite checker is missing; run npm run build first."
			: `Beads Viewer [${error.code || "CHECK_FAILED"}]: ${error.message}`,
	);
	process.exitCode = 1;
}
