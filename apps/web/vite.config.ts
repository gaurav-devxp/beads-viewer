import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "shipped-package-inventory",
			apply: "build",
			async generateBundle() {
				const packages = [
					...new Set(
						[...this.getModuleIds()].flatMap((id) => {
							const match =
								/(?:^|[/\\])node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/.exec(
									id,
								);
							return match ? [match[1].replaceAll("\\", "/")] : [];
						}),
					),
				].sort();
				const output = new URL("../../dist/web.meta.json", import.meta.url);
				await mkdir(new URL("../../dist", import.meta.url), {
					recursive: true,
				});
				await writeFile(
					output,
					JSON.stringify(
						{ packages: [...new Set([...packages, "tailwindcss"])] },
						null,
						2,
					),
				);
			},
		},
	],
	build: { outDir: "../../dist/web", emptyOutDir: true },
	resolve: {
		alias: {
			"@bv/contracts": fileURLToPath(
				new URL("../../packages/contracts/src/index.ts", import.meta.url),
			),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:4173",
				changeOrigin: true,
				configure: (proxy) =>
					proxy.on("proxyReq", (request) =>
						request.setHeader("Origin", "http://127.0.0.1:4173"),
					),
			},
		},
	},
});
