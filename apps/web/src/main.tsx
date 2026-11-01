import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
	useQueryClient,
	useMutation,
} from "@tanstack/react-query";
import {
	Layers,
	Search,
	Plus,
	X,
	Circle,
	CheckCircle2,
	ArrowUpRight,
	Moon,
	Sun,
	MessageSquare,
	SlidersHorizontal,
	ChevronRight,
	ChevronLeft,
	RefreshCw,
	Link2,
	FolderGit2,
	Bot,
	AlertCircle,
} from "lucide-react";
import {
	editable,
	taskEditable,
	filterTasks,
	canonical,
	markdownText,
	markdownTree,
	locate,
	type Task,
	type Editable,
	type Repository,
	type Summary,
	type MarkdownNode,
	type Anchor,
	type Thread,
	type Filters,
	type ConnectionState,
	type AIRequest,
} from "@bv/contracts";
import { api, authenticate, snapshot, detail } from "./api";
import { useUI } from "./state";
import "./styles.css";
const client = new QueryClient({
	defaultOptions: {
		queries: { retry: 1, staleTime: 15000 },
		mutations: { retry: false },
	},
});
const statusName = (s: string) => s.replaceAll("_", " ");
const date = (s: string) => (s ? new Date(s).toLocaleString() : "Not recorded");
const taskKey = (t: { workspaceId: string; id: string }) =>
	`${t.workspaceId}/${t.id}`;
