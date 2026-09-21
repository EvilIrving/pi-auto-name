# pi-session-rename

Name a pi session **when it ends**, from what the session actually did — so that ten days later you still recognize which run it was when you scan the session picker.

```bash
pi install npm:pi-session-rename
```

## Why not name it up front

Sessions drift. If the opening line ("pull it down for me") becomes the name, the work that actually took hours is unfindable afterwards; and renaming on every turn makes the list flicker.

So the name is written at exactly one moment: **the session ended and you started the next one**. By then the whole conversation is on disk, and the model can give it a name that sticks to the substance.

## Triggers

| Action | What gets named |
| --- | --- |
| `/new`, `/resume`, `/fork` | the session that just ended (a resumed session is renamed again) |
| starting pi | recent sessions from this directory that ended without a name (last 24h, up to 3, never one this extension already named) |
| `/rename <title>` | the current session, with your title (auto-naming then leaves it alone) |
| `/rename` | the current session, regenerated from the conversation |

Naming runs in the background and never blocks the UI: after `/new` the command palette is usable right away. pi awaits the whole `session_start` chain, so the handler returns immediately and does the model call detached.

## What a name looks like

`main title · subtitle`, both inside the single `name` field (pi's session picker shows one line per session):

```
CI workflow split · debug non-git repo
voice waveform recording · interruption handling
```

- Main title, ≤14 characters: what the session mainly did. If the session switched tasks, it is the one that took most of the work — not the opening line.
- Subtitle, optional, ≤20 characters: only when the session really contains a second substantial task. Otherwise it is omitted entirely — no padding with the main task's outcome or a restatement.
- Truncated by display width (a CJK character counts as two cells) and written in the language the session mainly used.

## Model selection

Tried in order, first success wins:

1. `PI_RENAME_MODEL` environment variable, `provider/model`
2. `model` in the config file
3. `models[]` in the config file (fallbacks in order)
4. the session's own model — the default when nothing is configured, so it works out of the box

Config file: `~/.pi/agent/config/session-rename.json`

```json
{
  "model": "opencode-go/deepseek-flash",
  "models": ["zai/glm-5.3-flash"],
  "thinking": "off"
}
```

| Field | Meaning |
| --- | --- |
| `model` | preferred model, `provider/model` |
| `models` | fallbacks, tried in order |
| `thinking` | `off` / `minimal` / `low` / `medium` / `high`; omitted by default |

Any model pi can use is valid here. Credentials, base URLs and provider-specific request quirks are resolved by pi's own model registry — this extension never reads `models.json` or `auth.json`. Names are short: a small fast model is the better choice, since a reasoning model is slower and may spend its budget thinking.

## Limits

- **Names you wrote are never touched.** Anything set via `/name`, `pi --name`, the session picker (Ctrl+R), or `/rename <title>` is left alone.
- **Short sessions are skipped**: fewer than 2 user turns and a first message under 200 characters.
- **Failures are silent**: no model available, a timeout (120s), or an empty name all just leave the previous name in place, and never affect the session itself.
- **Only finished session files are written**: two appended entries (`session_info` plus a marker entry), never the live session, never the conversation content.
- **`PI_RENAME_AUTO=0`** disables all automatic naming (`/rename` still works).

## Layout

```
src/
├── index.ts     extension entry: session_start (background naming), /rename command, rename_session tool
├── name.ts      cleaning and truncation of a name (main title / subtitle, width, quotes, preambles)
├── session.ts   reading session material, building the prompt, writing the name into a finished session file
└── model.ts     resolving candidate models and issuing the request through pi's model registry
```

## License

MIT
