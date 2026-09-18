# Session prompt: brutal review, refinement, and the README

Run from inside `jev-belay/` in a fresh Claude Code session.

## Context to load first

1. `../CLAUDE.md` (monorepo rules, real Jev access), then `CLAUDE.md` here ("Build state").
2. `CONTEXT.md` in full, including "Build notes" at the end; `REVIEW-3.md` for the verdict;
   `../SHARED.md` for the contract.
3. `../research/04-quality-bar-and-launch.md` sections 1 and 3 (README skeleton, measure
   line), `../research/01-api-and-testing.md` section 6 (failure modes).
4. Prior art at `/tmp/prior-art/` (re-clone per `../CLAUDE.md` if gone): DevMortimer_pi-warden
   (`src/done.ts`, the belts and questions), noplan-inc_limpet (the 0.50 AUROC claim at
   `README.md:185-190`), leepokai_jev-guard (`src/jev.js:29-67`, the client).
5. `corpus/RUBRIC.md`. The real corpus under `corpus/` is private: read counts and
   projected fields, never echo transcript text into a commit, a doc, or a subagent prompt.

## State on entry

One build session, no review. 45 tests pass. Plugin installs. The hypothesis is undecided:
0 of 100 real answers recorded because the gateway free tier rate-limited. The 100 audit
labels came from a sonnet proxy, not a human. README numbers are `__`.

## The job

Parallel subagents, at most 5 in flight, drafting on opus, reviewers on sonnet, never
`model: inherit`. Subagents that read `corpus/` get the privacy rule in their prompt.

1. **Brutal review.** One reviewer each for: `readEvidence` and both belts (test against
   ten real transcript files from `~/.claude/projects/` by shape only: subagent lines,
   compaction, `toolUseResult` variants, interrupted commands, runners outside the fixture
   set); redaction (`redact.test.mjs` versus real secret shapes, home paths, tokens in
   URLs); the stop-loop guard and session file under two hooks firing at once; `decide()`
   and the dead band; the client's deadline and retry math; `watch`/`--replay` rendering in
   80 and 120 columns and with `NO_COLOR`; the plugin manifests against the current Claude
   Code plugin docs. Each finding: file:line, failure scenario, severity, fix, verified.
2. **Fix what is real**, test first, fail-open sibling for every block test, zero deps.
3. **Decide the hypothesis when credits exist.** `JEV_BASE_URL=http://127.0.0.1:4322 npm run
   measure -- --ablation` (resumable, one in flight). Then `--sweep`. Apply the kill
   criterion from CONTEXT.md section 6 task 5 exactly: under 0.60 AUROC or under +0.08 over
   `claims_done` alone means shadow mode by default and the writeup, not a blocker. Put
   the three AUROCs and the false-block rate in the README and in `measure.json`. Add a
   20-stop human-versus-proxy agreement check if the user will label 20 (ask once).
4. **The README, state of the art.** `research/04` section 1 order: the measured line (or
   `__` plus the command that fills it) first, the marketplace install command, the
   asciinema GIF above the fold, Why built on limpet's 0.50 with credit and the link, Cost,
   How it works from the section 3 ladder, Known limits (read-only turns never reach the
   question; bespoke runners; caps; private corpus), Development, License. Human voice,
   no em dashes, no hype words, no emoji.
5. **Hygiene.** MIT `LICENSE` (exists), `CONTRIBUTING.md` (tests, fake-first, how the
   corpus extractor works and why it never leaves the machine), `CHANGELOG.md` in Keep a
   Changelog form, `.env.example` table, a GitHub Actions workflow running `npm test`
   offline on Node 20 and 22. Verify `npx` install and the raw `settings.json` hook line
   both work from a clean clone.
6. **Close.** Runnable check and pasted output per task; `CLAUDE.md` "Build state" and
   CONTEXT.md updated in the same commit as any decision change; local commits only.

## Non-negotiables

The corpus and its labels never leave `corpus/`. Every error path exits 0. The transcript is
never sent to Jev. Numbers come from `measure` or stay `__`.
