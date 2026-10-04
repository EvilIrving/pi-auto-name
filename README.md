# pi-auto-name

**You have 400 sessions and no idea which one is which.**

pi shows the first message of a session in the picker. That is fine for the session you are in, and
useless for the session you were in last month — because the message that opens a session is almost
never what the session turned out to be. You opened with "pull it down for me" and spent six hours
splitting the CI workflow. Later, scanning the list, all you see is "pull it down for me".

This extension reads the session once it is over and gives it a name worth keeping:

```
CI workflow split · debug non-git repo
voice waveform recording · interruption handling
```

```bash
pi install npm:@light-cat/pi-auto-name
```

No configuration. It works out of the box and never blocks anything.

## Why the name is written at the end

Most auto-namers name a session from its first exchange, then keep re-naming it as the conversation
moves. Both halves of that are wrong for this problem.

**Naming early means naming the wrong thing.** At the first exchange, the only material is the
opening line — the same thing the picker already shows you. The interesting part of a long session
is in the middle, and it does not exist yet.

**Naming continuously means the list flickers.** A name that changes every few minutes is not
something you can recognize; it is something you re-read every time. Worse, it writes session
metadata on a schedule, so the picker is never quite settled.

So the name is written at exactly one moment: **the session ended and you started the next one.**
Everything is already on disk by then, so the model reads the whole session once — beginning, the
part that took hours, and the wrap-up — and produces one name that will still make sense in ten
days. That is the entire design.

## What you get

| When | What happens |
| --- | --- |
| You run `/new`, `/resume`, or `/fork` | The session you just left gets named. A resumed session is re-named, because it grew since last time. |
| You start pi | Sessions from this directory that ended in the last 24h without a name get caught up — at most 3, most recent first. Covers the times pi was killed instead of exited. |
| You run `/autoname` | The current session is named right now, from its conversation so far. |

Nothing else. No timers, no background loop, no rename on a schedule.

## `/autoname` and pi's own `/name`

They do different jobs and do not compete:

- **`/name My title`** — pi's built-in. *You* write the title. Use it when you already know what to
  call the session.
- **`/autoname`** — this extension. The *model* reads the conversation and writes the title. Use it
  when you want a name now instead of waiting for the session to end.

**A name you wrote is never overwritten.** Anything set through `/name`, `pi --name`, or the session
picker is detected as yours, and both paths back off permanently. If you name a session by hand,
this extension will never touch it again.

## What a name looks like, and why

```
main title · subtitle
```

Both halves live in pi's single `name` field — the picker shows one line per session, so splitting
into two fields would not display anywhere.

**The main title (≤14 characters) is what the session mostly did.** Not what it opened with. If the
session switched tasks, it is the one that ate the time. The model is told explicitly that the
opening warm-up and the closing wrap-up do not count, and that "code discussion" / "new session" /
"chatting" are not names.

**The subtitle (≤20 characters) is optional, and stays absent when there is nothing to say.** It
appears only when the session genuinely contained a second substantial task — in Chinese it is
prefixed with 「另」. The prompt forbids padding it with the main task's outcome or a restatement.
Most sessions should have a title and nothing else.

The two-level split exists because of how you actually scan the list: the main title is what you
read, and the subtitle is what gets sacrificed when the column is too narrow. So the important word
goes first, always.

**Names are written in the language the session used**, and Chinese/Japanese titles are measured in
display cells, not characters — a CJK title cuts at 14 characters, a Latin one at 28, so both occupy
roughly the same width in the picker.

## How it works

1. A session ends (`/new`, `/resume`, `/fork`) or pi starts.
2. The handler returns immediately. pi blocks the new session on `session_start`, so waiting here
   would freeze the command palette — the model call is detached and runs in the background.
3. The conversation is folded into a small prompt: user messages, the last assistant replies, and
   the tools that were used. Messages are capped at 400 characters each, and at most 20 blocks are
   selected — the first 2, a sample from the middle, and the last 8.
4. The model returns one line. It is cleaned (quotes, `Title:` preambles, trailing punctuation) and
   split into `main title · subtitle`.
5. Two entries are appended to the *finished* session file: a `session_info` entry the picker reads,
   and a marker entry recording that this name came from this extension — that marker is what lets
   step 2 of the next run tell "ours" from "yours".

Sessions too short to name are never sent to a model at all: fewer than 2 user turns *and* an
opening message under 200 characters is skipped locally, for free.

### Why the middle of the conversation is sampled

Keeping only the head and the tail would reproduce the exact bug this extension exists to fix: the
head is the warm-up, the tail is the wrap-up, and the work that took hours sits in between. So the
first 2 blocks, an even sample across the middle, and the last 8 are what the model sees.

## Model selection

Tried in order, first success wins:

1. `PI_RENAME_MODEL` environment variable, `provider/model`
2. `model` in the config file
3. `models[]` in the config file (fallbacks, in order)
4. the session's own model — the default, so it works with zero setup

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

Credentials, base URLs and per-provider request quirks come from pi's own model registry — this
extension never reads `models.json` or `auth.json`. A name is one short line, so **a small fast model
is the right choice**; a reasoning model is slower here and may spend its budget thinking about a
seven-word answer. The example above pins a cheap model for exactly that reason.

## Privacy

Naming sends a **bounded excerpt**, never the transcript: each message is cut at 400 characters and
only ~20 blocks are included, chosen from the whole session. It goes through pi's model registry,
so nothing reaches a party you were not already sending your work to.

**Names run against the session file, not the live session.** The extension only ever appends two
entries to a file that is already closed. Your running session, its context, and the conversation
are never modified. If naming fails — no model, a 120s timeout, an empty answer — the previous name
simply stays; you get a footer warning and nothing else changes.

## Limits

- **Names you wrote are never touched** — `/name`, `pi --name`, or the session picker.
- **Short sessions are skipped** — fewer than 2 user turns and an opening message under 200 characters.
- **Failures are silent and harmless** — the old name stays, the session is unaffected.
- **`PI_RENAME_AUTO=0`** disables automatic naming. `/autoname` still works.
- **Only finished session files are written** — never the live session.

## Layout

```
src/
├── index.ts     extension entry: session_start (background naming), /autoname command
├── name.ts      cleaning and truncation of a name (main title / subtitle, width, quotes, preambles)
├── session.ts   reading session material, building the prompt, writing the name into a finished session file
└── model.ts     resolving candidate models and issuing the request through pi's model registry
```

## Related

- [pi](https://pi.dev) — the agent this extends
- [`pi-simplify`](https://npmjs.com/package/pi-simplify) — review recently changed code

## License

MIT
