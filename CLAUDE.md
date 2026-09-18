# jev-belay

Claude Code Stop hook: blocks an unverified "done", fails open on everything else. Read
the "Lab rules" section below for the monorepo rules, then `CONTEXT.md` here in full.

Status 2026-09-18: built, reviewed, `npm test` green offline. **The kill criterion is still
undecided and the sample cannot settle it**: the gateway shim rate-limited the answer
recording at request one, so `corpus/answers/` is empty and the README carries `__`. Rerun
`JEV_BASE_URL=... npm run measure -- --ablation` when there is quota; it resumes from disk.
0.60 AUROC and +0.08 over `claims_done` alone is still the criterion, but at n=100 the
interval on an AUROC is about +-0.17, so the number will point rather than decide. Read
"Review state" below before trusting any figure written before it.

Project-specific rules:
- `corpus/` is built from the user's own `~/.claude/projects/*/` transcripts, gitignored,
  redacted to the projected fields only. Never commit it, never echo transcript text.
- Any hook error exits 0. Every test asserting a block has a sibling asserting fail-open.
- Zero dependencies, Node 20+, single `belay.mjs` plus `tools/` and `test/`.
- The gateway shim is not this project; its spec sits at the end of CONTEXT.md and it
  lives at `~/Projects/mine/jev-lab/tools/jev-proxy/`.

## Build state (2026-09-18, first build session, then the review)

`npm test` 58 pass, 5 skipped (the model-side jaggedness tests that need `JEV_LIVE_URL`).
Plugin installs and blocks for real under a throwaway `HOME`.

Measured on the real corpus (2,491 stops from this machine, gitignored, re-extracted after
the belt fix):
- base rate: 413 stops reach the gate, 16.6% of all stops, 83.9% of stops with changes.
  The "100% of stops with changes" in the first build was the phantom pass: no turn could
  have a fresh passing check because a failing suite was being counted as one.
- audit slice: re-drawn after the re-extraction and relabeled in full, 100 of 100 by
  `claude -p --model sonnet` (`source: claude-sonnet-proxy`), 12 `false_done`. No human
  label exists.
- `DONE_HINT` recall over `false_done` is 41.7% on the new slice, 33% on the old one. The
  pre-screen stays out of the gate; two independent slices now say the same thing.
- ablation and sweep: **recorded 0 of 100** real answers (gateway free tier rate limit).
  The fake-backed run (`JEV_BASE_URL` at `tools/fake-jev.mjs --synthetic`, `--cache
  corpus/answers-fake`) shows the plumbing works end to end: 0.52, 0.64, 0.63 across the
  three arms, and 0.52 against 0.50 on the gated-only comparison. The fake is a keyword
  model, so none of that is the hypothesis, and every interval is about +-0.18 wide. It is
  worth reading the two populations side by side even so: the full-population arm looks
  like a lift while the like-for-like one shows nothing, which is the shape the review
  warned the published number could take.
- live jaggedness before quota ran out: padding stability and prompt injection passed;
  negation, non-English, doc-only unrun.

CONTEXT.md changes made by the build (in the file, section "Build notes"): `DONE_HINT`
removed from the gate; `verification_applies` joined the `false_done` label with a
four-clause rubric; `final_message` truncation keeps the tail; `.claude-plugin/plugin.json`
must not carry a `hooks` key (Claude Code 2.1.263 loads `hooks/hooks.json` itself and
fails on the duplicate).

Two `ponytail:` markers: the fake's `--synthetic` keyword model (`tools/fake-jev.mjs:16`)
and `label.mjs` not retrying a failed proxy call (`tools/label.mjs:117`).

Blocked on: Vercel AI Gateway paid credits (see the "Lab rules" section below, "Real Jev access"). Then
`JEV_BASE_URL=http://127.0.0.1:4322 npm run measure -- --ablation`, resumable, decides the
kill criterion, and `--sweep` picks the threshold.

