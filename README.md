# pi-auto-name

**You want to go back to something. You cannot find it.**

That is the whole problem. Two weeks ago you spent a long session doing something real — and now
you want it again. You open the session picker and start scrolling. Every row shows the first
thing you typed:

```
resume the thing I was doing
the build is broken again
pull it down for me
look at this
wait, one more thing
```

None of these is what the session was. You scroll, you guess, you open three sessions and close
them again — and eventually you give up and redo the work.

This extension gives every session a name that says what it was, so that when you come back
two weeks later you find it in one look:

```
CI workflow split · debug non-git repo
voice waveform recording · interruption handling
```

```bash
pi install npm:@light-cat/pi-auto-name
```

No configuration. And you never manage these names: no naming, no renaming, no remembering to name
anything. You just use pi, and next time the list is findable.

## Why the name is written at the end

Naming a session is not the goal. **Finding the session again is the goal** — and for that, the name
has to match what the session turned out to be, not how it started.

That is a question about *timing*, and it has one answer:

**Name it at the start, and you have named the wrong thing.** At the first exchange there is nothing
else on disk. The only material is the opening line — which the picker is already showing you. You
have spent a model call to rename "pull it down for me" to "pulling it down". The hours that made
the session worth finding again have not happened yet.

**Name it continuously, and the name never settles.** A name that changes every few minutes is not
something you can recognize when you come back — it is something you have to re-read every time. And
because those renames keep writing to the session file, the list is never quite still.

**Name it at the end, and you finally have something to name.** By then the entire session is on
disk: what you opened with, the part that actually ate the hours, and how it finished. The model
reads all of it once and writes one name — the kind you can still recognize weeks later, because it
describes what the session *was*, not what it *seemed to be about* on the first line.

So that is the only time this extension writes: **the session ended, and you moved on to the next
one.** Nothing else triggers it. No timers, no loop, no renaming as you work.

And your own names always win. If you ever `/name` a session by hand, this extension notices and
leaves it alone from then on.

## What you get

| When | What happens | Why you care |
| --- | --- | --- |
| You run `/new`, `/resume`, or `/fork` | The session you just left gets named | The session you are about to hunt for is named before you need it |
| You start pi | Sessions from this directory that ended in the last 24h without a name get caught up — at most 3, most recent first | Covers the times pi was killed instead of exited, so nothing slips through |
| You run `/autoname` | The current session is named right now, from its conversation so far | When you want to name something before leaving, or the name is not what you would have picked |

## What a name looks like, and why

The test for a name is not "is it accurate". It is **"can I find this again in three weeks"** — and
that decides the shape:

```
main title · subtitle
```

Both halves live in pi's single `name` field, because the picker shows one line per session. Two
separate fields would not display anywhere.

**The main title (≤14 characters) is what the session mostly did.** Not what it opened with. If the
session switched tasks, it is the one that ate the time — the opening warm-up and the closing
wrap-up are explicitly excluded. And it has to be concrete: the model is told that "code
discussion", "new session" and "chatting" are not names, and that it may never quote you.

**The subtitle (≤20 characters) is optional, and stays absent when there is nothing to say.** It
appears only when the session genuinely contained a second substantial task — in Chinese it is
prefixed with 「另」. It is never padded with the main task's outcome or a restatement. Most sessions
should have a title and nothing else.

The reason for the two levels is how you scan: you read the main title, and the subtitle is what
gets cut when the column is narrow. So the part that has to survive goes first, always.

**Names are written in the language the session used**, and Chinese/Japanese titles are measured in
display cells rather than characters — a CJK title cuts at 14 characters, a Latin one at 28, so both
occupy about the same width in the picker and neither looks broken next to the other.

## `/autoname` and pi's own `/name`

They do different jobs and do not compete:

- **`/name My title`** — pi's built-in. *You* write the title. Use it when you already know what to
  call the session.
- **`/autoname`** — this extension. The *model* reads the conversation and writes the title. Use it
  when the name is not what you would have picked, or you want it before the session ends.

**A name you wrote is never overwritten.** Anything set through `/name`, `pi --name`, or the session
picker is recognized as yours, and this extension backs off permanently — the one name in your list
you really care about is safe.

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
