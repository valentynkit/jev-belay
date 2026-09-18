# jev-belay

Claude Code Stop hook: blocks an unverified "done", fails open on everything else. Read
the "Lab rules" section below for the monorepo rules, then `CONTEXT.md` here in full.

Status 2026-09-18: tasks 1 to 8 built, `npm test` green offline, corpus extracted and the
100-stop audit slice labeled by the sonnet proxy. **The kill criterion is still undecided**:
the gateway shim rate-limited the answer recording at request one, so `corpus/answers/` is
empty and the README carries `__` where the numbers go. Rerun
`JEV_BASE_URL=... npm run measure -- --ablation` when there is quota; it resumes from disk.
0.60 AUROC and +0.08 over `claims_done` alone still decides blocker versus shadow mode.

Project-specific rules:
- `corpus/` is built from the user's own `~/.claude/projects/*/` transcripts, gitignored,
  redacted to the projected fields only. Never commit it, never echo transcript text.
- Any hook error exits 0. Every test asserting a block has a sibling asserting fail-open.
- Zero dependencies, Node 20+, single `belay.mjs` plus `tools/` and `test/`.
- The gateway shim is not this project; its spec sits at the end of CONTEXT.md and it
  lives at `~/Projects/mine/jev-lab/tools/jev-proxy/`.

## Build state (2026-09-18, first build session)

Tasks 1 to 8 coded, `npm test` 45 pass, 5 skipped (the model-side jaggedness tests that
need `JEV_LIVE_URL`). Plugin installs and blocks for real under a throwaway `HOME`. Nothing
has had a second-pair review; that is `sessions/01-review.md`.

Measured on the real corpus (2,367 stops from this machine, gitignored):
- base rate: 430 stops reach the gate, 18.2% of all stops, 100% of stops with changes.
- audit slice: 100 stops labeled by `claude -p --model sonnet` (`source:
  claude-sonnet-proxy`), 12 `false_done`. No human label exists.
- `DONE_HINT` recall over `false_done` was 33%, so the pre-screen is out of the gate.
- ablation and sweep: **recorded 0 of 100** real answers (gateway free tier rate limit).
  The fake-backed run (`--cache corpus/answers-fake`) shows the plumbing works: 0.50, 0.62,
  0.68 across the three arms. That number is not the hypothesis.
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

## Next sessions

`sessions/01-review.md` (brutal review, fixes, README, hygiene) then `sessions/02-demo.md`
(the asciinema clip with the watch pane, the X thread). Each in its own session.

Review targets: the transcript walk in `readEvidence` against real jsonl shapes (subagent
lines, compaction markers, `toolUseResult` variants); belt 2's runner-summary regexes on
runners not in the fixtures (vitest, bun test, mix test, dotnet test); redaction coverage;
the session-file guard under concurrent hook fires; `decide()` thresholds once real
answers exist; the proxy labeler's rubric drift versus a human on 20 stops.

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
