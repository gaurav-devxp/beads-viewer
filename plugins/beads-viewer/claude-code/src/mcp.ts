import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	startRuntime,
	openBrowser,
} from "../../../../apps/server/src/runtime.ts";
import { createViewerServer } from "./server.ts";
const { mcp, close } = createViewerServer({ startRuntime, openBrowser });
await mcp.connect(new StdioServerTransport());
process.stdin.on("end", () => {
	void close().then(() => process.exit(0));
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		void close().then(() => process.exit(0));
	});
