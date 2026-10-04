# pi-auto-name

pi's session list shows the first message of each session. When you want to find the session you
ran two weeks ago, this is what you see:

```
resume the thing I was doing
the build is broken again
pull it down for me
look at this
```

None of these say what the session actually did, so you open them one by one until you find it.

This extension names each session when it ends, so the name says what the session did:

```
CI workflow split · debug non-git repo
voice waveform recording · interruption handling
```

```bash
pi install npm:@light-cat/pi-auto-name
```

Nothing to configure. You do not manage the names either: no naming, no renaming, no remembering to
name anything. You use pi, and the list stays findable.

## Why the name is written at the end

A name is for finding the session again later, so it has to say what the session turned out to be,
not how it started.

**Naming at the start only gets you the first message.** At that point there is nothing else in the
session. The only material is the opening line, which the list is already showing you. The work that
took the time has not happened yet.

**Renaming as you go means the name keeps changing.** Every change makes you read it again, which is
the same as having no name. It also keeps writing to the session file.

**Naming at the end means the whole session is there.** The opening, the part in the middle that
took the hours, and the ending. The model reads it once and writes a name you will still recognize
weeks later.

So the name is written at one point only: the session ended and you started the next one. A name you
set yourself with `/name` is never overwritten.

## When a name is written

| Action | What happens |
| --- | --- |
| `/new`, `/resume`, `/fork` | Names the session you just left. A resumed session is named again, because it grew. |
| Starting pi | Names recent sessions in this directory that ended in the last 24 hours without a name, at most 3. This covers the times pi was killed instead of exited. |
| `/autoname` | Names the current session now, from the conversation so far. |

## `/autoname` and pi's own `/name`

The two do not overlap:

- `/name My title` is pi's own. You write the title.
- `/autoname` is this extension. The model reads the conversation and writes the title. Use it when
  the name is not what you wanted, or when you do not want to wait until the session ends.

A name you set with `/name`, `pi --name`, or the session list is recognized as yours, and the
extension will not touch it again.

## What a name looks like

```
main title · subtitle
```

pi's list shows one line per session, so both parts go in the same `name` field.

The main title is at most 14 characters and says what the session mainly did, not how it opened. If
the session switched tasks, it is the one that took the most time. Opening pleasantries and closing
remarks do not count. It has to be specific: "code discussion" and "new session" are not names, and
it may not quote what you typed.

The subtitle is at most 20 characters and is optional. It is only written when the session really
had a second substantial task, and in Chinese it is prefixed with 「另」. It is not padded out with
the main task's result or a restatement. Most sessions have a main title only.

The reason for two levels is that you read the main title when scanning the list, and the subtitle
is what gets cut when the column is narrow, so the important part comes first.

Names are written in the language the session mainly used. Chinese and Japanese are measured by
display width, so a Chinese title is cut at 14 characters and an English one at 28, which is about
the same width in the list.

## How it works

1. A session ends (`/new`, `/resume`, `/fork`) or pi starts.
2. The handler returns immediately. pi waits for `session_start` before it lets you use the new
   session, so waiting here would freeze the command palette. The model call runs in the background.
3. The conversation is compressed into a small prompt: your messages, the last few replies, and the
   tools that were used. Each message is capped at 400 characters, and at most 20 blocks are taken:
   the first 2, an even sample from the middle, and the last 8.
4. The model returns one line. It is cleaned up (quotes, `Title:` prefixes, trailing punctuation)
   and split into the main title and subtitle.
5. Two records are appended to the finished session file: a `session_info` record, which is what the
   list reads, and a marker record noting that this extension wrote the name. That marker is how the
   next run tells its own names apart from yours.

Sessions that are too short are never sent to a model: fewer than 2 turns and a first message under
200 characters is skipped locally.

Only the opening and the ending would repeat the problem this extension is meant to solve: the
opening is the warm-up, the ending is the wrap-up, and the work is in the middle. That is why the
first 2 blocks, a sample from the middle, and the last 8 are used.

## Which model is used

Tried in order, first one that works:

1. The `PI_RENAME_MODEL` environment variable, in `provider/model` form
2. `model` in the config file
3. `models[]` in the config file, tried in order
4. The session's own model, which is the default and needs no configuration

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
| `model` | Preferred model, `provider/model` |
| `models` | Fallbacks, tried in order |
| `thinking` | `off` / `minimal` / `low` / `medium` / `high`, unset by default |

API keys, base URLs, and the request differences between providers all go through pi's own model
registry. This extension does not read `models.json` or `auth.json`. A name is one line, so a small
fast model is the right choice; a reasoning model is slower here and may spend its budget thinking.

## Privacy

What is sent to the model is a short excerpt, not the whole session: each message is capped at 400
characters and at most 20 blocks are used. It goes through pi's model registry, so no third party is
added beyond what you already use.

The name is written to a session file that has already ended, not to the current session. The
extension only appends two records to a closed file; it does not change the session you are using or
its contents. If naming fails (no model available, a 120 second timeout, an empty reply) the
previous name stays, a note appears in the footer, and nothing else changes.

## Limits

- Names you set yourself are not changed.
- Sessions that are too short are skipped: fewer than 2 turns and a first message under 200 characters.
- Failures do not raise errors. The previous name stays and the session is not affected.
- `PI_RENAME_AUTO=0` turns off automatic naming. `/autoname` still works.
- Only finished session files are written.

## Layout

```
src/
├── index.ts     extension entry: session_start (background naming), /autoname command
├── name.ts      cleaning and truncating a name (main title / subtitle, width, quotes, prefixes)
├── session.ts   reading the session, building the prompt, writing the name into the finished file
└── model.ts     choosing a model and sending the request through pi's model registry
```

## Related

- [pi](https://pi.dev) — the agent this extends
- [`pi-simplify`](https://npmjs.com/package/pi-simplify) — review recently changed code

## License

MIT
