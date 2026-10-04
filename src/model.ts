/**
 * Which model names the session.
 *
 * This module only decides the candidate list; the request itself goes through the model registry
 * taken from the ctx (see `ModelAccess`), so credentials, base URLs and per-provider request quirks
 * stay pi's business. We never read `models.json` or `auth.json`, and no provider is hardcoded.
 *
 * Order (first success wins):
 *   PI_RENAME_MODEL → config `model` → config `models[]` → the session's own model
 * With nothing configured it follows the session model and works out of the box; pin a small
 * model if you want it cheaper or faster.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cleanName } from "./name.ts";

export type ModelRef = { provider: string; model: string };

export type RenameConfig = {
	model?: string;
	models?: string[];
	thinking?: string;
};

export const CONFIG_FILE = "config/auto-name.json";
export const MAX_OUTPUT_TOKENS = 4096;
export const REQUEST_TIMEOUT_MS = 120_000;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function configPath(): string {
	return join(getAgentDir(), "config", "auto-name.json");
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readConfigFile(): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		// No config file, or broken JSON: treated as "not configured", so naming falls back to the session model.
		return {};
	}
}

export function readConfig(): RenameConfig {
	const raw = readConfigFile();
	const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
	const models = Array.isArray(raw.models)
		? raw.models.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
		: undefined;
	const thinking = typeof raw.thinking === "string" && (THINKING_LEVELS as readonly string[]).includes(raw.thinking)
		? raw.thinking
		: undefined;
	return { model, models, thinking };
}

export function parseModelRef(ref: string): ModelRef | undefined {
	const [provider, model] = ref.trim().split("/");
	if (!provider || !model) return undefined;
	return { provider, model };
}

/** Deduplicated candidates; an empty array means "follow the session's own model". */
export function resolveModelRefs(config: RenameConfig, override: string | undefined = process.env.PI_RENAME_MODEL): ModelRef[] {
	const refs = [override?.trim(), config.model, ...(config.models ?? [])].filter(
		(ref): ref is string => Boolean(ref && ref.trim()),
	);
	const seen = new Set<string>();
	const parsed: ModelRef[] = [];
	for (const ref of refs) {
		const parsedRef = parseModelRef(ref);
		if (!parsedRef) continue;
		const key = `${parsedRef.provider}/${parsedRef.model}`;
		if (seen.has(key)) continue;
		seen.add(key);
		parsed.push(parsedRef);
	}
	return parsed;
}

function withDeadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

type RegistryModel = NonNullable<ExtensionContext["model"]>;

/**
 * The two things a model call needs, read from a ctx **while that ctx is still alive**.
 *
 * pi invalidates an extension ctx as soon as the session is replaced (/new, /fork, /resume) or
 * extensions reload (/reload); from then on every field of that ctx — `model` and `modelRegistry`
 * included — throws. Naming the previous session runs for seconds after /new returns, so the job
 * must carry these values instead of holding the ctx across the await.
 */
export type ModelAccess = {
	registry: ExtensionContext["modelRegistry"];
	sessionModel: ExtensionContext["model"] | undefined;
};

export function modelAccess(ctx: ExtensionContext): ModelAccess {
	return { registry: ctx.modelRegistry, sessionModel: ctx.model };
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } =>
			Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

/** Try each candidate in order and return the first name that comes out usable. */
export async function askModel(
	access: ModelAccess,
	prompt: string,
	signal?: AbortSignal,
): Promise<{ name: string; model: string }> {
	const config = readConfig();
	const refs = resolveModelRefs(config);
	const sessionModel = access.sessionModel as RegistryModel | undefined;

	type Candidate = { label: string; model: RegistryModel | undefined };
	const candidates: Candidate[] =
		refs.length > 0
			? refs.map((ref) => ({ label: `${ref.provider}/${ref.model}`, model: access.registry.find(ref.provider, ref.model) }))
			: [{ label: sessionModel ? `${sessionModel.provider}/${sessionModel.id}` : "session model", model: sessionModel }];

	const thinking = config.thinking as ThinkingLevel | undefined;
	const failures: string[] = [];

	for (const candidate of candidates) {
		if (!candidate.model) {
			failures.push(`${candidate.label}: model not found (check the provider and model id in models.json)`);
			continue;
		}
		try {
			const response = await access.registry
				.streamSimple(
					candidate.model,
					{
						systemPrompt: "You output a single line: the session name. No explanation, no code block, no quotes.",
						messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }],
					},
					{
						maxTokens: MAX_OUTPUT_TOKENS,
						maxRetries: 0,
						signal: withDeadline(signal, REQUEST_TIMEOUT_MS),
						// Some gateways only route a request that carries a session identifier (the opencode
						// gateway answers 400 MissingSessionID without it). pi expresses this as `sessionId`;
						// turning it into the provider's header is the provider's job.
						sessionId: randomUUID(),
						...(thinking && thinking !== "off" ? { reasoning: thinking } : {}),
					},
				)
				.result();

			if (response.stopReason === "error") throw new Error(response.errorMessage || "model returned an error");
			const name = cleanName(textOf(response.content));
			if (!name) {
				failures.push(`${candidate.label}: empty name`);
				continue;
			}
			return { name, model: candidate.label };
		} catch (error) {
			failures.push(`${candidate.label}: ${describeError(error)}`);
		}
	}

	throw new Error(failures.join("; ") || "no model available");
}
