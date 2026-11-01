import type { Snapshot, Detail } from "@bv/contracts";
let csrf = "";
let connectionId = new URL(location.href).searchParams.get("connection") || "";
export async function api<T>(
	path: string,
	method = "GET",
	data?: unknown,
	key: string = crypto.randomUUID(),
): Promise<T> {
	const response = await fetch("/api" + path, {
		method,
		credentials: "same-origin",
		headers: {
			"X-BV-Connection": connectionId,
			...(method === "GET"
				? {}
				: {
						"Content-Type": "application/json",
						"X-BV-CSRF": csrf,
						"Idempotency-Key": key,
					}),
		},
		body: data === undefined ? undefined : JSON.stringify(data),
	});
	const body = await response.json();
	if (!response.ok)
		throw new Error(body.error || `Request failed (${response.status})`);
	return body;
}
export async function authenticate(): Promise<{ connectionId: string }> {
	const fragment = new URLSearchParams(location.hash.slice(1)),
		credential = fragment.get("launch");
	// Remove one-time credential before any API request, leaving paths/preferences out of the URL.
	if (credential) {
		history.replaceState(null, "", location.pathname + location.search);
		const result = await api<{
			csrf: string;
			connectionId: string;
			filters: Record<string, string>;
		}>("/exchange", "POST", { credential });
		csrf = result.csrf;
		connectionId = result.connectionId;
		const url = new URL(location.href);
		url.searchParams.set("connection", connectionId);
		for (const [k, v] of Object.entries(result.filters))
			url.searchParams.set(k, v);
		history.replaceState(null, "", url.pathname + url.search);
		window.dispatchEvent(new PopStateEvent("popstate"));
	} else
		csrf = (
			await api<{
				csrf: string;
			}>("/session")
		).csrf;
	return { connectionId };
}
export const snapshot = () => api<Snapshot>("/snapshot");
export const detail = (workspace: string, task: string) =>
	api<Detail>(
		`/tasks/${encodeURIComponent(workspace)}/${encodeURIComponent(task)}`,
	);
