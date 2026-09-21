/**
 * The name itself: turning model output into `main title · subtitle`, and deciding when the
 * name may be written and when it has to give way to the one the user wrote.
 */

export const NAME_SEPARATOR = " · ";
export const MAX_TITLE_CHARS = 14;
export const MAX_SUBTITLE_CHARS = 20;

/** CJK / full-width characters take two cells, everything else takes one. */
function charWidth(character: string): number {
	const code = character.codePointAt(0) ?? 0;
	const wide =
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6);
	return wide ? 2 : 1;
}

/** Truncate by display width: 14 CJK characters are 28 cells, Latin counts per cell, and we never cut half a character or leave half a word. */
export function clipPhrase(text: string, maxChars: number): string {
	const trimmed = text.trim();
	const budget = maxChars * 2;
	let width = 0;
	let used = 0;
	for (const character of trimmed) {
		const next = charWidth(character);
		if (width + next > budget) break;
		width += next;
		used += character.length;
	}
	if (used >= trimmed.length) return trimmed;
	return trimmed.slice(0, used).replace(/[。，、,.;；:：\s]+$/, "").trim();
}

/**
 * Turn raw model output into a name: keep the name line only (skip preambles like "Sure:"),
 * strip quotes and a "Title:" prefix, split on `main title · subtitle` and clamp both parts.
 *
 * The subtitle is optional: when the model returns only a main title, or both parts repeat
 * each other, the name is the main title itself — nothing is padded in.
 */
export function cleanName(raw: string): string {
	const lines = raw
		.split("\n")
		.map((item) => item.trim())
		.filter((item) => item.length >= 2);
	const line = lines.find((item) => !/[:：]$/.test(item)) ?? lines[0];
	if (!line) return "";

	const text = line
		.replace(/^[#*>\-\s]+/, "")
		.replace(/^(?:session\s+)?(?:title|name|标题|名称|会话名称)\s*[:：\-]\s*/i, "")
		// Any short "<something>:" prefix is a preamble ("Sure:", "The result is:").
		.replace(/^[^:：]{0,6}[:：]\s*(?=\S{2,})/, "")
		.replace(/^["'“”「」『』【】[\]]+|["'“”「」『』【】[\]]+$/g, "")
		.replace(/[。，、,.;；:：!！?？]+$/, "")
		.trim();
	if (text.length < 2) return "";

	const [head, ...rest] = text
		.split(/[·|｜]/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (!head) return "";

	const title = clipPhrase(head, MAX_TITLE_CHARS);
	const subtitle = clipPhrase(rest.join(" "), MAX_SUBTITLE_CHARS);
	if (!title) return subtitle;
	if (!subtitle || subtitle === title || title.includes(subtitle)) return title;
	return `${title}${NAME_SEPARATOR}${subtitle}`;
}

/** Comparison form: whitespace and case are ignored. */
export function normalizeName(raw: string | undefined | null): string {
	if (!raw) return "";
	return String(raw).replace(/[\s\u3000]+/g, "").toLowerCase();
}

/** Empty names are not written, identical names are not written, everything else is. The model decides what the name should be; this only prevents pointless writes. */
export function decideName(input: { currentName?: string; proposedName: string }): { write: boolean; reason: string } {
	if (!input.proposedName.trim()) return { write: false, reason: "empty" };
	if (normalizeName(input.currentName) === normalizeName(input.proposedName)) return { write: false, reason: "unchanged" };
	return { write: true, reason: "changed" };
}

/** The name was not written by us (`/name`, `pi --name`, renamed in the picker) → this session belongs to the user. */
export function isForeignName(currentName: string | undefined, lastAutoName: string | undefined): boolean {
	if (!currentName?.trim()) return false;
	if (!lastAutoName?.trim()) return true;
	return normalizeName(currentName) !== normalizeName(lastAutoName);
}
