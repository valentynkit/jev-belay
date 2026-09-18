# Session prompt: the clip, the watch pane, and the X post

Run after `sessions/01-review.md`, from inside `jev-belay/`.

## Context to load first

`../CLAUDE.md`, `CLAUDE.md`, `CONTEXT.md` sections 1, 7, 8, `../SHARED.md` "The recipe"
and "Launch", `../research/00a-virality-recipe.md`, `../research/04` section 2 (asciinema
plus agg, gifsicle, size limits, X specs), `demo/README.md`, and the `watch` and
`--replay` code in `belay.mjs`.

## What the clip must do

Muted, phone width, four seconds to earn the rest. Left pane: Claude Code ends a turn with
"Done, tests pass". Right pane: `belay.mjs watch` renders the evidence line (2 file changes,
no check ran), four probability bars fill, the verdict flips to BLOCKED in red with the
reason, then the next turn shows the test run, the bars, and ALLOWED in green. The
internals are the hook: the viewer sees what the model claimed, what the transcript shows,
and the numbers Jev returned, all in one frame.

## The job

1. **Design the watch pane for the camera.** It already works in 80 columns; storyboard a
   120-column version for a 16:9 recording and a 60-column version for a square X crop.
   Decide type size, the bar glyphs, the color for each of the four questions, how the
   verdict line pulses, and how latency and cost sit in the footer. Three ASCII mockups,
   pick one, say why. Match the Kanagawa Wave palette (read `~/.dotfiles/_docs/theming.md`
   first; the theme id, not hardcoded hex, where the terminal supplies it, and a fixed
   16-color fallback for agg).
2. **Tune `watch` and `--replay`.** Pacing flag for the replay (default 400 ms, `--pace`),
   a `--wide` layout, a one-line "waiting for the next stop" idle state, `NO_COLOR`
   respected. Keep it inside `belay.mjs` or one file. Tests for the layout math.
3. **The real session.** Record with asciinema in a scratch repo with a deliberate
   failing test: prompt Claude Code to fix a bug, let it claim done without running the
   suite, watch belay block, watch it run the suite and finish. The claim is that this
   fires on real behaviour, so no scripted tape. `JEV_BELAY_LOG=1` on, the shim or a real
   key behind `JEV_BASE_URL`. Zellij split, both panes in one cast.
4. **Render.** `agg --theme <kanagawa fallback> --font-size 16 --idle-time-limit 2 --fps 15`,
   then `gifsicle -O3` under 3 MB for the README; the same cast to MP4 for X via ffmpeg.
   Exact commands into `demo/README.md`. Also a replay-only recipe from
   `demo/sample-decisions.jsonl` for anyone without a key.
5. **The post.** First line from CONTEXT.md section 8 (limpet's 0.50, credit and link),
   then the measured ablation line verbatim, the clip, the marketplace install line. Draft
   an X thread of three posts and the Show HN title from section 8, plus the r/ClaudeAI
   version. Human voice, no hype, no emoji, no em dashes.
6. **Awesome list line** for `~/Projects/mine/awesome-jev-typesafe`, in that repo's format.

Every visual change ships with its check. Commit locally; the user pushes and posts.
