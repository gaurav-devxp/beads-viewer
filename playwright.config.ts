import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests/browser",
	workers: 1,
	timeout: 60000,
	retries: 0,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		headless: true,
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
	},
	projects: [
		{ name: "chromium-desktop" },
		{
			name: "chromium-mobile",
			use: {
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
		},
	],
});
