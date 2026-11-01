import { create } from "zustand";
import type { Editable } from "@bv/contracts";
interface State {
	theme: "light" | "dark";
	density: "comfortable" | "compact";
	drafts: Record<
		string,
		{
			task: Editable;
			revision: string;
		}
	>;
	setDraft: (
		key: string,
		value: {
			task: Editable;
			revision: string;
		} | null,
	) => void;
	setPreference: (
		scope: string,
		key: "theme" | "density",
		value: string,
	) => void;
	load: (scope: string) => void;
}
export const useUI = create<State>((set) => ({
	theme: "light",
	density: "comfortable",
	drafts: {},
	setDraft: (key, value) =>
		set((s) => {
			const drafts = { ...s.drafts };
			if (value) drafts[key] = value;
			else delete drafts[key];
			return { drafts };
		}),
	setPreference: (scope, key, value) => {
		set({ [key]: value } as Partial<State>);
		try {
			const p = JSON.parse(
				localStorage.getItem(`beads-viewer:${scope}`) || "{}",
			);
			localStorage.setItem(
				`beads-viewer:${scope}`,
				JSON.stringify({ ...p, [key]: value }),
			);
		} catch {
			/* Private browsing still works */
		}
	},
	load: (scope) => {
		try {
			const p = JSON.parse(
				localStorage.getItem(`beads-viewer:${scope}`) || "{}",
			);
			set({
				theme: p.theme === "dark" ? "dark" : "light",
				density: p.density === "compact" ? "compact" : "comfortable",
			});
		} catch {
			/* Ignore invalid preferences */
		}
	},
}));