## Review state (2026-09-18, `sessions/01-review.md`)

Five reviewers over the built code, each against real transcripts, the installed 2.1.263
binary, or a running process. Everything confirmed is fixed and has a test; CONTEXT.md
section "Review round 4" lists what it changed in the design.

The one that mattered: **belt 1 answered before belt 2 read the output**, so a failing test
runner counted as verification and the gate skipped exactly the turns this tool exists for.
Claude Code records a runner's nonzero exit with no error flag and no exit code. Every
number measured before this fix came from a corpus that scored some failing suites as
passes.

Consequences already applied: the corpus was **re-extracted** (2,491 stops, base rate 16.6%,
was 2,367 and 18.2%), record ids are now content hashes rather than positions because the
turn renumbering would have silently reattached 47 of 100 labels to different stops, and the
audit slice was re-drawn and re-labeled by the sonnet proxy.

Also fixed: slash commands split turns; the hook was a silent no-op behind a symlink;
`watch` dropped every decision after the first non-ASCII one; redaction missed JSON-quoted
keys; the `outcome` veto fired on a 0.26 coin toss; a truncated session file reset the block
caps; `readStdin` could stall the turn for the host's full 25 s.

Two things are known and **not** fixed, both disclosed in the README's Known limits:
subagent work lives in a sibling transcript the hook never opens, and three of the four
decision thresholds have no sweep behind them.

Settled by reading the 2.1.263 binary: `prompt_id` is present on the Stop payload, and the
host force-ends a turn after 8 consecutive blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).

Cleared, do not re-litigate: the AUROC implementation is correct rank-based Mann-Whitney
with tie credit; the labeler does not ask the model to judge the two fact clauses; the
corpus projection carries only the eight projected keys; nothing under `corpus/` is tracked.

## Next session

`sessions/02-demo.md` (the asciinema clip with the watch pane, the X thread).

## Lab rules (from the jev-lab monorepo this repo was split from)

This project was designed and first built inside `valentynkit/jev-lab` (research reports,
the shared contract, the gateway shim). `docs/SHARED.md` and `docs/research/` are copies
taken at the split on 2026-09-18; the lab repo is canonical for them.

## Hard rules (also in docs/SHARED.md)

- No network and no key by default. Tests run against the project's fake Jev. Real calls
  only through `JEV_BASE_URL` set to the gateway shim or the direct API.
- Jev only makes a system stricter, never looser. Every error path fails open or falls
  back to the tool's no-Jev behavior.
- Every task ends with its runnable check from CONTEXT.md passing; paste the output before
  calling it done.
- Local commits only, one project per commit where possible, human voice, no
  Co-Authored-By, no em dashes. The user pushes and creates GitHub repos.
- Fewest files that work. Mark deliberate shortcuts with `ponytail:` naming the ceiling.
- The user's own transcripts (jev-belay corpus) never leave `corpus/`, which is gitignored.

## Prior-art clones

`/tmp/prior-art/<owner>_<repo>/` held shallow clones during design. If gone, re-clone the
ones CONTEXT.md cites: `git clone -q --depth 1 https://github.com/<owner>/<repo> /tmp/prior-art/<owner>_<repo>`.

## Real Jev access (2026-09-18)

No TypeSafe key yet. Real answers come through Vercel AI Gateway: the key sits in
`~/.config/jev-lab/env` (`AI_GATEWAY_API_KEY`, $5 budget cap), and `tools/jev-proxy` in the jev-lab repo (`~/Projects/mine/jev-lab/tools/jev-proxy`) turns
the direct wire format into gateway evaluate calls on `127.0.0.1:4322`. Start it, then set
`JEV_BASE_URL=http://127.0.0.1:4322` for record and measure steps only. Never loop against
it; unit tests stay on the fakes. Numbers measured this way carry the "via gateway shim"
footnote until re-measured on the direct API against a pinned `jev-1.13.0`.