function useURL() {
	const [search, setSearch] = useState(location.search);
	useEffect(() => {
		const pop = () => setSearch(location.search);
		window.addEventListener("popstate", pop);
		return () => window.removeEventListener("popstate", pop);
	}, []);
	const update = useCallback(
		(values: Record<string, string | null>, replace = false) => {
			const u = new URL(location.href);
			for (const [k, v] of Object.entries(values)) {
				if (v) u.searchParams.set(k, v);
				else if (k !== "connection") u.searchParams.delete(k);
			}
			history[replace ? "replaceState" : "pushState"](
				null,
				"",
				u.pathname + u.search,
			);
			setSearch(u.search);
		},
		[],
	);
	return { filters: Object.fromEntries(new URLSearchParams(search)), update };
}
function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
	return (
		<div className="error" role="alert">
			<AlertCircle size={16} />
			<span>{error instanceof Error ? error.message : String(error)}</span>
			{retry && <button onClick={retry}>Retry</button>}
		</div>
	);
}
function App() {
	const auth = useQuery({
		queryKey: ["auth"],
		queryFn: authenticate,
		retry: false,
		staleTime: Infinity,
	});
	const { filters, update } = useURL();
	const data = useQuery({
		queryKey: ["snapshot"],
		queryFn: snapshot,
		enabled: auth.isSuccess,
		refetchInterval: 20000,
	});
	const scope =
		filters.workspaceId ||
		"aggregate:" +
			(data.data?.repositories
				.map((r) => r.workspaceId)
				.sort()
				.join(",") || "pending");
	const [liveDisconnected, setLiveDisconnected] = useState(false);
	const ui = useUI();
	useEffect(() => ui.load(scope), [scope]);
	useEffect(() => {
		document.documentElement.dataset.theme = ui.theme;
		document.documentElement.dataset.density = ui.density;
	}, [ui.theme, ui.density]);
	useEffect(() => {
		if (!auth.isSuccess) return;
		const events = new EventSource(
			"/api/events?connection=" +
				encodeURIComponent(
					new URL(location.href).searchParams.get("connection") || "",
				),
		);
		events.onopen = () => setLiveDisconnected(false);
		events.onerror = () => setLiveDisconnected(true);
		events.addEventListener("invalidate", () => {
			void client.invalidateQueries({ queryKey: ["snapshot"] });
			void client.invalidateQueries({ queryKey: ["detail"] });
		});
		return () => events.close();
	}, [auth.isSuccess]);
	const [newTask, setNewTask] = useState(false),
		[addRepo, setAddRepo] = useState(false),
		[showFilters, setShowFilters] = useState(false),
		[page, setPage] = useState(0),
		[group, setGroup] = useState("none");
	const searchRef = useRef<HTMLInputElement>(null),
		newRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				(e.key === "k" && (e.ctrlKey || e.metaKey)) ||
				(e.key === "/" &&
					!/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName))
			) {
				e.preventDefault();
				searchRef.current?.focus();
			}
			if (
				e.key === "n" &&
				!/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) &&
				!filters.task
			) {
				e.preventDefault();
				setNewTask(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [filters.task]);
	const tasks = data.data?.tasks || [],
		repositories = data.data?.repositories || [];
	const filterIdentity = JSON.stringify(
		Object.fromEntries(
			Object.entries(filters).filter(
				([key]) => !["task", "workspace", "tab", "connection"].includes(key),
			),
		),
	);
	const filtered = useMemo(() => {
		const result = filterTasks(tasks, filters);
		if (group !== "none")
			result.sort((a, b) =>
				String(a[group as keyof Task]).localeCompare(
					String(b[group as keyof Task]),
				),
			);
		return result;
	}, [tasks, filterIdentity, group]);
	useEffect(() => setPage(0), [filterIdentity, group]);
	const toggle = (key: string, value: string) => {
		const values = (filters[key] || "").split(",").filter(Boolean);
		update({
			[key]: values.includes(value)
				? values.filter((v) => v !== value).join(",")
				: [...values, value].join(","),
		});
	};
	const saveView = () => {
		const name = prompt("Name this saved view");
		if (!name) return;
		const stored = JSON.parse(
			localStorage.getItem(`beads-views:${scope}`) || "{}",
		);
		const f = { ...filters };
		delete f.task;
		delete f.workspace;
		delete f.tab;
		delete f.connection;
		stored[name] = f;
		localStorage.setItem(`beads-views:${scope}`, JSON.stringify(stored));
		setViews(stored);
	};
	const [views, setViews] = useState<Record<string, Filters>>({});
	useEffect(() => {
		try {
			setViews(
				JSON.parse(localStorage.getItem(`beads-views:${scope}`) || "{}"),
			);
		} catch {
			setViews({});
		}
	}, [scope]);
	const allActive = Object.entries(filters).filter(
		([k, v]) =>
			v &&
			[
				"q",
				"workspaceId",
				"project",
				"status",
				"priority",
				"issue_type",
				"assignee",
				"labels",
				"readiness",
			].includes(k),
	);
	// Rows per page: "auto" fits the rows that the visible table area can show at
	// this resolution, so the pinned pagination bar never needs scrolling to reach.
	const tableRef = useRef<HTMLDivElement>(null);
	const [pageSizeSetting, setPageSizeSetting] = useState(() => {
		try {
			return localStorage.getItem("beads-viewer:page-size") || "auto";
		} catch {
			return "auto";
		}
	});
	const [fitRows, setFitRows] = useState(25);
	useEffect(() => {
		const element = tableRef.current;
		if (!element) return;
		const measure = () => {
			const head =
				element.querySelector<HTMLElement>(".table-head")?.offsetHeight || 34;
			const row =
				element.querySelector<HTMLElement>(".task-row")?.offsetHeight || 40;
			const available = element.clientHeight - head;
			// Narrow screens scroll the page instead of the table: use a fixed size.
			const limited = getComputedStyle(element).overflowY === "auto";
			setFitRows(
				limited && available > 0 ? Math.max(5, Math.floor(available / row)) : 25,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ui.density, data.isPending, group]);
	const pageSize =
		pageSizeSetting === "auto" ? fitRows : Number(pageSizeSetting) || 25;
	const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
	useEffect(() => {
		if (page >= pages) setPage(pages - 1);
	}, [page, pages]);
	const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);
	if (auth.isError)
		return (
			<main className="gate">
				<Layers size={36} />
				<h1>Beads Viewer</h1>
				<ErrorBox error={auth.error} retry={() => void auth.refetch()} />
				<p>
					Open this workspace from Claude Code with{" "}
					<code>/beads-viewer:open</code>. Each launch link works once.
				</p>
			</main>
		);
	return (
		<div className="app-shell">
			<aside className="sidebar">
				<a
					className="brand"
					href="/"
					onClick={(e) => {
						e.preventDefault();
						update(
							Object.fromEntries(Object.keys(filters).map((k) => [k, null])),
						);
					}}
				>
					<span className="brand-mark">
						<Layers size={20} />
					</span>
					<span>
						Beads Viewer<small>LOCAL WORKSPACE</small>
					</span>
				</a>
				<div className="workspace-card">
					<span className="avatar">B</span>
					<span>
						<strong>Your workspace</strong>
						<small>{repositories.length} repositories connected</small>
					</span>
					<ChevronRight size={15} />
				</div>
				<div className="nav-label">WORKSPACE</div>
				<nav aria-label="Task views">
					{[
						["All tasks", "", Circle],
						["Ready", "ready", CheckCircle2],
						["In progress", "in_progress", RefreshCw],
						["Blocked", "blocked", AlertCircle],
						["Closed", "closed", CheckCircle2],
					].map(([title, value, Icon]: any) => {
						const f: Filters =
							value === "ready"
								? { readiness: "ready" }
								: value === "blocked"
									? { readiness: "blocked" }
									: value
										? { status: value }
										: {};
						const count = filterTasks(tasks, {
							workspaceId: filters.workspaceId || "",
							...f,
						}).length;
						const active = !value
							? !filters.status && !filters.readiness
							: filters.status === value || filters.readiness === value;
						return (
							<button
								className={active ? "nav-item active" : "nav-item"}
								key={title}
								onClick={() => update({ status: null, readiness: null, ...f })}
							>
								<Icon size={16} />
								{title}
								<span className="count">{count}</span>
							</button>
						);
					})}
				</nav>
				<div className="nav-label">
					REPOSITORIES
					<button aria-label="Add repository" onClick={() => setAddRepo(true)}>
						<Plus size={14} />
					</button>
				</div>
				<button
					className={!filters.workspaceId ? "repo selected" : "repo"}
					onClick={() => update({ workspaceId: null })}
				>
					<FolderGit2 size={16} />
					All repositories
				</button>
				{repositories.map((r) => (
					<button
						className={
							filters.workspaceId === r.workspaceId ? "repo selected" : "repo"
						}
						key={r.workspaceId}
						onClick={() => update({ workspaceId: r.workspaceId })}
						title={`${r.path}\n${r.health}`}
					>
						<span
							className={r.health === "healthy" ? "health" : "health bad"}
						/>
						<span>{r.name}</span>
						<span className="count">
							{tasks.filter((t) => t.workspaceId === r.workspaceId).length}
						</span>
					</button>
				))}
				<div className="nav-label">
					SAVED VIEWS
					<button aria-label="Save current view" onClick={saveView}>
						<Plus size={14} />
					</button>
				</div>
				{Object.entries(views).map(([name, f]) => (
					<button
						key={name}
						className="repo"
						onClick={() => {
							update({
								...Object.fromEntries(
									Object.keys(filters).map((k) => [k, null]),
								),
								...f,
							});
						}}
					>
						<SlidersHorizontal size={14} />
						{name}
					</button>
				))}
				<div className="sidebar-bottom">
					<span className="health" /> Stored on your machine
					<p>
						Task data stays in Beads.
						<br />
						Inline threads stay in this viewer.
					</p>
					<a
						href={
							"/api/export?connection=" +
							encodeURIComponent(filters.connection || "")
						}
						download
					>
						Export annotations
					</a>
					<label className="file-label">
						Import annotations
						<input
							type="file"
							accept="application/json"
							onChange={async (e) => {
								const file = e.target.files?.[0];
								if (!file) return;
								try {
									await api("/import", "POST", JSON.parse(await file.text()));
									await client.invalidateQueries();
								} catch (error) {
									alert(String(error));
								}
								e.target.value = "";
							}}
						/>
					</label>
				</div>
			</aside>
			<main className="workspace">
				<header className="topbar">
					<div className="breadcrumb">
						Workspace <ChevronRight size={14} />
						<strong>
							{repositories.find((r) => r.workspaceId === filters.workspaceId)
								?.name || "All repositories"}
						</strong>
					</div>
					<div className="top-actions">
						<button
							className="icon-button"
							aria-label="Toggle theme"
							onClick={() =>
								ui.setPreference(
									scope,
									"theme",
									ui.theme === "dark" ? "light" : "dark",
								)
							}
						>
							{ui.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
						</button>
						<button
							className="icon-button"
							aria-label="Toggle density"
							onClick={() =>
								ui.setPreference(
									scope,
									"density",
									ui.density === "compact" ? "comfortable" : "compact",
								)
							}
						>
							<SlidersHorizontal size={17} />
						</button>
						<span
							className={
								"host-pill " +
								(data.data?.connection.state === "connected" &&
								!liveDisconnected
									? "connected"
									: "")
							}
						>
							<Bot size={15} />
							{liveDisconnected
								? "Live updates lost"
								: data.data?.connection.state === "connected"
									? data.data.connection.delivery === "manual"
										? "Claude on request"
										: "Claude connected"
									: "AI disconnected"}
						</span>
					</div>
				</header>
				<section className="page-heading">
					<div className="title-row">
						<div>
							<h1>
								{filters.readiness === "ready"
									? "Ready to work"
									: filters.status
										? statusName(filters.status)
										: "All tasks"}{" "}
								<span>{filtered.length}</span>
							</h1>
						</div>
						<button
							className="primary"
							ref={newRef}
							onClick={() => setNewTask(true)}
						>
							<Plus size={17} />
							New task <kbd>N</kbd>
						</button>
					</div>
				</section>
				<div className="toolbar">
					<label className="search">
						<Search size={17} />
						<input
							ref={searchRef}
							aria-label="Search tasks"
							placeholder="Search tasks, IDs, descriptions, labels…"
							value={filters.q || ""}
							onChange={(e) => update({ q: e.target.value }, true)}
						/>
						<kbd>⌘ K</kbd>
					</label>
					<button
						className={showFilters ? "selected" : ""}
						onClick={() => setShowFilters(!showFilters)}
					>
						<SlidersHorizontal size={15} />
						Filters
						{allActive.length > 0 && (
							<span className="count">{allActive.length}</span>
						)}
					</button>
					<label className="select-label">
						Sort
						<select
							aria-label="Sort tasks"
							value={filters.sort || "updated_at"}
							onChange={(e) => update({ sort: e.target.value })}
						>
							<option value="updated_at">Updated</option>
							<option value="priority">Priority</option>
							<option value="title">Title</option>
							<option value="status">Status</option>
							<option value="id">ID</option>
						</select>
					</label>
					<button
						aria-label="Reverse sort"
						onClick={() =>
							update({
								direction: filters.direction === "asc" ? "desc" : "asc",
							})
						}
					>
						{filters.direction === "asc" ? "↑" : "↓"}
					</button>
					<label className="select-label">
						Group
						<select
							aria-label="Group tasks"
							value={group}
							onChange={(e) => setGroup(e.target.value)}
						>
							<option value="none">None</option>
							<option value="status">Status</option>
							<option value="project">Project</option>
							<option value="workspaceId">Repository</option>
						</select>
					</label>
					<button
						className="icon-button"
						aria-label="Refresh tasks"
						onClick={() => void data.refetch()}
					>
						<RefreshCw size={16} />
					</button>
				</div>
				{showFilters && (
					<div className="filter-panel">
						<p>
							OR within a facet; AND across facets. List and sidebar counts
							reflect their stated scope. Facet values include all loaded tasks.
						</p>
						{[
							["project", "Project"],
							["status", "Status"],
							["priority", "Priority"],
							["issue_type", "Type"],
							["assignee", "Assignee"],
							["labels", "Label"],
						].map(([key, title]) => {
							const values = [
								...new Set(
									tasks.flatMap((t) =>
										key === "labels"
											? t.labels
											: key === "assignee"
												? [t.assignee || "__none"]
												: [String(t[key as keyof Task])],
									),
								),
							].sort();
							if (key === "labels") values.push("__none");
							return (
								<fieldset key={key}>
									<legend>{title}</legend>
									{values.map((value) => (
										<label key={value}>
											<input
												type="checkbox"
												checked={(filters[key] || "")
													.split(",")
													.includes(value)}
												onChange={() => toggle(key, value)}
											/>
											{value === "__none"
												? key === "labels"
													? "Unlabeled"
													: "Unassigned"
												: value === "Unspecified"
													? "Unspecified project"
													: statusName(value)}
										</label>
									))}
								</fieldset>
							);
						})}
						<label>
							Labels match
							<select
								aria-label="Label matching"
								value={filters.labelMode || "any"}
								onChange={(e) => update({ labelMode: e.target.value })}
							>
								<option value="any">Any selected</option>
								<option value="all">All selected</option>
							</select>
						</label>
						<button onClick={saveView}>Save view</button>
					</div>
				)}
				{allActive.length > 0 && (
					<div className="active-chips">
						{allActive.map(([k, v]) => (
							<button
								key={k}
								className="filter-chip"
								onClick={() => update({ [k]: null })}
							>
								{k}:{" "}
								{k === "workspaceId"
									? repositories.find((r) => r.workspaceId === v)?.name || v
									: v}
								<X size={12} />
							</button>
						))}
						<button
							className="text-button"
							onClick={() =>
								update(Object.fromEntries(allActive.map(([k]) => [k, null])))
							}
						>
							Clear filters
						</button>
					</div>
				)}
				{data.isError && (
					<ErrorBox error={data.error} retry={() => void data.refetch()} />
				)}
				{data.data?.errors.map((e) => (
					<ErrorBox
						key={e.workspaceId}
						error={`${repositories.find((r) => r.workspaceId === e.workspaceId)?.name}: ${e.error}`}
						retry={() => void data.refetch()}
					/>
				))}
				<div
					className="task-table"
					aria-busy={data.isFetching}
					ref={tableRef}
				>
					<div className="table-head">
						<span>Task</span>
						<span>Repository / project</span>
						<span>Status</span>
						<span>Priority</span>
						<span>Assignee</span>
						<span>Updated</span>
					</div>
					{data.isPending &&
						Array.from({ length: 7 }, (_, i) => (
							<div className="skeleton-row" key={i}>
								<span />
								<span />
								<span />
							</div>
						))}
					{!data.isPending && !visible.length && (
						<div className="empty">
							<div className="empty-icon">
								<Layers size={30} />
							</div>
							<h2>
								{repositories.length
									? "A clear view starts here"
									: "Bring your work together"}
							</h2>
							<p>
								{repositories.length
									? "No tasks match this view. Adjust your filters or create a task."
									: "Select Beads repositories in Claude to start your local workspace."}
							</p>
							<button
								onClick={() =>
									repositories.length ? setNewTask(true) : setAddRepo(true)
								}
								className="primary"
							>
								<Plus size={16} />
								{repositories.length ? "Create task" : "Add repositories"}
							</button>
						</div>
					)}
					{visible.map((t, i) => (
						<React.Fragment key={taskKey(t)}>
							{group !== "none" &&
								(i === 0 ||
									t[group as keyof Task] !==
										visible[i - 1][group as keyof Task]) && (
									<div className="group-heading">
										{group === "workspaceId"
											? repositories.find(
													(r) => r.workspaceId === t.workspaceId,
												)?.name
											: String(t[group as keyof Task])}
									</div>
								)}
							<div className="task-row">
								<div className="task-main">
									<span className={"status-icon " + t.status}>
										{t.status === "closed" ? (
											<CheckCircle2 size={17} />
										) : (
											<Circle size={17} />
										)}
									</span>
									<div className="task-text">
										<button
											className="task-title"
											onClick={() =>
												update({
													task: t.id,
													workspace: t.workspaceId,
													tab: "agent",
												})
											}
										>
											{t.title}
										</button>
										<div className="task-sub">
											<code>{t.id}</code>
											<button
												className="tiny-chip"
												onClick={() => toggle("issue_type", t.issue_type)}
											>
												{t.issue_type}
											</button>
											{t.labels
												.filter((l) => !l.startsWith("project:"))
												.slice(0, 3)
												.map((l) => (
													<button
														className="tiny-chip"
														key={l}
														onClick={() => toggle("labels", l)}
													>
														{l}
													</button>
												))}
										</div>
									</div>
								</div>
								<div className="repo-cell">
									<button onClick={() => toggle("workspaceId", t.workspaceId)}>
										{
											repositories.find((r) => r.workspaceId === t.workspaceId)
												?.name
										}
									</button>
									<button
										className="muted"
										onClick={() => toggle("project", t.project)}
									>
										{t.project === "Unspecified"
											? "Unspecified project"
											: t.project}
									</button>
								</div>
								<button
									className={"status-chip " + t.status}
									onClick={() => toggle("status", t.status)}
								>
									<span />
									{statusName(t.status)}
								</button>
								<button
									className={"priority p" + t.priority}
									onClick={() => toggle("priority", String(t.priority))}
								>
									<span>{["▰", "▥", "▤", "▱", "―"][t.priority]}</span>P
									{t.priority}
								</button>
								<button
									className="assignee"
									onClick={() => toggle("assignee", t.assignee || "__none")}
								>
									{t.assignee ? (
										<>
											<span className="mini-avatar">
												{t.assignee.slice(0, 1).toUpperCase()}
											</span>
											{t.assignee}
										</>
									) : (
										<span className="muted">Unassigned</span>
									)}
								</button>
								<time title={date(t.updated_at)}>
									{t.updated_at
										? new Date(t.updated_at).toLocaleDateString(undefined, {
												month: "short",
												day: "numeric",
											})
										: "—"}
								</time>
							</div>
						</React.Fragment>
					))}
				</div>
				<footer className="list-footer">
					<div className="footer-status">
						<span>
							{filtered.length
								? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length}`
								: "0 tasks"}
							{" · "}
							{data.isFetching
								? "Refreshing…"
								: `Checked ${data.data?.observedAt ? new Date(data.data.observedAt).toLocaleTimeString() : "…"}`}
						</span>
						<span
							className={
								"connection-note" +
								(data.data?.connection.state === "connected" &&
								!liveDisconnected
									? " connected"
									: "")
							}
							title={
								liveDisconnected
									? "Live updates disconnected. Loaded task data may be stale; use Refresh to retry."
									: data.data?.connection.state === "connected"
										? data.data.connection.delivery === "manual"
											? "Human view shows a command to paste into the Claude conversation that opened this viewer."
											: "Opening a task's Human view asks the Claude conversation that opened this viewer for a briefing automatically."
										: data.data?.connection.reason ||
											"Not connected to Claude. Task editing and cached briefings still work."
							}
						>
							<Bot size={13} />
							{liveDisconnected
								? "Live updates lost"
								: data.data?.connection.state === "connected"
									? data.data.connection.delivery === "manual"
										? "Claude: briefings on request"
										: "Claude: automatic briefings"
									: "Claude not connected"}
						</span>
						{data.data?.viewerVersion && (
							<small className="viewer-version">
								Beads Viewer {data.data.viewerVersion}
							</small>
						)}
					</div>
					<div className="pager">
						<label className="page-size">
							Rows
							<select
								aria-label="Rows per page"
								value={pageSizeSetting}
								onChange={(e) => {
									setPageSizeSetting(e.target.value);
									setPage(0);
									try {
										localStorage.setItem(
											"beads-viewer:page-size",
											e.target.value,
										);
									} catch {
										/* Preference is optional */
									}
								}}
							>
								<option value="auto">Fit screen ({fitRows})</option>
								<option value="25">25</option>
								<option value="50">50</option>
								<option value="100">100</option>
							</select>
						</label>
						<button
							className="icon-button"
							aria-label="Previous page"
							disabled={page === 0}
							onClick={() => setPage((p) => p - 1)}
						>
							<ChevronLeft size={16} />
						</button>
						<span className="page-count">
							Page {page + 1} of {pages}
						</span>
						<button
							className="icon-button"
							aria-label="Next page"
							disabled={page + 1 >= pages}
							onClick={() => setPage((p) => p + 1)}
						>
							<ChevronRight size={16} />
						</button>
						{data.data?.connection.state === "connected" && (
							<button
								className="text-button"
								onClick={() =>
									void api("/disconnect", "POST", {}).then(() =>
										client.invalidateQueries(),
									)
								}
							>
								Disconnect
							</button>
						)}
					</div>
				</footer>
			</main>
			{filters.task && filters.workspace && (
				<TaskDialog
					key={`${filters.workspace}/${filters.task}`}
					workspace={filters.workspace}
					taskId={filters.task}
					tab={filters.tab === "human" ? "human" : "agent"}
					setTab={(tab) => update({ tab }, true)}
					repositories={repositories}
					connection={data.data?.connection}
					onOpen={(t) => update({ workspace: t.workspaceId, task: t.id })}
					onClose={() => update({ task: null, workspace: null, tab: null })}
				/>
			)}
			{newTask && (
				<NewTask
					repositories={repositories}
					onClose={() => {
						setNewTask(false);
						newRef.current?.focus();
					}}
					onCreated={(t) => {
						setNewTask(false);
						update({ workspace: t.workspaceId, task: t.id, tab: "agent" });
					}}
				/>
			)}
			{addRepo && (
				<Dialog
					title="Add Beads repositories"
					onClose={() => setAddRepo(false)}
				>
					<div className="onboarding">
						<FolderGit2 size={32} />
						<p>
							Choose repository paths explicitly through the invoking Claude
							conversation. The viewer never scans your home directory or
							accepts arbitrary browser paths.
						</p>
						<p>
							Launch a new viewer connection with all repositories you want to
							browse:
						</p>
						<pre>
							/beads-viewer:open{" "}
							{'{"repositories":["/path/to/first","/path/to/second"]}'}
						</pre>
						<p>
							Each repository must already contain a compatible embedded Beads
							workspace. Repositories remain separate from logical projects,
							which use <code>project:</code> labels by default.
						</p>
						{repositories.map((r) => (
							<div className="registered" key={r.workspaceId}>
								<strong>{r.name}</strong>
								<code>{r.path}</code>
								<small>{r.health}</small>
							</div>
						))}
					</div>
				</Dialog>
			)}
		</div>
	);
}
function useNow(active: boolean, every = 5000) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), every);
		return () => clearInterval(timer);
	}, [active, every]);
	return now;
}
// Automatic delivery normally starts within seconds; after this, offer the command.
const PICKUP_GRACE_MS = 45000;
function BriefingProgress({
	request,
	delivery,
	replacing,
	onCancel,
}: {
	request?: AIRequest;
	delivery: ConnectionState["delivery"] | undefined;
	replacing: boolean;
	onCancel?: () => void;
}) {
	const now = useNow(request?.state === "queued");
	const command = request
		? `/beads-viewer:brief ${JSON.stringify({ connectionId: request.connectionId, requestId: request.id })}`
		: "";
	const automatic = delivery === "channel" || delivery === "inbox";
	const waited = request ? now - (request.notifiedAt || request.createdAt) : 0;
	const needsCommand =
		!!request &&
		request.state === "queued" &&
		(!automatic ||
			!!request.deliveryError ||
			(!!request.notifiedAt && waited > PICKUP_GRACE_MS));
	const message = !request
		? "Asking Claude for a briefing…"
		: request.state === "running"
			? "Claude is writing the briefing…"
			: request.deliveryError
				? request.deliveryError
				: !automatic
					? "Waiting for Claude. Paste this command into the Claude conversation that opened this viewer:"
					: needsCommand
						? "Claude hasn't picked this up yet; it may be busy with another task and will start when free. To run it now, paste this command into that conversation:"
						: request.notifiedAt
							? "Sent to your Claude conversation. Waiting for Claude…"
							: "Asking Claude for a briefing…";
	return (
		<div
			className={"briefing-progress" + (replacing ? " compact" : "")}
			role="status"
			aria-live="polite"
		>
			<span className="spinner" aria-hidden="true" />
			<div className="briefing-delivery">
				<strong>
					{replacing ? "Updating briefing" : "Preparing briefing"}
				</strong>
				<p>{message}</p>
				{needsCommand && <BriefCommand command={command} />}
			</div>
			{onCancel && (
				<button className="text-button" onClick={onCancel}>
					Cancel
				</button>
			)}
		</div>
	);
}
function BriefCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="brief-command">
			<label>
				Claude briefing command
				<input
					aria-label="Claude briefing command"
					readOnly
					value={command}
					onFocus={(event) => event.currentTarget.select()}
				/>
			</label>
			<button
				onClick={() =>
					void navigator.clipboard
						.writeText(command)
						.then(() => setCopied(true))
						.catch(() => setCopied(false))
				}
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}
function Dialog({
	title,
	onClose,
	children,
	large = false,
	canClose,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
	large?: boolean;
	canClose?: () => boolean;
}) {
	const ref = useRef<HTMLDialogElement>(null),
		prior = useRef<Element | null>(document.activeElement);
	const close = () => {
		if (!canClose || canClose()) onClose();
	};
	useEffect(() => {
		const element = ref.current;
		element?.showModal();
		return () => {
			element?.close();
			if (prior.current instanceof HTMLElement) prior.current.focus();
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className={large ? "dialog detail-dialog" : "dialog"}
			aria-label={title}
			onCancel={(e) => {
				e.preventDefault();
				close();
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) close();
			}}
		>
			<div className="dialog-top">
				<span>{title}</span>
				<button
					className="dialog-close"
					aria-label="Close dialog"
					title="Close"
					onClick={close}
				>
					<X size={16} strokeWidth={2.5} />
				</button>
			</div>
			{children}
		</dialog>
	);
}
function TaskForm({
	value,
	onChange,
	creating = false,
}: {
	value: Editable;
	onChange: (v: Editable) => void;
	creating?: boolean;
}) {
	const [labelText, setLabelText] = useState(value.labels.join(","));
	const change = (k: keyof Editable, v: any) => onChange({ ...value, [k]: v });
	return (
		<div className="task-form">
			<label>
				Title
				<input
					required
					value={value.title}
					maxLength={1000}
					onChange={(e) => change("title", e.target.value)}
				/>
			</label>
			<div className="form-grid">
				<label>
					Status
					<select
						disabled={creating}
						value={value.status}
						onChange={(e) => change("status", e.target.value)}
					>
						{[
							...new Set([
								"open",
								"in_progress",
								"blocked",
								"deferred",
								"closed",
								value.status,
							]),
						].map((s) => (
							<option key={s} value={s}>
								{statusName(s)}
							</option>
						))}
					</select>
				</label>
				<label>
					Priority
					<select
						value={value.priority}
						onChange={(e) => change("priority", Number(e.target.value))}
					>
						{[0, 1, 2, 3, 4].map((p) => (
							<option key={p} value={p}>
								P{p}
							</option>
						))}
					</select>
				</label>
				<label>
					Type
					<select
						value={value.issue_type}
						onChange={(e) => change("issue_type", e.target.value)}
					>
						{[
							...new Set([
								"task",
								"bug",
								"feature",
								"epic",
								"chore",
								"decision",
								value.issue_type,
							]),
						].map((s) => (
							<option key={s}>{s}</option>
						))}
					</select>
				</label>
				<label>
					Assignee
					<input
						value={value.assignee}
						onChange={(e) => change("assignee", e.target.value)}
						placeholder="Unassigned"
					/>
				</label>
			</div>
			<label>
				Labels (comma separated)
				<input
					value={labelText}
					onChange={(e) => {
						setLabelText(e.target.value);
						change(
							"labels",
							e.target.value
								.split(",")
								.map((x) => x.trim())
								.filter(Boolean),
						);
					}}
				/>
			</label>
			{(["description", "acceptance_criteria", "design", "notes"] as const).map(
				(k) => (
					<label key={k}>
						{statusName(k)}
						<textarea
							value={value[k]}
							onChange={(e) => change(k, e.target.value)}
							rows={k === "description" ? 5 : 3}
						/>
					</label>
				),
			)}
		</div>
	);
}
function NewTask({
	repositories,
	onClose,
	onCreated,
}: {
	repositories: Repository[];
	onClose: () => void;
	onCreated: (t: Task) => void;
}) {
	const [workspace, setWorkspace] = useState(""),
		[value, setValue] = useState<Editable>(
			editable.parse({ title: "Untitled task" }),
		);
	const key = useRef(crypto.randomUUID());
	const mutation = useMutation({
		mutationFn: async () => {
			const task = editable.parse(value);
			if (!workspace) throw new Error("Select a target repository");
			return api<Task>(
				"/tasks",
				"POST",
				{ workspaceId: workspace, task },
				key.current,
			);
		},
		onSuccess: (t) => {
			void client.invalidateQueries({ queryKey: ["snapshot"] });
			onCreated(t);
		},
	});
	return (
		<Dialog
			title="New task"
			onClose={onClose}
			canClose={() =>
				!mutation.isPending && confirm("Discard this new task draft?")
			}
		>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					mutation.mutate();
				}}
			>
				<div className="form-body">
					<label>
						Target repository
						<select
							aria-label="Target repository"
							value={workspace}
							onChange={(e) => {
								key.current = crypto.randomUUID();
								setWorkspace(e.target.value);
							}}
							required
						>
							<option value="">Choose a repository…</option>
							{repositories.map((r) => (
								<option value={r.workspaceId} key={r.workspaceId}>
									{r.name} · {r.path}
								</option>
							))}
						</select>
					</label>
					<TaskForm
						value={value}
						onChange={(v) => {
							key.current = crypto.randomUUID();
							setValue(v);
						}}
						creating
					/>
					{mutation.isError && <ErrorBox error={mutation.error} />}
				</div>
				<div className="dialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button
						className="primary"
						disabled={mutation.isPending || !workspace}
					>
						{mutation.isPending ? "Creating…" : "Create task"}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
function TaskDialog({
	workspace,
	taskId,
	tab,
	setTab,
	repositories,
	connection,
	onClose,
	onOpen,
}: {
	workspace: string;
	taskId: string;
	tab: "agent" | "human";
	setTab: (t: "agent" | "human") => void;
	repositories: Repository[];
	connection: ConnectionState | undefined;
	onClose: () => void;
	onOpen: (t: Task) => void;
}) {
	const query = useQuery({
		queryKey: ["detail", workspace, taskId],
		queryFn: () => detail(workspace, taskId),
		refetchInterval: 10000,
	});
	const key = `${workspace}/${taskId}`,
		ui = useUI(),
		draft = ui.drafts[key];
	const [editing, setEditing] = useState(!!draft),
		[revisionId, setRevisionId] = useState(""),
		[selection, setSelection] = useState<Anchor | null>(null),
		[activeThread, setActiveThread] = useState(""),
		[threadFilter, setThreadFilter] = useState("active"),
		[reattach, setReattach] = useState(""),
		[keyboardSelection, setKeyboardSelection] = useState(false);
	const [error, setError] = useState<unknown>(null),
		[busy, setBusy] = useState(false),
		[newComment, setNewComment] = useState("");
	const [deleteDialog, setDeleteDialog] = useState(false),
		[deleteConfirm, setDeleteConfirm] = useState("");
	const bodyRef = useRef<HTMLDivElement>(null);
	const t = query.data?.task;
	const summaries = query.data?.summaries || [];
	const summary = summaries.find((s) => s.id === revisionId) || summaries[0];
	const mutationKeys = useRef(new Map<string, string>());
	const refresh = () => {
		void query.refetch();
		void client.invalidateQueries({ queryKey: ["snapshot"] });
	};
	const mutate = async (
		action: string,
		method: string,
		body: unknown,
		after?: () => void,
	) => {
		setError(null);
		setBusy(true);
		try {
			const intent = JSON.stringify({ action, method, body });
			const requestKey =
				mutationKeys.current.get(intent) || crypto.randomUUID();
			mutationKeys.current.set(intent, requestKey);
			await api(
				`/tasks/${workspace}/${taskId}${action ? "/" + action : ""}`,
				method,
				body,
				requestKey,
			);
			mutationKeys.current.delete(intent);
			refresh();
			after?.();
			return true;
		} catch (e) {
			setError(e);
			return false;
		} finally {
			setBusy(false);
		}
	};
	const closeCheck = () =>
		!draft ||
		confirm(
			"Keep your unsaved draft and close this task? Your draft remains available while this page is open.",
		);
	useEffect(() => {
		const warn = (e: BeforeUnloadEvent) => {
			if (draft) {
				e.preventDefault();
				e.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [draft]);
	const selectText = () => {
		const s = window.getSelection();
		if (!s || !s.rangeCount || s.isCollapsed || !t) return;
		const range = s.getRangeAt(0),
			start =
				range.startContainer instanceof Element
					? range.startContainer
					: range.startContainer.parentElement,
			end =
				range.endContainer instanceof Element
					? range.endContainer
					: range.endContainer.parentElement;
		const node = start?.closest<HTMLElement>("[data-anchor-block]");
		if (
			!node ||
			node !== end?.closest("[data-anchor-block]") ||
			!bodyRef.current?.contains(node)
		)
			return;
		const before = range.cloneRange();
		before.selectNodeContents(node);
		before.setEnd(range.startContainer, range.startOffset);
		const a = before.toString().length,
			b = a + range.toString().length,
			value = canonical(node.textContent || "");
		if (b - a > 10000) return;
		setSelection({
			version: 1,
			view: tab,
			workspaceId: workspace,
			taskId,
			blockId: node.dataset.anchorBlock!,
			sourceRevision: tab === "agent" ? t.revision : summary!.sourceHash,
			...(tab === "human" ? { summaryId: summary!.id } : {}),
			exact: value.slice(a, b),
			prefix: value.slice(Math.max(0, a - 64), a),
			suffix: value.slice(b, b + 64),
			start: a,
			end: b,
		});
	};
	const addSelected = () => {
		if (!selection) return;
		document.getElementById("inline-composer")?.focus();
	};
	const threads = (query.data?.threads || []).filter(
		(th) =>
			th.anchor.view === tab &&
			(tab === "agent" || th.anchor.summaryId === summary?.id),
	);
	const threadVisible = threads.filter((th) =>
		threadFilter === "all" || threadFilter === "resolved"
			? threadFilter === "all" || th.resolved
			: !th.resolved,
	);
	const jump = (th: Thread) => {
		setThreadFilter("all");
		setActiveThread(th.id);
		document.getElementById(`highlight-${th.id}`)?.scrollIntoView({
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
			block: "center",
		});
		setTimeout(() => document.getElementById(`thread-${th.id}`)?.focus(), 0);
	};
	const findValue = (a: Anchor) =>
		a.view === "agent"
			? String(t?.[a.blockId as keyof Task] || "")
			: summary?.blocks.find((b) => b.id === a.blockId)?.text || "";
	const request = (query.data?.jobs || []).find((j) =>
		["queued", "running"].includes(j.state),
	);
	const latestJob = query.data?.jobs.at(-1);
	// Opening Human view asks the invoking Claude conversation for a briefing when
	// there is none for the current task revision: once per revision per page, never
	// after a failed or cancelled attempt, and not again when the task changes while
	// the tab stays open (that shows the older-revision notice and Regenerate).
	const [openedRevision, setOpenedRevision] = useState<string | null>(null);
	useEffect(() => {
		if (tab !== "human") setOpenedRevision(null);
		else if (t) setOpenedRevision((current) => current ?? t.revision);
	}, [tab, t?.revision]);
	const needsBriefing =
		!!t && (!summaries.length || summaries[0].sourceHash !== t.revision);
	const autoRequested = useRef(new Set<string>());
	const revisionJob = (query.data?.jobs || [])
		.filter((j) => j.sourceHash === t?.revision)
		.at(-1);
	const attempted = !!revisionJob;
	// Show progress at once: Beads reads can take seconds before the new request
	// appears in the task data.
	// A Generate/Regenerate click also shows progress at once.
	const [awaiting, setAwaiting] = useState(false);
	useEffect(() => {
		if (request) setAwaiting(false);
	}, [!!request, summaries[0]?.id]);
	const requestBriefing = () => {
		setAwaiting(true);
		void mutate("summarize", "POST", {}, () => setRevisionId("")).then(
			(ok) => {
				if (!ok) setAwaiting(false);
			},
		);
	};
	const starting =
		awaiting ||
		(tab === "human" &&
		t?.revision === openedRevision &&
		needsBriefing &&
		!request &&
		!attempted &&
		connection?.state === "connected");
	useEffect(() => {
		if (
			tab !== "human" ||
			!t ||
			t.revision !== openedRevision ||
			!needsBriefing ||
			request ||
			attempted ||
			connection?.state !== "connected" ||
			autoRequested.current.has(t.revision)
		)
			return;
		const revision = t.revision;
		const timer = setTimeout(() => {
			autoRequested.current.add(revision);
			void mutate("summarize", "POST", {}, () => setRevisionId(""));
		}, 300);
		return () => clearTimeout(timer);
	}, [
		tab,
		t?.revision,
		openedRevision,
		needsBriefing,
		!!request,
		attempted,
		connection?.state,
	]);
	return (
		<>
			<Dialog
				title={`${repositories.find((r) => r.workspaceId === workspace)?.name || "Repository"} / ${taskId}`}
				onClose={onClose}
				canClose={closeCheck}
				large
			>
				{query.isPending ? (
					<div className="detail-loading">Loading complete Beads source…</div>
				) : query.isError ? (
					<ErrorBox error={query.error} retry={() => void query.refetch()} />
				) : (
					t && (
						<>
							<div className="detail-header">
								<div className="eyebrow">
									{t.project === "Unspecified"
										? "UNSPECIFIED PROJECT"
										: t.project}
								</div>
								<h1>{t.title}</h1>
								<div className="metadata">
									<span className={"status-chip " + t.status}>
										{statusName(t.status)}
									</span>
									<span>P{t.priority}</span>
									<span>{t.issue_type}</span>
									<span>{t.assignee || "Unassigned"}</span>
									{t.labels.map((l) => (
										<span className="tiny-chip" key={l}>
											{l}
										</span>
									))}
								</div>
								<div className="detail-tools">
									<button
										onClick={() => {
											if (!draft)
												ui.setDraft(key, {
													task: taskEditable(t),
													revision: t.revision,
												});
											setEditing(!editing);
										}}
									>
										{editing ? "Read source" : "Edit task"}
									</button>
									<button
										disabled={busy}
										onClick={() =>
											void mutate("", "PATCH", {
												task: {
													...taskEditable(t),
													status: t.status === "closed" ? "open" : "closed",
												},
												revision: t.revision,
											})
										}
									>
										{t.status === "closed" ? "Reopen task" : "Close task"}
									</button>
									<button
										onClick={() => setKeyboardSelection(true)}
										disabled={tab === "human" && !summary}
									>
										Comment on text…
									</button>
									<button
										className="danger text-button"
										onClick={() => setDeleteDialog(true)}
									>
										Delete permanently
									</button>
								</div>
							</div>
							{draft && draft.revision !== t.revision && (
								<div className="conflict" role="alert">
									The source changed after you started editing. Your draft is
									preserved. Review current source in Agent view.{" "}
									<button
										onClick={() => {
											if (
												confirm(
													"Keep draft text and use the current source revision as its base? Review every field first.",
												)
											)
												ui.setDraft(key, {
													task: draft.task,
													revision: t.revision,
												});
										}}
									>
										Use current revision as draft base
									</button>
								</div>
							)}
							<div
								role="tablist"
								aria-label="Task perspective"
								className="tabs"
								onKeyDown={(e) => {
									if (
										["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
									) {
										e.preventDefault();
										const next =
											e.key === "Home"
												? "agent"
												: e.key === "End"
													? "human"
													: tab === "agent"
														? "human"
														: "agent";
										setTab(next);
										document.getElementById(`tab-${next}`)?.focus();
									}
								}}
							>
								{(["agent", "human"] as const).map((v) => (
									<button
										key={v}
										role="tab"
										id={`tab-${v}`}
										aria-selected={tab === v}
										aria-controls={`panel-${v}`}
										tabIndex={tab === v ? 0 : -1}
										onClick={() => {
											setTab(v);
											setSelection(null);
										}}
									>
										{v === "agent" ? <Layers size={16} /> : <Bot size={16} />}{" "}
										{v === "agent" ? "Agent view" : "Human view"}
									</button>
								))}
							</div>
							{error != null && <ErrorBox error={error} />}
							<div className="detail-layout">
								<div
									className="detail-content"
									id={`panel-${tab}`}
									role="tabpanel"
									aria-labelledby={`tab-${tab}`}
									tabIndex={0}
									ref={bodyRef}
									onMouseUp={selectText}
									onKeyUp={(e) => {
										if (e.shiftKey) selectText();
									}}
								>
									{tab === "agent" && editing && draft ? (
										<>
											<TaskForm
												value={draft.task}
												onChange={(task) =>
													ui.setDraft(key, { task, revision: draft.revision })
												}
											/>
											<div className="edit-actions">
												<button
													onClick={() => {
														if (confirm("Discard your draft?")) {
															ui.setDraft(key, null);
															setEditing(false);
														}
													}}
												>
													Cancel edits
												</button>
												<button
													className="primary"
													disabled={busy}
													onClick={() =>
														void mutate(
															"",
															"PATCH",
															{
																task: editable.parse(draft.task),
																revision: draft.revision,
															},
															() => {
																ui.setDraft(key, null);
																setEditing(false);
															},
														)
													}
												>
													{busy ? "Saving…" : "Save changes"}
												</button>
											</div>
										</>
									) : tab === "agent" ? (
										<>
											<div className="source-note">
												Faithful source · Safe Markdown with a versioned
												canonical text model. Select text, then Add inline
												comment. Keyboard: use “Comment on text…” to choose a
												quote without a pointer.
											</div>
											{(
												[
													"title",
													"description",
													"acceptance_criteria",
													"design",
													"notes",
												] as const
											).map((field) => (
												<section key={field} className="source-section">
													<h3 id={`source-${field}`}>{statusName(field)}</h3>
													{t[field] ? (
														<AnnotatedText
															value={t[field]}
															blockId={field}
															threads={threads}
															onThread={jump}
														/>
													) : (
														<p className="muted">
															{Object.hasOwn(t.raw, field)
																? "Empty in source"
																: "Not supplied by Beads"}
														</p>
													)}
												</section>
											))}
											<Relationships
												task={t}
												repositories={repositories}
												onOpen={onOpen}
												onMutate={mutate}
												busy={busy}
											/>
											<section className="source-section">
												<h3>Source record</h3>
												<p className="muted">
													Created {date(t.created_at)} · Updated{" "}
													{date(t.updated_at)}
												</p>
												<details>
													<summary>
														Complete structured source (read only)
													</summary>
													<pre className="raw-json">
														{JSON.stringify(t.raw, null, 2)}
													</pre>
												</details>
											</section>
										</>
									) : (
										<>
											<div className="human-top">
												<span className="eyebrow">HUMAN BRIEFING</span>
												{summary && !request && !starting && (
													<button
														className="small-button"
														disabled={busy || connection?.state !== "connected"}
														title="Ask Claude for a fresh briefing"
														onClick={requestBriefing}
													>
														<RefreshCw size={13} />
														Regenerate
													</button>
												)}
											</div>
											{(request || starting) && (
												<BriefingProgress
													request={request}
													delivery={connection?.delivery}
													replacing={!!summary}
													onCancel={
														request
															? () =>
																	void mutate("cancel", "POST", {
																		requestId: request.id,
																	})
															: undefined
													}
												/>
											)}
											{!request &&
												latestJob?.state === "failed" &&
												latestJob.sourceHash === t.revision && (
													<ErrorBox
														error={latestJob.error || "AI request failed"}
														retry={
															connection?.state === "connected"
																? requestBriefing
																: undefined
														}
													/>
												)}
											{summaries.length > 0 && (
												<label className="revision-select">
													Summary revision
													<select
														aria-label="Summary revision"
														value={summary?.id || ""}
														onChange={(e) => {
															setRevisionId(e.target.value);
															setSelection(null);
														}}
													>
														{summaries.map((s, i) => (
															<option key={s.id} value={s.id}>
																{i === 0 ? "Latest" : "Older"} ·{" "}
																{date(s.generatedAt)} · {s.id.slice(0, 8)}
																{query.data!.threads.some(
																	(th) => th.anchor.summaryId === s.id,
																)
																	? " · annotated"
																	: ""}
															</option>
														))}
													</select>
												</label>
											)}
											{summary ? (
												<>
													{summary.sourceHash !== t.revision && (
														<div className="conflict">
															This briefing describes an older source revision.
															Regenerate to use the current task. Existing
															comments stay on this revision.
														</div>
													)}
													{summary.id !== summaries[0]?.id && (
														<p className="conflict">
															Viewing an older immutable summary revision.
														</p>
													)}
													{summary.blocks.map((b) => (
														<section
															key={b.id}
															className={"briefing-block " + b.kind}
														>
															<h3>
																{b.title}
																{["suggestions", "questions"].includes(
																	b.kind,
																) && (
																	<span className="tiny-chip">Suggested</span>
																)}
															</h3>
															<AnnotatedText
																value={b.text}
																blockId={b.id}
																threads={threads}
																onThread={jump}
															/>
															<div className="source-links">
																{b.sources.map((s, i) => (
																	<button
																		key={i}
																		onClick={() => {
																			setTab("agent");
																			setTimeout(
																				() =>
																					document
																						.getElementById(
																							s.kind === "field"
																								? `source-${s.id}`
																								: s.kind === "comment"
																									? `comment-${s.id}`
																									: "source-dependencies",
																						)
																						?.scrollIntoView({
																							block: "center",
																						}),
																				50,
																			);
																		}}
																	>
																		<Link2 size={12} />
																		{s.kind}: {s.id}
																	</button>
																))}
															</div>
														</section>
													))}
													{summary.omissions.length > 0 && (
														<section className="conflict">
															<h3>Source omissions</h3>
															{summary.omissions.map((o, i) => (
																<p key={i}>{o}</p>
															))}
														</section>
													)}
													<p className="provenance">
														{summary.host} · session {summary.sessionId} ·{" "}
														{date(summary.generatedAt)} ·{" "}
														{summary.promptVersion}
													</p>
												</>
											) : (
												!request &&
												!starting && (
													<div className="empty human-empty">
														<Bot size={32} />
														<h2>No briefing yet</h2>
														<p>
															{connection?.state === "connected"
																? "There is no cached summary for this task yet."
																: "There is no cached summary for this task yet. Run /beads-viewer:open in Claude to generate briefings."}
														</p>
														{connection?.state === "connected" &&
															revisionJob?.state !== "failed" && (
																<button
																	className="primary"
																	disabled={busy}
																	onClick={requestBriefing}
																>
																	<RefreshCw size={14} />
																	Generate briefing
																</button>
															)}
													</div>
												)
											)}
										</>
									)}
									{selection && (
										<div className="selection-action">
											<span>“{selection.exact.slice(0, 80)}”</span>
											<button className="primary" onClick={addSelected}>
												<MessageSquare size={15} />
												Add inline comment
											</button>
											<button
												aria-label="Clear selection"
												onClick={() => {
													setSelection(null);
													setReattach("");
												}}
											>
												<X size={14} />
											</button>
										</div>
									)}
								</div>
								<aside className="comments-rail">
									<div className="rail-heading">
										<h3>
											Discussion{" "}
											<span>{t.comments.length + threads.length}</span>
										</h3>
										<MessageSquare size={16} />
									</div>
									<p className="local-identity">
										Local user identity · no multi-user sign-in
									</p>
									<div className="rail-tabs">
										<button
											className={threadFilter === "active" ? "selected" : ""}
											onClick={() => setThreadFilter("active")}
										>
											Active
										</button>
										<button
											className={threadFilter === "resolved" ? "selected" : ""}
											onClick={() => setThreadFilter("resolved")}
										>
											Resolved
										</button>
										<button
											className={threadFilter === "all" ? "selected" : ""}
											onClick={() => setThreadFilter("all")}
										>
											All
										</button>
									</div>
									{selection && (
										<form
											className="inline-composer"
											onSubmit={(e) => {
												e.preventDefault();
												const form = e.currentTarget,
													text = String(new FormData(form).get("text") || "");
												void mutate(
													"threads",
													reattach ? "PATCH" : "POST",
													reattach
														? { threadId: reattach, anchor: selection }
														: { anchor: selection, text },
													() => {
														setSelection(null);
														setReattach("");
													},
												);
											}}
										>
											<strong>
												{reattach ? "Reattach thread" : "New inline thread"}
											</strong>
											<blockquote>{selection.exact}</blockquote>
											{!reattach && (
												<textarea
													id="inline-composer"
													name="text"
													aria-label="Inline comment"
													required
													placeholder="Comment on this selection…"
												/>
											)}
											<button className="primary" disabled={busy}>
												{reattach
													? "Confirm reattachment"
													: "Post inline comment"}
											</button>
										</form>
									)}
									{threadVisible.map((th) => {
										const position = locate(
											th.anchor,
											markdownText(findValue(th.anchor)),
										);
										return (
											<ThreadCard
												key={th.id}
												thread={th}
												active={activeThread === th.id}
												detached={
													position.state === "detached"
														? position.reason
														: undefined
												}
												onJump={() => jump(th)}
												onReply={(text) =>
													mutate("threads", "PATCH", { threadId: th.id, text })
												}
												onResolve={() =>
													void mutate("threads", "PATCH", {
														threadId: th.id,
														resolved: !th.resolved,
													})
												}
												onReattach={() => {
													setReattach(th.id);
													setSelection(null);
													setError(
														new Error(
															"Select the replacement text in this view, then confirm reattachment in Discussion.",
														),
													);
												}}
											/>
										);
									})}
									{!threadVisible.length && (
										<p className="quiet-state">
											{threadFilter === "resolved"
												? "No resolved threads."
												: "Select source text to start an inline discussion."}
										</p>
									)}
									<div className="native-comments">
										<h4>Beads comments</h4>
										<p className="local-identity">
											Stored in Beads · readable with bd
										</p>
										{t.comments.map((c) => (
											<article
												className="comment"
												key={c.id}
												id={`comment-${c.id}`}
											>
												<strong>{c.author}</strong>
												<time>{date(c.created_at)}</time>
												<p>{c.text}</p>
											</article>
										))}
										<form
											onSubmit={(e) => {
												e.preventDefault();
												void mutate(
													"comments",
													"POST",
													{ text: newComment },
													() => setNewComment(""),
												);
											}}
										>
											<textarea
												aria-label="Ordinary comment"
												placeholder="Add a Beads comment…"
												value={newComment}
												onChange={(e) => setNewComment(e.target.value)}
												required
											/>
											<button
												disabled={busy || !newComment.trim()}
												className="primary"
											>
												Post comment
											</button>
										</form>
									</div>
									{tab === "human" &&
										query.data!.threads.some(
											(th) =>
												th.anchor.view === "human" &&
												th.anchor.summaryId !== summary?.id,
										) && (
											<p className="conflict">
												Other summary revisions have inline threads. Select
												their revision to read them.
											</p>
										)}
								</aside>
							</div>
						</>
					)
				)}
			</Dialog>
			{keyboardSelection && t && (
				<QuotePicker
					task={t}
					tab={tab}
					summary={summary}
					onClose={() => setKeyboardSelection(false)}
					onSelect={(a) => {
						setSelection(a);
						setKeyboardSelection(false);
						setTimeout(
							() => document.getElementById("inline-composer")?.focus(),
							50,
						);
					}}
				/>
			)}
			{deleteDialog && t && (
				<Dialog
					title="Permanently delete task"
					onClose={() => setDeleteDialog(false)}
				>
					<div className="form-body">
						<h2>
							{t.id} · {t.title}
						</h2>
						<p>
							Repository:{" "}
							{repositories.find((r) => r.workspaceId === workspace)?.path}
						</p>
						<p>
							This permanently removes the Beads task. Closing preserves it. The
							viewer refuses deletion while relationships exist and never
							cascades.
						</p>
						<p>
							{t.dependencies.length} dependencies · {t.dependents.length}{" "}
							dependents. Local annotations are retained for export.
						</p>
						<label>
							Type {t.id} to confirm
							<input
								aria-label="Confirm task ID"
								value={deleteConfirm}
								onChange={(e) => setDeleteConfirm(e.target.value)}
							/>
						</label>
						{error != null && <ErrorBox error={error} />}
					</div>
					<div className="dialog-actions">
						<button onClick={() => setDeleteDialog(false)}>Cancel</button>
						<button
							className="danger-button"
							disabled={busy || deleteConfirm !== t.id}
							onClick={() =>
								void mutate(
									"",
									"DELETE",
									{ revision: t.revision, confirm: deleteConfirm },
									() => {
										setDeleteDialog(false);
										onClose();
									},
								)
							}
						>
							Delete permanently
						</button>
					</div>
				</Dialog>
			)}
		</>
	);
}
function AnnotatedText({
	value,
	blockId,
	threads,
	onThread,
}: {
	value: string;
	blockId: string;
	threads: Thread[];
	onThread: (t: Thread) => void;
}) {
	const s = markdownText(value),
		found = threads
			.filter((t) => t.anchor.blockId === blockId)
			.flatMap((t) => {
				const p = locate(t.anchor, s);
				return p.state === "attached" ? [{ ...p, t }] : [];
			})
			.sort((a, b) => a.start - b.start);
	let offset = 0;
	const assigned = new Set<string>();
	const render = (node: MarkdownNode, key: string): React.ReactNode => {
		if ("text" in node) {
			const start = offset,
				end = start + node.text.length;
			offset = end;
			const points = [
				...new Set([
					start,
					end,
					...found
						.flatMap((f) => [f.start, f.end])
						.filter((p) => p > start && p < end),
				]),
			].sort((a, b) => a - b);
			return (
				<React.Fragment key={key}>
					{points.slice(0, -1).map((p, i) => {
						const q = points[i + 1],
							hits = found.filter((f) => f.start <= p && f.end >= q),
							text = s.slice(p, q);
						if (!hits.length)
							return <React.Fragment key={p}>{text}</React.Fragment>;
						const first = hits.find((h) => !assigned.has(h.t.id));
						if (first) assigned.add(first.t.id);
						return (
							<mark
								key={p}
								id={first ? `highlight-${first.t.id}` : undefined}
								className={
									hits.every((h) => h.t.resolved) ? "resolved-highlight" : ""
								}
								onClick={() => onThread(hits[0].t)}
								title={`${hits.length} inline thread(s)`}
							>
								{text}
							</mark>
						);
					})}
				</React.Fragment>
			);
		}
		return React.createElement(
			node.tag,
			{
				key,
				...(node.href
					? { href: node.href, target: "_blank", rel: "noopener noreferrer" }
					: {}),
			},
			node.children.map((n, i) => render(n, `${key}-${i}`)),
		);
	};
	return (
		<div className="source-text" data-anchor-block={blockId}>
			{markdownTree(value).map((n, i) => render(n, String(i)))}
		</div>
	);
}
function ThreadCard({
	thread: t,
	active,
	detached,
	onJump,
	onReply,
	onResolve,
	onReattach,
}: {
	thread: Thread;
	active: boolean;
	detached?: string;
	onJump: () => void;
	onReply: (s: string) => Promise<boolean>;
	onResolve: () => void;
	onReattach: () => void;
}) {
	const [reply, setReply] = useState("");
	return (
		<article
			className={"thread " + (active ? "active-thread" : "")}
			id={`thread-${t.id}`}
			tabIndex={-1}
		>
			<button className="quote" onClick={onJump}>
				“{t.anchor.exact}”
			</button>
			{detached && (
				<div className="detached">
					Detached: {detached}
					<button onClick={onReattach}>Reattach explicitly</button>
				</div>
			)}
			{t.replies.map((r) => (
				<div className="comment" key={r.id}>
					<strong>{r.author}</strong>
					<time>{date(r.createdAt)}</time>
					<p>{r.text}</p>
				</div>
			))}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void onReply(reply).then((ok) => {
						if (ok) setReply("");
					});
				}}
			>
				<input
					aria-label={`Reply to ${t.anchor.exact}`}
					placeholder="Reply…"
					value={reply}
					onChange={(e) => setReply(e.target.value)}
					required
				/>
				<button aria-label="Post reply" disabled={!reply.trim()}>
					<ArrowUpRight size={15} />
				</button>
			</form>
			<button className="text-button" onClick={onResolve}>
				{t.resolved ? "Reopen thread" : "Resolve thread"}
			</button>
		</article>
	);
}
function Relationships({
	task: t,
	repositories: _repositories,
	onOpen,
	onMutate,
	busy,
}: {
	task: Task;
	repositories: Repository[];
	onOpen: (t: Task) => void;
	onMutate: (
		a: string,
		m: string,
		b: unknown,
		after?: () => void,
	) => Promise<boolean>;
	busy: boolean;
}) {
	const cache = useQueryClient(),
		snapshot = cache.getQueryData<{
			tasks: Task[];
		}>(["snapshot"]),
		[target, setTarget] = useState("");
	return (
		<section className="source-section">
			<h3 id="source-dependencies">Dependencies & relationships</h3>
			{[...t.dependencies, ...t.dependents].length ? (
				[...t.dependencies, ...t.dependents].map((d, i) => {
					const matches = (snapshot?.tasks || []).filter((x) => x.id === d.id),
						local = matches.find((x) => x.workspaceId === t.workspaceId),
						resolved = local || (matches.length === 1 ? matches[0] : undefined);
					return (
						<div className="relationship" key={i}>
							<span>
								{i < t.dependencies.length ? "Depends on" : "Dependent"} ·{" "}
								{d.type}
							</span>
							<button
								disabled={!resolved}
								onClick={() => resolved && onOpen(resolved)}
							>
								{d.id} {d.title}
							</button>
							<span>{d.status || "Status unavailable"}</span>
							{i < t.dependencies.length && (
								<button
									disabled={busy}
									onClick={() =>
										void onMutate("dependencies", "POST", {
											target: d.id,
											remove: true,
										})
									}
								>
									Remove link
								</button>
							)}
						</div>
					);
				})
			) : (
				<p className="muted">No relationships recorded.</p>
			)}
			<form
				className="inline-form"
				onSubmit={(e) => {
					e.preventDefault();
					void onMutate("dependencies", "POST", { target }, () =>
						setTarget(""),
					);
				}}
			>
				<input
					aria-label="Dependency task ID"
					value={target}
					onChange={(e) => setTarget(e.target.value)}
					placeholder="Same-repository blocker ID"
					required
				/>
				<button disabled={busy}>Add dependency</button>
			</form>
			<small className="muted">
				Cross-repository links open only when their target identity is
				unambiguous. Creating cross-storage links requires Beads-native support.
			</small>
		</section>
	);
}
createRoot(document.getElementById("root")!).render(
	<QueryClientProvider client={client}>
		<App />
	</QueryClientProvider>,
);
function QuotePicker({
	task,
	tab,
	summary,
	onClose,
	onSelect,
}: {
	task: Task;
	tab: "agent" | "human";
	summary?: Summary;
	onClose: () => void;
	onSelect: (a: Anchor) => void;
}) {
	const blocks =
		tab === "agent"
			? (
					[
						"title",
						"description",
						"acceptance_criteria",
						"design",
						"notes",
					] as const
				).map((id) => ({ id, text: task[id] }))
			: summary?.blocks.map((b) => ({ id: b.id, text: b.text })) || [];
	const [blockId, setBlockId] = useState(blocks[0]?.id || ""),
		[quote, setQuote] = useState(""),
		[occurrence, setOccurrence] = useState(0);
	const value = markdownText(blocks.find((b) => b.id === blockId)?.text || ""),
		exact = canonical(quote);
	const positions: number[] = [];
	let at = exact ? value.indexOf(exact) : -1;
	while (at >= 0) {
		positions.push(at);
		at = value.indexOf(exact, at + 1);
	}
	const start = positions[occurrence],
		end = start + exact.length;
	return (
		<Dialog title="Choose text for an inline comment" onClose={onClose}>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (start === undefined) return;
					onSelect({
						version: 1,
						view: tab,
						workspaceId: task.workspaceId,
						taskId: task.id,
						blockId,
						sourceRevision:
							tab === "agent" ? task.revision : summary!.sourceHash,
						...(tab === "human" ? { summaryId: summary!.id } : {}),
						exact,
						prefix: value.slice(Math.max(0, start - 64), start),
						suffix: value.slice(end, end + 64),
						start,
						end,
					});
				}}
			>
				<div className="form-body">
					<label>
						Source block
						<select
							value={blockId}
							onChange={(e) => {
								setBlockId(e.target.value);
								setOccurrence(0);
							}}
						>
							{blocks.map((b) => (
								<option key={b.id} value={b.id}>
									{statusName(b.id)}
								</option>
							))}
						</select>
					</label>
					<label>
						Exact quote
						<textarea
							aria-label="Exact quote"
							required
							maxLength={10000}
							value={quote}
							onChange={(e) => {
								setQuote(e.target.value);
								setOccurrence(0);
							}}
						/>
					</label>
					<label>
						Occurrence
						<select
							aria-label="Quote occurrence"
							value={occurrence}
							onChange={(e) => setOccurrence(Number(e.target.value))}
						>
							{positions.map((p, i) => (
								<option key={p} value={i}>
									{i + 1}:{" "}
									{value.slice(Math.max(0, p - 30), p + exact.length + 30)}
								</option>
							))}
						</select>
					</label>
					<p className="muted">
						{positions.length} exact match(es). Select the intended occurrence;
						context will be stored with the thread.
					</p>
				</div>
				<div className="dialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="primary" disabled={start === undefined}>
						Use selected quote
					</button>
				</div>
			</form>
		</Dialog>
	);
}
