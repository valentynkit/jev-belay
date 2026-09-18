# The clip

`demo.gif` and `demo.mp4` are one real Claude Code session in a scratch repo, recorded from
the watch pane. Nothing is typed for the camera: `take.sh` sends two prompts, neither of
which mentions tests or belay, and records whatever the model does with them.

The session in the current take: the model renames a function across four files, says
"Done", runs nothing, and belay blocks. It then runs the suite, finds a bug the rename
exposed, fixes it, and the next prompt ends with a passing check, which the gate lets
through for free.

**The take on disk was recorded against `tools/fake-jev.mjs`, whose probabilities are
fixtures.** The footer says `fake-jev-fixtures` for that reason. Re-record against a real
key before publishing anything; the session is real either way, only the four numbers are not.

## Record

```sh
# real answers, through the gateway shim
(cd ~/Projects/mine/jev-lab/tools/jev-proxy && AI_GATEWAY_API_KEY=... npm start)
JEV_BASE_URL=http://127.0.0.1:4322 demo/take.sh demo/take.cast 60 18

# plumbing only, no key
node tools/fake-jev.mjs --port 4321 &
JEV_BASE_URL=http://127.0.0.1:4321 demo/take.sh demo/take.cast 60 18
```

`60 18` is the square crop. `demo/take.sh demo/take-wide.cast 120 30` gives the 16:9 one;
the pane spends the extra columns on the task and the block reason, not on longer bars.

The script writes a scratch repo to `/tmp/belay-take`, installs the hook through that
repo's own `.claude/settings.json` (your real config is untouched), clears
`~/.claude/belay/decisions.jsonl`, and drives `claude -p --model haiku`. Set
`JEV_DEMO_MODEL=sonnet` for a slower, more careful take.

No key and no session at all, for a repeatable render of canned decisions:

```sh
node belay.mjs --replay demo/sample-decisions.jsonl --pace 700
```

## Render

```sh
KANAGAWA="1f1f28,dcd7ba,16161d,c34043,76946a,c0a36e,7e9cd8,957fb8,6a9589,c8c093,\
727169,e82424,98bb6c,e6c384,7fb4ca,938aa9,7aa89f,dcd7ba"

agg --theme "$KANAGAWA" --font-family "JetBrainsMono Nerd Font Mono" \
    --font-size 28 --line-height 1.3 --idle-time-limit 1 --fps-cap 20 \
    demo/take.cast /tmp/demo-raw.gif

gifsicle -O3 --lossy=40 /tmp/demo-raw.gif -o demo/demo.gif      # README, keep under 3 MB

ffmpeg -y -i /tmp/demo-raw.gif -vf \
  "scale=1080:-2:flags=lanczos,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=0x1f1f28,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart -r 30 demo/demo.mp4   # X
```

The theme string is Kanagawa Wave's sixteen ANSI values, in order, from
`~/.dotfiles/themes/kanagawa-wave/colors.toml`. It lives here and not in `belay.mjs`, which
only ever emits ANSI indices and lets the terminal supply the palette; agg has no terminal
to ask. `--idle-time-limit 1` is what collapses the minute the model spends working into a
beat, and it is why a 3 minute session renders as 6 seconds.

## Why the pane looks like this

Three layouts were drawn at 60 columns, which is the width a phone can still read.

**A, the ledger.** What shipped.

```
task  Rename parseRows to parseCsvRows everywhere it appea…
said  Done. Renamed `parseRows` to `parseCsvRows` in both …
ran   nothing, after 4 file changes

reports it is done     █████████████████████████░ 0.94
claims checks passed   ███████████████████████░░░ 0.88
checks would apply     ████████████████████████░░ 0.91
outcome: complete      ███████████████████████░░░ 0.87

 BLOCKED
jev-belay: reports completion (0.94) after 4 file changes…
36 ms   $0.000017   jev-1.13.0
```

**B, the courtroom.** Claim and transcript in two columns, verdict underneath.

```
CLAIM                     │ TRANSCRIPT
"Done. Renamed…"          │ 4 files changed
reported complete         │ no check ran
──────────────────────────┴──────────────────────────
reports it is done     ███████████████████████░ 0.94
```

**C, verdict first.** The banner on top, evidence under it, bars last.

```
 BLOCKED  said done, nothing ran
task  Rename parseRows to parseCsvRows everywhere it appea…
```

A won. B splits 60 columns into two 28-column gutters, and a phone gets two truncated
fragments instead of one readable sentence; the vertical rule also costs the eye a jump on
every line. C reads well as a still and kills the clip: the verdict is the payoff, and
putting it first means the four bars fill after the answer is already known, which is
exactly the thing a viewer stops watching.

A earns its four seconds from the two adjacent lines at the top. `said "Done."` against
`ran nothing` is the whole argument, legible before a single bar has moved, and everything
below it is the evidence for a claim the viewer has already made in their head.

Decisions inside A:

- **Sentences, not question ids.** The log and the README keep `claims_done`; the pane says
  "reports it is done". Nobody parses `verification_applies` in the second a bar takes to fill.
- **Bars capped at 46 columns.** Past that a bar stops reading as a quantity and starts
  reading as a wall, so a wide pane spends its extra width on the task and the reason.
- **One colour rule.** Red is "pushes toward a block", green is "pushes toward allowed",
  dim is the 0.30 to 0.70 dead band. `claims checks passed` is the one that flips sides
  depending on whether a check actually ran.
- **The verdict is a filled bar, not a word.** At phone size a bold word is a smudge; a
  full-width red band is the frame you can read with the sound off and the screen small.
- **Latency and cost sit under the verdict, dim.** They are the argument for leaving it
  installed, not the argument for watching, so they go last.
