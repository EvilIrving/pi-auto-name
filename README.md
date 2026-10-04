# pi-auto-name

Name a pi session **when it ends**, from what the session actually did — so that ten days later you still recognize which run it was when you scan the session picker.

```bash
pi install npm:@light-cat/pi-auto-name
```

Pi extension. Names sessions automatically with an LLM, and leaves a name you wrote alone.

## Why not name it up front

Sessions drift. If the opening line ("pull it down for me") becomes the name, the work that actually took hours is unfindable afterwards; and renaming on every turn makes the list flicker.

So the name is written at exactly one moment: **the session ended and you started the next one**. By then the whole conversation is on disk, and the model can give it a name that sticks to the substance.

## Triggers

| Action | What gets named |
| --- | --- |
| `/new`, `/resume`, `/fork` | the session that just ended (a resumed session is renamed again) |
| starting pi | recent sessions from this directory that ended without a name (last 24h, up to 3, never one this extension already named) |
| `/autoname` | the current session, regenerated from the conversation right now |

## `/autoname` and pi's own `/name`

They do different things and do not compete:

- `/name My title` — pi's built-in. You write the title.
- `/autoname` — this extension. The model reads the conversation and writes the title; use it to
  force a name now instead of waiting for the session to end.

A name you wrote with `/name`, `pi --name`, or the session picker is detected as foreign and never
overwritten by either path.

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

Config file: `~/.pi/agent/config/auto-name.json`

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

## How it works

1. A session ends (`/new`, `/resume`, `/fork`) or pi starts.
2. The handler reads the finished session file and returns immediately, so the new session is usable at once.
3. In the background, the conversation is folded into a small prompt: the user messages, the last
   assistant replies, and the tool names that were used.
4. The model returns one line, which is cleaned (quotes, `Title:` preambles, trailing punctuation)
   and split into `main title · subtitle`.
5. Two entries are appended to the finished session file: a `session_info` entry the picker reads,
   and a marker entry recording that this name came from the extension.

Short sessions are never sent to a model at all: fewer than 2 user turns, or a first message under
200 characters, is skipped locally.

## Privacy

The naming model receives a short excerpt of the session, capped per message and limited to a small
number of blocks — never the full transcript, never file contents. It runs through pi's own model
registry, so no new third party sees the data beyond the model provider you already use.

Only finished session files are written. The live session, its context, and the conversation are
never modified.

## Language support

The name is written in the language the conversation mainly used, decided by the same model that
writes the name. Chinese and Japanese names are measured in display cells rather than characters,
so a CJK title is cut at 14 characters and a Latin one at 28.

## Related

- [pi](https://pi.dev) — the agent this extends
- [`pi-simplify`](https://npmjs.com/package/pi-simplify) — review recently changed code

## Limits

- **Names you wrote are never touched.** Anything set via `/name`, `pi --name`, or the session picker (Ctrl+R) is left alone.
- **Short sessions are skipped**: fewer than 2 user turns and a first message under 200 characters.
- **Failures are silent**: no model available, a timeout (120s), or an empty name all just leave the previous name in place, and never affect the session itself.
- **Only finished session files are written**: two appended entries (`session_info` plus a marker entry), never the live session, never the conversation content.
- **`PI_RENAME_AUTO=0`** disables automatic naming. `/autoname` still works.

## Layout

```
src/
├── index.ts     extension entry: session_start (background naming), /autoname command
├── name.ts      cleaning and truncation of a name (main title / subtitle, width, quotes, preambles)
├── session.ts   reading session material, building the prompt, writing the name into a finished session file
└── model.ts     resolving candidate models and issuing the request through pi's model registry
```

## License

MIT
