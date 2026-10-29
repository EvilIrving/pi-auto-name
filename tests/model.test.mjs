import assert from "node:assert/strict";
import test from "node:test";
import { parseModelRef, resolveModelRefs } from "../src/model.ts";

test("parseModelRef splits provider and model ID", () => {
	assert.deepEqual(parseModelRef("openai/gpt-4o-mini"), { provider: "openai", model: "gpt-4o-mini" });
	assert.deepEqual(parseModelRef("anthropic/claude-3-5-haiku"), { provider: "anthropic", model: "claude-3-5-haiku" });
	assert.equal(parseModelRef("invalid-no-slash"), undefined);
	assert.equal(parseModelRef(""), undefined);
});

test("resolveModelRefs respects override, config, and deduplication", () => {
	const config = {
		model: "anthropic/claude-3-5-haiku",
		models: ["openai/gpt-4o-mini", "anthropic/claude-3-5-haiku"],
	};

	// Without override: config.model first, then config.models (deduplicated)
	const resolvedWithoutOverride = resolveModelRefs(config, undefined);
	assert.deepEqual(resolvedWithoutOverride, [
		{ provider: "anthropic", model: "claude-3-5-haiku" },
		{ provider: "openai", model: "gpt-4o-mini" },
	]);

	// With override: override wins priority
	const resolvedWithOverride = resolveModelRefs(config, "google/gemini-2.5-flash");
	assert.deepEqual(resolvedWithOverride, [
		{ provider: "google", model: "gemini-2.5-flash" },
		{ provider: "anthropic", model: "claude-3-5-haiku" },
		{ provider: "openai", model: "gpt-4o-mini" },
	]);
});
