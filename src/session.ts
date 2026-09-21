/**
 * The session itself: reading a finished conversation into material for the model, and writing
 * the resulting name back into the session file.
 *
 * The write is two appended entries, which is safe because a finished session file is no longer
 * open in pi: one `session_info` (what the picker reads) and one marker entry of our own (so we
 * know next time that the name was ours, and leave human-written names alone).
 */

import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { MAX_SUBTITLE_CHARS, MAX_TITLE_CHARS, NAME_SEPARATOR, clipPhrase } from "./name.ts";

/** Names we wrote are recorded under this customType, which separates "ours" from "the user's". */
export const ENTRY_TYPE = "session-rename";
/** Sessions this short are not worth naming (a single "hi" and a reply). */
export const MIN_USER_TURNS = 2;
export const MIN_FIRST_MESSAGE_CHARS = 200;
/** Startup catch-up only looks at sessions that ended within this window. */
export const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SessionEntry = {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	name?: string;
	customType?: string;
	data?: { name?: string; title?: string; auto?: boolean; model?: string };
	message?: { role?: string; content?: unknown };
};

type MessagePart = { type?: string; text?: string; name?: string };
type Block = { role: "User" | "Assistant"; text: string };
export type Conversation = { text: string; tools: string[]; userTurns: number; firstUserChars: number; hasReply: boolean };

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is MessagePart => Boolean(part) && typeof part === "object")
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("\n");
}

function countImages(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	return content.filter((part) => Boolean(part) && typeof part === "object" && (part as MessagePart).type === "image").length;
}

function collectToolNames(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((part): part is MessagePart => Boolean(part) && typeof part === "object")
		.filter((part) => part.type === "toolCall" && typeof part.name === "string")
		.map((part) => part.name ?? "");
}

function clip(text: string, limit: number): string {
	const trimmed = text.trim();
	return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/**
 * Pick the blocks the model gets to see: the first 2, an even sample from the middle, the last 8.
 *
 * Keeping only head and tail loses the body of the session: the head is the warm-up, the tail is
 * the wrap-up, and the part that took hours sits in between — which is exactly how a name ends up
 * being the opening line.
 */
export function selectBlocks(blocks: Block[], limit = 20): Block[] {
	if (blocks.length <= limit) return blocks;
	const head = blocks.slice(0, 2);
	const tail = blocks.slice(-8);
	const middleCount = Math.max(0, limit - head.length - tail.length);
	const start = head.length;
	const span = blocks.length - tail.length - start;
	const picked: Block[] = [...head];
	for (let index = 0; index < middleCount && span > 0; index += 1) {
		picked.push(blocks[start + Math.floor((span * (index + 0.5)) / middleCount)]);
	}
	return [...picked, ...tail];
}

/** Compress a session into model-facing material. Turns that only carry images still count. */
export function buildConversation(entries: unknown[]): Conversation {
	const blocks: Block[] = [];
	const tools = new Set<string>();
	let userTurns = 0;
	let firstUserChars = 0;

	for (const entry of entries as SessionEntry[]) {
		if (entry?.type !== "message") continue;
		const role = entry.message?.role;
		if (role !== "user" && role !== "assistant") continue;

		const text = extractText(entry.message?.content);
		const images = countImages(entry.message?.content);
		if (role === "user") {
			userTurns += 1;
			if (firstUserChars === 0) firstUserChars = text.trim().length || (images > 0 ? 150 : 0);
		} else {
			for (const name of collectToolNames(entry.message?.content)) tools.add(name);
		}

		const composed = [text, images > 0 ? `[images ×${images}]` : ""].filter(Boolean).join(" ").trim();
		if (!composed) continue;
		blocks.push({ role: role === "user" ? "User" : "Assistant", text: clip(composed, 400) });
	}

	return {
		text: selectBlocks(blocks)
			.map((block) => `${block.role}: ${block.text}`)
			.join("\n\n"),
		tools: [...tools].slice(0, 12),
		userTurns,
		firstUserChars,
		hasReply: blocks.some((block) => block.role === "Assistant"),
	};
}

export function buildPrompt(conversation: Conversation, cwd: string, currentName: string | undefined): string {
	const lines = [
		"You name a coding session that just ended. The name has exactly one job: ten days from now,",
		"when the user scans their session list, they recognize what that session did and can find it again.",
		"",
		"Output format (one line only: no explanation, no code block, no quotes):",
		`main title${NAME_SEPARATOR}subtitle`,
		"The subtitle is optional: when there is no second substantial task, output the main title alone,",
		"with no separator, and do not invent a subtitle to fill the line.",
		"",
		`- Main title, at most ${MAX_TITLE_CHARS} characters: the thing the session mostly did, a noun phrase`,
		"  with a concrete object and an action. If the session switched tasks, use the one that took most of",
		"  the work (the opening warm-up does not count, and neither does the closing wrap-up). Avoid empty",
		'  phrases like "code discussion", "new session" or "chatting", and never quote the user.',
		`- Subtitle, at most ${MAX_SUBTITLE_CHARS} characters: only when the session really contains a second`,
		"  substantial task — give that one a short name. In Chinese, prefix it with 「另」. Otherwise leave the",
		"  subtitle out completely; do not pad it with the main task's outcome, its scope, or a restatement.",
		"  An opening pull, a quick look, or small talk is not a substantial task.",
		"- Write in the language the session mainly used. Noun phrases, no trailing punctuation.",
	];
	lines.push(`Working directory: ${cwd}`, `Current name: ${currentName ?? "(none yet)"}`);
	if (conversation.tools.length > 0) lines.push(`Tools used: ${conversation.tools.join(", ")}`);
	lines.push(
		"",
		"<conversation>",
		conversation.text,
		"</conversation>",
		"",
		"Output that one name line only: no explanation, do not describe the session again.",
	);
	return lines.join("\n");
}

export function readEntries(path: string): SessionEntry[] {
	try {
		return readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as SessionEntry);
	} catch {
		return [];
	}
}

