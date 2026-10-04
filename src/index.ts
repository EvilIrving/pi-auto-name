/**
 * pi-session-rename — give a session its name when the session ends.
 *
 * Why not name it at the start: sessions drift. Once the opening line ("pull it down for me")
 * becomes the name, the work that actually took hours is unfindable afterwards — and renaming
 * on every turn makes the list flicker.
 *
 * So the name is written at exactly one moment: **the session ended and you started the next
 * one**. pi's session_start event carries the previous session file (for reason new / resume /
 * fork it passes previousSessionFile), and by then the whole conversation is on disk, so the
 * model can read it once and return a name that still makes sense ten days later.
 *
 * Triggers:
 *   /new, /resume, /fork  → name previousSessionFile
 *   starting pi           → catch up on recent sessions of this directory that have no name yet
 *   /rename <title>       → name the current session with your title (auto-naming stands down)
 *   /rename               → name the current session from the conversation, right now
 *
 * Name format: `main title · subtitle`. The subtitle is optional — a session with only one
 * substantial task produces a main title alone. pi has a single `name` field and the built-in
 * picker shows one line per session, so both levels live in one string: main title first, and
 * the subtitle is what gets sacrificed when there is not enough width.
 *
 * The model call goes through pi's model registry (credentials and provider differences stay
 * pi's business). It does not use up the current session's model and never enters the current
 * session's context. Candidate order is documented in src/model.ts.
 *
 * Environment:
 *   PI_RENAME_AUTO=0                 disable automatic naming
 *   PI_RENAME_MODEL=provider/model   pick the model (highest priority)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { cleanName, decideName, isForeignName } from "./name.ts";
import { askModel, describeError, modelAccess, type ModelAccess } from "./model.ts";
import {
	appendName,
	buildConversation,
	buildPrompt,
	lastEntryId,
	readCurrentName,
	readEntries,
	readLastAutoName,
	recentOtherSessions,
	worthNaming,
} from "./session.ts";

export default function (pi: ExtensionAPI) {
	const state = { busy: false, lastNote: "(not run yet)" };

	/**
	 * Cosmetic footer status. It is written after the model call, by which time pi may already have
	 * invalidated the session this status belonged to: a stale handle must never turn a cosmetic
	 * update into an uncaught error inside a detached task.
	 */
	function setStatus(ui: ExtensionContext["ui"] | undefined, text: string | undefined): void {
		try {
			ui?.setStatus("session-rename", text);
		} catch {
			// The TUI this status belonged to is gone; there is nothing left to update.
		}
	}

	function notifyFailure(ui: ExtensionContext["ui"] | undefined): void {
		try {
			ui?.notify(`Session rename failed: ${state.lastNote}`, "warning");
		} catch {
			// Same: the session this job belonged to is gone, so there is nobody left to notify.
		}
	}

	/** Name a session file that has already ended. We append to it; the current session is never touched. */
	async function nameFinishedSession(
		access: ModelAccess,
		path: string,
		cwd: string,
		options: { skipAutoNamed: boolean },
	): Promise<void> {
		const entries = readEntries(path);
		if (entries.length === 0) return;

		const currentName = readCurrentName(entries);
		const lastAutoName = readLastAutoName(entries);
		if (isForeignName(currentName, lastAutoName)) {
			state.lastNote = `${path}: name written by the user, left alone`;
			return;
		}

		const conversation = buildConversation(entries);
		const verdict = worthNaming(conversation, options.skipAutoNamed && Boolean(lastAutoName));
		if (!verdict.ok) {
			state.lastNote = `${path}: ${verdict.reason}, not named`;
			return;
		}

		const { name, model } = await askModel(access, buildPrompt(conversation, cwd, currentName));
		const decision = decideName({ currentName, proposedName: name });
		state.lastNote = `${path}: ${decision.reason}`;
		if (!decision.write) return;
		appendName(path, lastEntryId(entries), name, model);
	}

	/** Name the current session (used by /rename and by the rename_session tool). */
	async function nameCurrentSession(ctx: ExtensionContext, signal: AbortSignal | undefined): Promise<void> {
		const entries = ctx.sessionManager.getBranch() as unknown[];
		const currentName = pi.getSessionName();
		const access = modelAccess(ctx);
		const cwd = ctx.cwd;
		const conversation = buildConversation(entries);
		if (!conversation.hasReply) {
			state.lastNote = "no reply yet, not named";
			return;
		}
		const { name } = await askModel(access, buildPrompt(conversation, cwd, currentName), signal);
		const decision = decideName({ currentName, proposedName: name });
		state.lastNote = decision.reason;
		if (!decision.write) return;
		try {
			pi.setSessionName(name);
		} catch (error) {
			// The ctx went stale while the model was answering: this session has already been replaced,
			// so there is no session left to rename.
			state.lastNote = describeError(error);
		}
	}

	pi.on("session_start", (event, ctx) => {
		if (process.env.PI_RENAME_AUTO === "0") return;
		if (state.busy) return;

		// new / resume / fork: the previous session just ended, and it is worth renaming once more
		// (a resumed session may have grown since it was last named).
		// startup: pi was quit last time, so catch up on recent sessions here that have no name yet.
		const targets =
			event.previousSessionFile && event.reason !== "reload"
				? { paths: [event.previousSessionFile], skipAutoNamed: false }
				: event.reason === "startup"
					? {
							paths: recentOtherSessions(ctx.sessionManager.getSessionDir(), ctx.sessionManager.getSessionFile()),
							skipAutoNamed: true,
						}
					: { paths: [] as string[], skipAutoNamed: true };
		if (targets.paths.length === 0) return;

		// pi awaits the whole session_start chain (dist/core/agent-session.js: `await emit`): /new,
		// /resume, /fork and startup all move forward on this event. Naming runs a model call — worst
		// case three candidates at a 120s timeout each — and waiting for it here makes the new session
		// unusable in the meantime (measured: right after /new, typing `/` did not open the command
		// palette). So return immediately and let naming continue in the background.
		//
		// Everything that job needs is read here, while this ctx is still alive: pi invalidates the ctx
		// of a session as soon as the session is replaced (/new, /fork, /resume) or extensions reload
		// (/reload), and every field of it throws from then on — including `model` and `modelRegistry`.
		// Touching ctx after the await is what crashed pi once (crashes.json 2026-09-23: `get hasUI` on
		// a stale ctx, thrown inside this detached task where nothing catches it).
		const access = modelAccess(ctx);
		const cwd = ctx.cwd;
		const ui = ctx.hasUI ? ctx.ui : undefined;

		void (async () => {
			state.busy = true;
			setStatus(ui, "naming previous session…");
			try {
				for (const path of targets.paths) {
					await nameFinishedSession(access, path, cwd, { skipAutoNamed: targets.skipAutoNamed });
				}
			} catch (error) {
				state.lastNote = describeError(error);
				// A failed automatic rename should not be completely silent: silence is only right on success.
				notifyFailure(ui);
			} finally {
				state.busy = false;
				setStatus(ui, undefined);
			}
		})();
	});

	pi.registerCommand("rename", {
		description: "Rename this session: /rename <title>, or /rename to name it from the conversation",
		handler: async (args, ctx) => {
			const literal = args.trim();
			if (literal) {
				const name = cleanName(literal) || literal;
				pi.setSessionName(name);
				ctx.ui.notify(`Session: ${name} (manual name, auto-naming will leave it alone)`, "info");
				return;
			}
			try {
				await nameCurrentSession(ctx, ctx.signal);
			} catch (error) {
				state.lastNote = describeError(error);
			}
			ctx.ui.notify(`Session: ${pi.getSessionName() ?? "(unnamed)"} — ${state.lastNote}`, "info");
		},
	});

	pi.registerTool({
		name: "rename_session",
		label: "Rename Session",
		description:
			"Rename the current session. Pass name to set it exactly (this hands naming back to the user), or omit name to name it from the conversation.",
		promptSnippet: "Rename the current session (names it from the conversation when name is omitted)",
		promptGuidelines: [
			"Use rename_session only when the user explicitly asks to name or rename the current session.",
			"Session names are otherwise set automatically when a session ends; do not rename on your own initiative.",
		],
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Exact title to set. Omit to generate one from the conversation." }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const literal = params.name?.trim();
			if (literal) {
				const name = cleanName(literal) || literal;
				pi.setSessionName(name);
				return {
					content: [{ type: "text" as const, text: `Session renamed to "${name}".` }],
					details: { name, manual: true },
				};
			}
			await nameCurrentSession(ctx, signal);
			const name = pi.getSessionName();
			return {
				content: [{ type: "text" as const, text: `Session renamed to "${name ?? ""}".` }],
				details: { name, manual: false, note: state.lastNote },
			};
		},
	});
}
