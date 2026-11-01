import { marked, type Token } from "marked";
export type MarkdownNode =
	| {
			text: string;
	  }
	| {
			tag:
				| "p"
				| "h4"
				| "strong"
				| "em"
				| "s"
				| "blockquote"
				| "ul"
				| "ol"
				| "li"
				| "pre"
				| "code"
				| "a"
				| "span"
				| "table"
				| "thead"
				| "tbody"
				| "tr"
				| "th"
				| "td";
			children: MarkdownNode[];
			href?: string;
	  };
const t = (text: string): MarkdownNode => ({ text });
const el = (
	tag: Exclude<
		MarkdownNode,
		{
			text: string;
		}
	>["tag"],
	children: MarkdownNode[],
	href?: string,
): MarkdownNode => ({ tag, children, ...(href ? { href } : {}) });
export function safeHref(value: string) {
	try {
		const url = new URL(value, "http://viewer.invalid");
		if (value.startsWith("#")) return value;
		if (
			["http:", "https:", "mailto:"].includes(url.protocol) &&
			!value.startsWith("//") &&
			/^(https?:|mailto:)/i.test(value)
		)
			return value;
	} catch {
		/* Treat invalid/relative links as text */
	}
	return undefined;
}
function nodes(tokens: Token[] = []): MarkdownNode[] {
	return tokens.flatMap((token): MarkdownNode[] => {
		switch (token.type) {
			case "space":
				return [t("\n")];
			case "heading":
				return [el("h4", nodes(token.tokens)), t("\n")];
			case "paragraph":
				return [el("p", nodes(token.tokens)), t("\n")];
			case "text":
				return token.tokens ? nodes(token.tokens) : [t(token.text)];
			case "escape":
				return [t(token.text)];
			case "strong":
				return [el("strong", nodes(token.tokens))];
			case "em":
				return [el("em", nodes(token.tokens))];
			case "del":
				return [el("s", nodes(token.tokens))];
			case "codespan":
				return [el("code", [t(token.text)])];
			case "code":
				return [el("pre", [el("code", [t(token.text)])]), t("\n")];
			case "br":
				return [t("\n")];
			case "hr":
				return [t("—\n")];
			case "html":
				return [t(token.text)];
			case "link":
				return [
					el(
						safeHref(token.href) ? "a" : "span",
						nodes(token.tokens),
						safeHref(token.href),
					),
				];
			case "image":
				return [t(`[Image: ${token.text}]`)];
			case "blockquote":
				return [el("blockquote", nodes(token.tokens)), t("\n")];
			case "list":
				return [
					el(
						token.ordered ? "ol" : "ul",
						token.items.flatMap((item: any) => [
							el("li", [
								...(item.task ? [t(item.checked ? "[x] " : "[ ] ")] : []),
								...nodes(item.tokens),
							]),
							t("\n"),
						]),
					),
					t("\n"),
				];
			case "table":
				return [
					el("table", [
						el("thead", [
							el(
								"tr",
								token.header.map((c: any) =>
									el("th", [...nodes(c.tokens), t("\t")]),
								),
							),
						]),
						t("\n"),
						el(
							"tbody",
							token.rows.flatMap((row: any[]) => [
								el(
									"tr",
									row.map((c) => el("td", [...nodes(c.tokens), t("\t")])),
								),
								t("\n"),
							]),
						),
					]),
					t("\n"),
				];
			case "def":
				return [];
			default:
				return [t((token as any).text || token.raw || "")];
		}
	});
}
// v1 canonical rendered text: normalize input to NFC/LF; parse fixed Marked version;
// concatenate text leaves, including explicit LF/tab separators. UTF-16 offsets.
// React renders this tree without innerHTML. There is one model for UI/server/tests.
export function markdownTree(source: string): MarkdownNode[] {
	const value = source.replace(/\r\n?/g, "\n").normalize("NFC");
	return nodes(marked.lexer(value, { gfm: true, breaks: false }));
}
export function markdownText(source: string) {
	const flatten = (n: MarkdownNode): string =>
		"text" in n ? n.text : n.children.map(flatten).join("");
	return markdownTree(source).map(flatten).join("");
}
