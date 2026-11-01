import { execFile, type ChildProcess } from "node:child_process";
import { realpath, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { userInfo } from "node:os";
import {
	editable,
	id,
	type Repository,
	type Task,
	type Editable,
	type Relation,
} from "@bv/contracts";
import {
	compatibility,
	parseBeadsVersion,
	type Command,
} from "@bv/prerequisites";
export class AppError extends Error {
	constructor(
		public code: number,
		message: string,
	) {
		super(message);
	}
}
export const hash = (s: unknown) =>
	createHash("sha256")
		.update(typeof s === "string" ? s : JSON.stringify(s))
		.digest("hex");
export type Runner = ((args: string[], cwd: string) => Promise<string>) & {
	dispose?: () => void;
};
export function runner(
	binary: string | Command,
	extraEnv: NodeJS.ProcessEnv = {},
): Runner {
	const children = new Set<ChildProcess>();
	const command =
		typeof binary === "string"
			? { executable: binary, prefixArgs: [] }
			: binary;
	const run: Runner = (args, cwd) =>
		new Promise((resolve, reject) => {
			const env = { ...process.env, ...extraEnv };
			for (const k of Object.keys(env))
				if (/^(BEADS_|BD_)/.test(k)) delete env[k];
			// Never implicitly sync, push, or run an external Dolt service.
			const readOnly =
				["where", "list", "show", "ready", "blocked", "info"].includes(
					args[0],
				) ||
				(args[0] === "comments" && args[1] !== "add");
			const child = execFile(
				command.executable,
				[
					...command.prefixArgs,
					...(readOnly ? ["--readonly"] : []),
					"--sandbox",
					"--dolt-auto-commit",
					"off",
					"--actor",
					`viewer:${userInfo().username}`,
					...args,
				],
				{
					cwd,
					env,
					timeout: 20000,
					maxBuffer: 16 * 1024 * 1024,
					shell: false,
					windowsHide: true,
				},
				(error, out, err) => {
					children.delete(child);
					if (error) {
						reject(
							new AppError(
								error.killed ? 504 : 422,
								`Beads ${args[0]} failed: ${(err || error.message).slice(0, 1800)}`,
							),
						);
						return;
					}
					resolve(out);
				},
			);
			children.add(child);
		});
	run.dispose = () => {
		for (const child of children) child.kill("SIGTERM");
	};
	return run;
}
function parseJSON(s: string) {
	try {
		return JSON.parse(s);
	} catch {
		throw new AppError(
			502,
			"Beads returned invalid or unsupported JSON; no data was modified by the viewer.",
		);
	}
}
function listJSON(s: string): any[] {
	const x = parseJSON(s);
	if (!Array.isArray(x))
		throw new AppError(502, "Unsupported Beads response; expected an array");
	return x;
}
export class BeadsAdapter {
	private checked = false;
	constructor(readonly run: Runner) {}
	close() {
		this.run.dispose?.();
	}
	async capabilities(cwd: string) {
		if (this.checked) return;
		const v = await this.run(["version"], cwd);
		try {
			parseBeadsVersion(v);
		} catch (error) {
			throw new AppError(422, (error as Error).message);
		}
		for (const [command, flags] of Object.entries(
			compatibility.prerequisites.beads.requiredFlags,
		)) {
			const help = await this.run([command, "--help"], cwd);
			if (flags.some((f) => !help.includes(f)))
				throw new AppError(
					422,
					`Unsupported Beads capabilities for ${command}`,
				);
		}
		this.checked = true;
	}
	async discover(
		path: string,
		projectPrefix = "project:",
	): Promise<Repository> {
		const root = await realpath(path);
		await stat(join(root, ".beads")).catch(() => {
			throw new AppError(
				422,
				"Choose a repository with its own .beads workspace. The viewer never initializes storage.",
			);
		});
		await this.capabilities(root);
		const w = parseJSON(await this.run(["where", "--json"], root));
		if (
			w.schema_version !== compatibility.prerequisites.beads.recordSchemaVersion
		)
			throw new AppError(
				422,
				"Unverified Beads schema version; automatic migration is disabled.",
			);
		const beadsPath = await realpath(w.path),
			databasePath = await realpath(w.database_path);
		const meta = JSON.parse(
			await readFile(join(beadsPath, "metadata.json"), "utf8"),
		);
		if (
			meta.backend !== compatibility.prerequisites.beads.backend ||
			meta.dolt_mode !== compatibility.prerequisites.beads.storageMode
		)
			throw new AppError(
				422,
				"This build supports embedded Dolt only. External/server/legacy storage needs a verified adapter.",
			);
		await this.checkSchema(root);
		let repositoryRoot = root;
		try {
			const gitPath = join(root, ".git");
			const info = await stat(gitPath);
			let gitDir = info.isDirectory()
				? await realpath(gitPath)
				: resolve(
						root,
						(await readFile(gitPath, "utf8")).trim().replace(/^gitdir:\s*/, ""),
					);
			try {
				gitDir = await realpath(
					resolve(
						gitDir,
						(await readFile(join(gitDir, "commondir"), "utf8")).trim(),
					),
				);
			} catch {
				/* A main worktree has no commondir file */
			}
			repositoryRoot = gitDir;
		} catch {
			/* Beads also supports local non-Git directories */
		}
		const databaseId = hash(databasePath).slice(0, 24),
			workspaceId = hash(`${root}\0${databaseId}`).slice(0, 24);
		return {
			id: hash(repositoryRoot).slice(0, 24),
			workspaceId,
			databaseId,
			path: root,
			name: basename(root),
			beadsPath,
			projectPrefix,
			health: "healthy",
		};
	}
	private async checkSchema(root: string) {
		const output = await this.run(["info", "--schema", "--json"], root);
		if (
			!output
				.split(/\r?\n/)
				.some(
					(line) =>
						line.trim() ===
						`Schema Version: ${compatibility.prerequisites.beads.storageSchemaVersion}`,
				)
		)
			throw new AppError(
				422,
				"Unverified Beads storage schema. Automatic migration is disabled; inspect and migrate explicitly outside the viewer.",
			);
	}
	private async verify(r: Repository) {
		// Re-resolve before every operation so a replaced symlink cannot redirect a registered identity.
		if ((await realpath(r.path)) !== r.path)
			throw new AppError(409, "Registered root changed");
		const metadata = JSON.parse(
			await readFile(join(r.beadsPath, "metadata.json"), "utf8"),
		);
		if (
			metadata.backend !== compatibility.prerequisites.beads.backend ||
			metadata.dolt_mode !== compatibility.prerequisites.beads.storageMode
		)
			throw new AppError(
				409,
				"Registered storage mode changed; writes are disabled",
			);
		await this.checkSchema(r.path);
		const w = parseJSON(await this.run(["where", "--json"], r.path));
		if (
			hash(await realpath(w.database_path)).slice(0, 24) !== r.databaseId ||
			(await realpath(w.path)) !== r.beadsPath
		)
			throw new AppError(
				409,
				"Workspace storage changed. Re-register it explicitly before continuing.",
			);
	}
	private map(
		r: Repository,
		raw: any,
		ready: boolean,
		comments: any[] = raw.comments || [],
	): Task {
		if (!raw || typeof raw !== "object")
			throw new AppError(502, "Missing task source");
		id.parse(raw.id);
		const data = editable.parse({
			title: raw.title,
			description: raw.description || "",
			status: raw.status,
			priority: raw.priority,
			issue_type: raw.issue_type,
			assignee: raw.assignee || "",
			labels: raw.labels || [],
			design: raw.design || "",
			notes: raw.notes || "",
			acceptance_criteria: raw.acceptance_criteria || "",
		});
		const relations = (rs: any[]): Relation[] =>
			(rs || []).map((x) => ({
				id: x.depends_on_id || x.id || x.issue_id,
				type: x.dependency_type || x.type || "blocks",
				title: x.title,
				status: x.status,
			}));
		const source = { ...raw, comments };
		return {
			...data,
			id: raw.id,
			workspaceId: r.workspaceId,
			repositoryId: r.id,
			databaseId: r.databaseId,
			project:
				data.labels
					.find((l) => l.startsWith(r.projectPrefix))
					?.slice(r.projectPrefix.length) || "Unspecified",
			revision: hash(source),
			created_at: raw.created_at || "",
			updated_at: raw.updated_at || "",
			ready,
			blocked:
				raw.status === "blocked" ||
				(raw.dependencies || []).some(
					(d: any) =>
						(d.dependency_type || d.type) === "blocks" && d.status !== "closed",
				),
			dependencies: relations(raw.dependencies),
			dependents: relations(raw.dependents),
			comments: comments.map((c) => ({
				id: c.id,
				author: c.author || "Unrecorded",
				text: c.text || "",
				created_at: c.created_at || "",
			})),
			raw: source,
		};
	}
	async list(r: Repository): Promise<Task[]> {
		await this.verify(r);
		const rows = listJSON(
			await this.run(
				[
					"list",
					"--all",
					"--limit",
					"0",
					"--include-infra",
					"--include-gates",
					"--include-templates",
					"--json",
				],
				r.path,
			),
		);
		const ready = new Set(
			listJSON(await this.run(["ready", "--limit", "0", "--json"], r.path)).map(
				(x) => x.id,
			),
		);
		const blocked = new Set(
			listJSON(await this.run(["blocked", "--json"], r.path)).map((x) => x.id),
		);
		return rows.map((x) => ({
			...this.map(r, x, ready.has(x.id)),
			blocked: blocked.has(x.id) || x.status === "blocked",
		}));
	}
	async detail(r: Repository, taskId: string): Promise<Task> {
		id.parse(taskId);
		await this.verify(r);
		const rows = listJSON(
			await this.run(
				[
					"show",
					taskId,
					"--include-comments",
					"--include-dependents",
					"--long",
					"--json",
				],
				r.path,
			),
		);
		if (rows.length !== 1 || rows[0].id !== taskId)
			throw new AppError(404, "Task not found");
		const comments = listJSON(
			await this.run(["comments", taskId, "--json"], r.path),
		);
		const ready = listJSON(
			await this.run(["ready", "--limit", "0", "--json"], r.path),
		).some((x) => x.id === taskId);
		return this.map(r, rows[0], ready, comments);
	}
	async create(r: Repository, input: Editable) {
		await this.verify(r);
		const e = editable.parse(input);
		const args = [
			"create",
			"--title",
			e.title,
			"--description",
			e.description,
			"--type",
			e.issue_type,
			"--priority",
			String(e.priority),
			"--assignee",
			e.assignee,
			"--labels",
			e.labels.join(","),
			"--design",
			e.design,
			"--notes",
			e.notes,
			"--acceptance",
			e.acceptance_criteria,
			"--json",
		];
		if (e.status !== "open")
			throw new AppError(
				422,
				"New tasks start open. Change status after creation.",
			);
		const result = parseJSON(await this.run(args, r.path));
		return this.detail(r, result.id);
	}
	async update(
		r: Repository,
		taskId: string,
		input: Editable,
		revision: string,
	) {
		const current = await this.detail(r, taskId);
		if (current.revision !== revision)
			throw new AppError(
				409,
				"This task changed outside your draft. Your draft is preserved. Reload source and review before saving.",
			);
		const e = editable.parse(input),
			args = [
				"update",
				taskId,
				"--title",
				e.title,
				"--description",
				e.description,
				"--type",
				e.issue_type,
				"--priority",
				String(e.priority),
				"--status",
				e.status,
				"--assignee",
				e.assignee,
				...(e.labels.length
					? ["--set-labels", e.labels.join(",")]
					: current.labels.flatMap((l) => ["--remove-label", l])),
				"--design",
				e.design,
				"--notes",
				e.notes,
				"--acceptance",
				e.acceptance_criteria,
				"--json",
			];
		await this.run(args, r.path);
		return this.detail(r, taskId);
	}
	async comment(r: Repository, taskId: string, value: string) {
		id.parse(taskId);
		await this.verify(r);
		await this.run(
			[
				"comments",
				"add",
				taskId,
				"--author",
				`Local ${userInfo().username}`,
				"--json",
				"--",
				value,
			],
			r.path,
		);
		return listJSON(await this.run(["comments", taskId, "--json"], r.path));
	}
	async dependency(
		r: Repository,
		taskId: string,
		target: string,
		remove = false,
	) {
		id.parse(taskId);
		id.parse(target);
		await this.verify(r);
		await this.run(
			["dep", remove ? "remove" : "add", taskId, target, "--json"],
			r.path,
		);
		return this.detail(r, taskId);
	}
	async delete(
		r: Repository,
		taskId: string,
		revision: string,
		confirm: string,
	) {
		if (confirm !== taskId)
			throw new AppError(
				422,
				"Type the exact task ID to confirm permanent deletion",
			);
		const t = await this.detail(r, taskId);
		if (t.revision !== revision)
			throw new AppError(409, "Task changed; review deletion again");
		if (t.dependencies.length || t.dependents.length)
			throw new AppError(
				409,
				"Deletion blocked: remove and review relationships explicitly first. No cascading deletion is supported.",
			);
		await this.run(["delete", taskId, "--force", "--json"], r.path);
		return { deleted: taskId };
	}
}
