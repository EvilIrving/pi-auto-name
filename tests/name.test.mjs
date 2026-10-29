import assert from "node:assert/strict";
import test from "node:test";
import {
	clipPhrase,
	cleanName,
	decideName,
	isForeignName,
	normalizeName,
	MAX_TITLE_CHARS,
	MAX_SUBTITLE_CHARS,
} from "../src/name.ts";

test("clipPhrase handles ASCII, CJK and punctuation correctly", () => {
	// 14 CJK characters = 28 display width
	const cjk = "这是一个超过十四个字符的中文会话标题测试内容";
	const clippedCjk = clipPhrase(cjk, MAX_TITLE_CHARS);
	assert.equal(clippedCjk.length, MAX_TITLE_CHARS);

	// ASCII characters
	const ascii = "Fix login crash and token expiration in auth module";
	const clippedAscii = clipPhrase(ascii, MAX_TITLE_CHARS);
	assert.ok(clippedAscii.length <= MAX_TITLE_CHARS * 2);

	// Trailing punctuation is stripped
	assert.equal(clipPhrase("fix auth bugs,; ", 10), "fix auth bugs");
	assert.equal(clipPhrase("修复用户登录问题，", 10), "修复用户登录问题");
});

test("cleanName strips quotes, preambles, and parses subtitle", () => {
	// Markdown, prefixes and quotes stripped
	assert.equal(cleanName('**Title:** "重构用户认证模块"'), "重构用户认证模块");
	assert.equal(cleanName("会话名称： 修复路由跳转 bug"), "修复路由跳转 bug");
	assert.equal(cleanName('Sure: "Voice waveform · Interruption"'), "Voice waveform · Interruption");

	// Main title and subtitle split on dot or pipe
	assert.equal(cleanName("CI workflow split · debug non-git repo"), "CI workflow split · debug non-git repo");
	assert.equal(cleanName("CI workflow split | debug non-git repo"), "CI workflow split · debug non-git repo");

	// Subtitle identical to main title is dropped
	assert.equal(cleanName("重构路由 · 重构路由"), "重构路由");
	assert.equal(cleanName("重构路由 · 路由"), "重构路由");
});

test("decideName avoids empty and redundant writes", () => {
	assert.deepEqual(decideName({ proposedName: "" }), { write: false, reason: "empty" });
	assert.deepEqual(decideName({ currentName: "修复登录", proposedName: " 修复登录 " }), {
		write: false,
		reason: "unchanged",
	});
	assert.deepEqual(decideName({ currentName: "Fix Login", proposedName: "fix login" }), {
		write: false,
		reason: "unchanged",
	});
	assert.deepEqual(decideName({ currentName: "修复登录", proposedName: "修复支付" }), {
		write: true,
		reason: "changed",
	});
});

test("isForeignName distinguishes user-set names from auto names", () => {
	// No current name -> not foreign
	assert.equal(isForeignName(undefined, undefined), false);
	assert.equal(isForeignName("", "auto-title"), false);

	// Has current name, but no auto name marker -> written by user
	assert.equal(isForeignName("User Custom Title", undefined), true);

	// Current name matches last auto name -> ours
	assert.equal(isForeignName("Auto Title", "Auto Title"), false);
	assert.equal(isForeignName("Auto Title", "auto title"), false);

	// Current name changed after auto name -> user touched it
	assert.equal(isForeignName("Manual Edit", "Auto Title"), true);
});