export function lastEntryId(entries: SessionEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const id = entries[index]?.id;
		if (id) return id;
	}
	return null;
}

/** The name the session currently carries. */
export function readCurrentName(entries: SessionEntry[]): string | undefined {
	let name: string | undefined;
	for (const entry of entries) {
		if (entry?.type === "session_info" && entry.name?.trim()) name = entry.name.trim();
	}
	return name;
}

/** The last name we wrote ourselves (older records that only stored `title` still count). */
export function readLastAutoName(entries: unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = (entries[index] ?? {}) as SessionEntry;
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const name = entry.data?.name ?? entry.data?.title;
		if (name?.trim()) return name.trim();
	}
	return undefined;
}

/**
 * Write a name into a finished session file.
 *
 * Once the session has ended this file is no longer open in pi, so appending two entries is safe:
 * one `session_info` (the picker reads this) and one record of our own (so the next run knows the
 * name was ours). `parentId` continues the last entry so the session tree stays one chain.
 */
export function appendName(path: string, previousId: string | null, name: string, model: string): void {
	const timestamp = new Date().toISOString();
	const infoId = randomUUID().replace(/-/g, "").slice(0, 8);
	const recordId = randomUUID().replace(/-/g, "").slice(0, 8);
	appendFileSync(path, `${JSON.stringify({ type: "session_info", id: infoId, parentId: previousId, timestamp, name })}\n`);
	appendFileSync(
		path,
		`${JSON.stringify({
			type: "custom",
			id: recordId,
			parentId: infoId,
			timestamp,
			customType: ENTRY_TYPE,
			data: { name, model, auto: true },
		})}\n`,
	);
}

/** Startup catch-up: session files in this directory that ended recently, excluding the current one. */
export function recentOtherSessions(dir: string | undefined, exclude: string | undefined): string[] {
	if (!dir) return [];
	try {
		const now = Date.now();
		return readdirSync(dir)
			.filter((entry) => entry.endsWith(".jsonl"))
			.map((entry) => join(dir, entry))
			.filter((path) => path !== exclude)
			.map((path) => ({ path, modified: statSync(path).mtimeMs }))
			.filter((file) => now - file.modified < CATCH_UP_WINDOW_MS)
			.sort((left, right) => right.modified - left.modified)
			.slice(0, 3)
			.map((file) => file.path);
	} catch {
		return [];
	}
}

/** Whether this file deserves a model call at all: not too short, not half-finished, not already named by us. */
export function worthNaming(conversation: Conversation, alreadyAutoNamed: boolean): { ok: boolean; reason: string } {
	if (alreadyAutoNamed) return { ok: false, reason: "already auto-named" };
	if (!conversation.hasReply) return { ok: false, reason: "no reply" };
	const enough = conversation.userTurns >= MIN_USER_TURNS || conversation.firstUserChars >= MIN_FIRST_MESSAGE_CHARS;
	if (!enough) return { ok: false, reason: "too short" };
	return { ok: true, reason: "" };
}

export { clipPhrase };
