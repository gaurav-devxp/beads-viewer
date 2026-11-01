import { editable, type Task, type SummaryContent } from "@bv/contracts";
export const task: Task = {
	...editable.parse({ title: "Source" }),
	id: "same-1",
	workspaceId: "workspaceA",
	repositoryId: "repoA",
	databaseId: "databaseA",
	project: "Unspecified",
	revision: "a".repeat(64),
	created_at: "",
	updated_at: "",
	ready: true,
	blocked: false,
	dependencies: [],
	dependents: [],
	comments: [],
	raw: { title: "Source" },
};
export const summary: SummaryContent = {
	schemaVersion: 1,
	promptVersion: "briefing-1",
	blocks: (
		[
			"overview",
			"state",
			"checklist",
			"blockers",
			"decisions",
			"suggestions",
			"questions",
		] as const
	).map((kind) => ({
		id: kind,
		kind,
		title: kind,
		text:
			kind === "overview"
				? "Source briefing"
				: "No additional source facts supplied.",
		sources: [{ kind: "field", id: "title" }],
	})),
	omissions: [],
};
