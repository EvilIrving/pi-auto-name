import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	appendName,
	buildConversation,
	buildPrompt,
	lastEntryId,
	readCurrentName,
	readEntries,
	readLastAutoName,
	selectBlocks,
	worthNaming,
	ENTRY_TYPE,
} from "../src/session.ts";

test("readEntries is resilient to corrupted JSON lines", () => {
	const tmpFile = path.join(os.tmpdir(), `pi-an-test-${Date.now()}.jsonl`);
	const lines = [
		JSON.stringify({ type: "session_info", id: "1", name: "Alpha" }),
		"CORRUPTED_JSON_NOT_VALID_HERE{",
		JSON.stringify({ type: "message", id: "2", message: { role: "user", content: "hello" } }),
		"",
	];
	fs.writeFileSync(tmpFile, lines.join("\n"));

	try {
		const entries = readEntries(tmpFile);
		assert.equal(entries.length, 2, "must parse 2 valid entries despite corrupted line");
		assert.equal(entries[0].id, "1");
		assert.equal(entries[1].id, "2");
	} finally {
		if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
	}
});

test("lastEntryId, readCurrentName, and readLastAutoName extract records accurately", () => {
	const entries = [
		{ type: "session_info", id: "e1", name: "Initial Name" },
		{ type: "message", id: "e2", message: { role: "user", content: "test" } },
		{ type: "custom", id: "e3", customType: ENTRY_TYPE, data: { name: "Auto Title", model: "test/model" } },
	];

	assert.equal(lastEntryId(entries), "e3");
	assert.equal(readCurrentName(entries), "Initial Name");
	assert.equal(readLastAutoName(entries), "Auto Title");
});

test("selectBlocks preserves first 2, middle samples, and last 8", () => {
	const blocks = Array.from({ length: 30 }, (_, i) => ({
		role: i % 2 === 0 ? "User" : "Assistant",
		text: `Block ${i + 1}`,
	}));

	const selected = selectBlocks(blocks, 20);
	assert.equal(selected.length, 20);
	assert.equal(selected[0].text, "Block 1");
	assert.equal(selected[1].text, "Block 2");
	assert.equal(selected.at(-1).text, "Block 30");
	assert.equal(selected.at(-8).text, "Block 23");
});

test("worthNaming rules enforce minimal content", () => {
	const base = { text: "hello", tools: [], userTurns: 1, firstUserChars: 20, hasReply: true };

	// Already auto-named
	assert.equal(worthNaming(base, true).ok, false);

	// No assistant reply
	assert.equal(worthNaming({ ...base, hasReply: false }, false).ok, false);

	// Too short: 1 turn, under 200 chars
	assert.equal(worthNaming(base, false).ok, false);

	// Enough turns: >= 2
	assert.equal(worthNaming({ ...base, userTurns: 2 }, false).ok, true);

	// Enough initial chars: >= 200
	assert.equal(worthNaming({ ...base, firstUserChars: 200 }, false).ok, true);
});

test("buildPrompt includes conversation and optional user preference", () => {
	const conv = {
		text: "User: Can you fix the auth bug?\nAssistant: Fixed.",
		tools: ["read", "edit"],
		userTurns: 2,
		firstUserChars: 30,
		hasReply: true,
	};

	const promptNoPref = buildPrompt(conv, "/workspace/demo", "Old Name");
	assert.ok(promptNoPref.includes("Working directory: /workspace/demo"));
	assert.ok(promptNoPref.includes("Current name: Old Name"));
	assert.ok(promptNoPref.includes("Tools used: read, edit"));
	assert.ok(!promptNoPref.includes("User focus / preference"));

	const promptWithPref = buildPrompt(conv, "/workspace/demo", "Old Name", "focus on auth refactor");
	assert.ok(promptWithPref.includes("User focus / preference: focus on auth refactor"));
});
