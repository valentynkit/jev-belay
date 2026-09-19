# The clip

`demo.mp4` (1920x1080, about 50 s) and `demo.gif` (the same cut, half size) are one real
Claude Code session in a scratch repo: Claude Code on the left, `belay.mjs watch` on the
right, a caption band underneath that says what is happening. Nothing is typed for the
camera by a person: `take-vhs.sh` sends two prompts, neither of which mentions tests or
belay, and records whatever the model does with them.

The session in the current take: the model renames a function across both files, says
"Done", runs nothing, and belay blocks. Claude then runs the suite itself, finds a CRLF
bug the rename exposed, fixes it. The next prompt ends on a passing check, which the gate
lets through for free.

**The take on disk was recorded against `tools/fake-jev.mjs`, whose probabilities are
fixtures.** The watch pane's footer says `fake-jev-fixtures` for that reason. Re-record
against a real key before publishing; the session is real either way, only the four
numbers are not.

## Record and render, one command

```sh
# real answers, through the gateway shim
(cd ~/Projects/mine/jev-lab/tools/jev-proxy && AI_GATEWAY_API_KEY=... npm start)
JEV_BASE_URL=http://127.0.0.1:4322 demo/take-vhs.sh

# plumbing only, no key
node tools/fake-jev.mjs --port 4321 &
JEV_BASE_URL=http://127.0.0.1:4321 demo/take-vhs.sh
```

About three minutes. Needs `vhs`, `ttyd`, `ffmpeg`, `gifsicle`, `zellij`, `claude`; vhs
pulls its own Chromium on first run. `JEV_DEMO_MODEL=sonnet` for a slower, more careful
model. Writes `demo/demo.mp4` and `demo/demo.gif`; the frames and the tape stay under
`/tmp/belay-vhs` for a re-cut without a re-record:

```sh
node demo/render.mjs /tmp/belay-vhs/frames demo/demo.mp4 '{"fps":15,"t1":4.25,"t2AfterBlock":77.2}'
```

Pieces, in order:

- `scratch.sh` builds `/tmp/belay-take/repo`: one passing test, one failing one, the hook
  installed through that repo's own `.claude/settings.json`, permissions for the handful
  of commands the task needs, trust pre-seeded so no dialog interrupts, the user's
  statusline blanked, a zellij config with startup tips off and the user's theme.
- `take-vhs.sh` writes a vhs tape and runs it. vhs owns a real pty through ttyd and
  renders it in headless Chromium, which is the one arrangement the Claude Code TUI and
  zellij both accept when there is no terminal to hand them. The tape hides the launch
  line, types the two prompts at 25 ms a key, and waits on the watch pane's BLOCKED and
  PASSED bands rather than on a stopwatch, so it follows the model's pace. A watcher
  answers any permission prompt the way a user would and logs that it did.
- `render.mjs` finds the two bands by colour in the frames, cuts the session into
  segments (1x around the events, 6x through the model's working stretches, badge in the
  corner), overlays a caption per segment, and adds a title and an end card. Captions and
  cards are HTML screenshotted by the same Chromium: this ffmpeg has no `drawtext`, and
  Chromium sets type better anyway.

## What went wrong, so it does not again

- **Claude Code's TUI writes nothing into a pty from `expect`**, `script` will not take a
  fifo for stdin on macOS, and zellij will not nest inside another zellij. Every direct
  route from a tool shell fails; vhs is the route.
- **A nested Claude Code inherits `CLAUDE_CODE_CHILD_SESSION`** and turns transcript
  saving off, which leaves the hook nothing to read. The launch line unsets it and sets
  `CLAUDE_CODE_FORCE_SESSION_PERSIST=1`.
- **The user's vim editor mode starts in NORMAL**, so the first keystrokes of a prompt are
  commands, not text. `Escape` then `i` before typing.
- **zellij's startup tip swallows the first prompt**; `show_startup_tips false` in a
  config dir of its own, themes symlinked from the user's.
- **A dead session with the same name makes zellij refuse to start**; kill and
  `delete-session --force` before every take.
- **`find -exec` cannot be auto-allowed by a prefix rule**, so the prompt names the two
  files and the model reads them instead of searching.
- **vhs's parser misreads a hyphen in an absolute `Output` path**; keep it relative.
- **Recording twice without rebuilding the scratch repo** gives a take where the model
  says "Already done", changes nothing, and belay correctly stays silent.

## Why the pane looks like this

Three layouts were drawn at 60 columns for the watch side, which is the width a phone can
still read.

**A, the ledger.** What shipped.

```
task  Rename parseRows to parseCsvRows in parse.mjs and par…
said  Done. Renamed `parseRows` to `parseCsvRows` in both …
ran   nothing, after 3 file changes

reports it is done     █████████████████████████░ 0.94
claims checks passed   ███████████████████████░░░ 0.88
checks would apply     ████████████████████████░░ 0.91
outcome: complete      ███████████████████████░░░ 0.87

 BLOCKED
jev-belay: reports completion (0.94) after 3 file changes…
27 ms   $0.000017   jev-1.13.0
```

**B, the courtroom.** Claim and transcript in two columns, verdict underneath.

```
CLAIM                     │ TRANSCRIPT
"Done. Renamed…"          │ 3 files changed
reported complete         │ no check ran
──────────────────────────┴──────────────────────────
reports it is done     ███████████████████████░ 0.94
```

**C, verdict first.** The banner on top, evidence under it, bars last.

```
 BLOCKED  said done, nothing ran
task  Rename parseRows to parseCsvRows in parse.mjs and par…
```

A won. B splits 60 columns into two 28-column gutters, and a phone gets two truncated
fragments instead of one readable sentence. C reads well as a still and kills the clip:
the verdict is the payoff, and putting it first means the bars fill after the answer is
known.

A earns its seconds from the two adjacent lines at the top. `said "Done."` against
`ran nothing` is the whole argument, legible before a single bar has moved.

Decisions inside A:

- **Sentences, not question ids.** The log and the README keep `claims_done`; the pane says
  "reports it is done".
- **Bars capped at 46 columns.** Past that a bar stops reading as a quantity and starts
  reading as a wall, so a wide pane spends its extra width on the task and the reason.
- **One colour rule.** Red pushes toward a block, green toward allowed, dim is the 0.30 to
  0.70 dead band. `claims checks passed` flips sides depending on whether a check ran.
- **The verdict is a filled band, not a word.** It is also what `render.mjs` keys on.
- **Latency and cost sit under the verdict, dim.** The argument for leaving it installed,
  not the argument for watching.

The first cut of this clip was the watch pane alone. It showed bars moving and nothing
else, and a viewer who did not already know what belay was learned nothing from it. The
Claude Code pane is the product; the watch pane is the receipt.
