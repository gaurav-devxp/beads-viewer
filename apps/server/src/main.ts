import { resolve } from "node:path";
import { startRuntime } from "./runtime.ts";
const runtime = await startRuntime({
	port: Number(process.env.BV_PORT || 4173),
	webRoot: process.env.BV_WEB_ROOT || resolve("dist/web"),
});
// Contributor launch is explicitly disconnected from Claude. No artificial AI output.
const options = { repositories: process.argv.slice(2), openBrowser: false };
const result = await runtime.app.open("development-no-host", options);
runtime.app.bridge.disconnect(
	result.connection.id,
	"Contributor server has no invoking host. Use the Claude plugin for AI.",
);
console.log(`Beads Viewer (contributor mode): ${result.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		void runtime.close().then(() => process.exit(0));
	});
