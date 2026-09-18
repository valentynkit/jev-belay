# jev-lab: shared context for the five Jev projects

Written 2026-09-18 from the eight research reports in `research/`. Every project's
`CONTEXT.md` builds on this file; read it first, then the project doc, then the research
files it cites. Nothing here restates a research file in full; it says what we decided.

## What we are doing and why

TypeSafe's Jev (launched 2026-09-15) is a decision model: state plus typed questions in,
calibrated probabilities out, about 100 ms, $0.042 per million input tokens, output free.
It cannot write text, count, do arithmetic, compare dates, or produce a value that is not
in the option set. About 400 projects appeared in three days. We ship five small open
source tools on it, aimed at being genuinely useful to strangers and at spreading. The
awesome list (`~/Projects/mine/awesome-jev-typesafe`) is live and is the distribution hub
for all five.

The five, chosen from `research/00a` to `00d` (virality recipe, channels, feasibility,
gap hunt):

| Repo | One line | Niche | Headline number to measure | Visual |
|---|---|---|---|---|
| `jev-plays-pokemon` | Pokemon Red on PyBoy, Jev picks at branches, code owns the goal stack and pathfinding | thin (two 0-1 star repos, one is battles only) | decisions/sec and $/hour, plus a running Brier score | live probability bars over the emulator |
| `jev.nvim` | grep where the pattern is a question; one noul per function into quickfix | empty | functions judged per call, $ per query, p50 latency | screencast of `:Jev ...` filling quickfix |
| `jev-skip` | YouTube sponsor/intro/recap skipper with a probability heatmap on the seek bar | empty | agreement with SponsorBlock crowd labels on n videos, and time-to-first-coverage on unlabeled videos | heatmap painting the seek bar, skip firing |
| `jev-belay` | Stop hook that blocks unverified "done", loop detection, escalate-only permission gate | thin (limpet 1 star; pi-warden's depth exists for Pi only) | false-block rate over n real sessions, caught false dones | the "Done, blocked, tests fail, fixed, Done" clip |
| `jev-commit` | pre-commit judge: message matches diff, debug leftovers, scope creep, secret-shaped strings | empty | ms and $ per commit, config-shaped secret recall vs the 15/20 incumbent | terminal clip with per-check probabilities |

Cut and why: Obsidian (four AI taggers in the store, none broke out), alert-gate (needs
case studies, not a launch), Raycast (tiny channel, mechanic does not clip), RSS filter
(crowded), DuckDB (C++ extension before first demo), anything router/reviewer/MCP/replica
(saturated, first mover holds a 10x gap).

## The recipe every repo follows (research/00a, 04)

- A measured number in the first line of the README and of the launch post. One command
  in the repo prints it: `npm run measure` / `make measure` / `uv run measure`, output
  `<number> <unit> (n=<sample>, <method>)` plus a JSON next to it.
- A GIF or MP4 above the fold. Terminal: vhs or asciinema+agg. Screen: QuickTime then the
  ffmpeg two-pass palette command in `research/04` section 2. Under 5 MB on GitHub; MP4
  for X.
- Honest limits as a flat "Known limits" section, and one limit folded into "Why".
- README skeleton and section order: `research/04` section 1.
- Never enter second with an incumbent's pitch. Each project's differentiator is written
  in its CONTEXT.md and must survive review.
- Human voice everywhere (README, commits, posts): no em dashes, no "comprehensive,
  robust, seamlessly, leverage, blazingly", no emoji, no Co-Authored-By. The
  sindresorhus/awesome PR checklist says "not AI-generated"; write like a person.

## Design rules for using Jev (research/02, 01 section 6)

- Jev only makes a system stricter, never looser. A wrong answer may cost a prompt, a
  re-run, or a skipped segment, never data or an irreversible action.
- Pick from a deck, never name a card. Every question is closed-set with an escape hatch
  (`other`, or explicit true/false criteria on a noul).
- One judgment per question. Describe situations, not degrees. Criteria, not labels.
- State carries facts, questions carry the judgment. Put the goal in state as its own
  field next to the item judged. Send only what the question needs; unrelated state is a
  distractor and accuracy falls with it.
- Code owns arithmetic, counting, dates, thresholds, timing, and anything time-critical.
  Regex belts sit in front of Jev wherever a miss is costly (error lines in logs, secret
  patterns, sentence boundaries).
- Fan out: many questions in one request cost about one request. Batch under the budget
  (32k tokens for state plus the longest question, 64k total); split-and-retry on a "too
  big" response (every's trick, research/03 section 2).
- Pin `jev-1.13.0` when publishing thresholds; `jev-latest` moves.
- Thresholds are measured, never guessed. Start with a dead band (0.30-0.70 is
  "uncertain") and a conservative act threshold, then sweep against a labeled corpus.
- Do not assert `noul(X) + noul(not X) == 1`; no cross-question consistency guarantee.

## API facts (research/01)

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, body
  `{model, state, questions}`. Question shapes and the response shape are in
  `research/01` section 1, confirmed from SDK source. Noul answers have no `confidence`
  field; the probability is the confidence.
- Choice: up to 255 options. Score: 2 to 10 ordered levels.
- Errors: 400/401/403/404/422/429/5xx; `retry-after` on 429. Backoff only on 429/5xx.
- Vercel AI Gateway (`typesafe-ai/jev`, no waitlist) is **AI SDK only**: no raw HTTP
  path exists. Question type is `boolean` with a `probability` answer, not `noul`. Only
  Node code using the `ai` package can reach it.

## Access and testing (the answer to "how could we test it")

We have no TypeSafe key yet. Three layers, all five projects implement all three:

1. **Fake Jev.** A fixture file mapping question name to answer, served by a 15-line
   local HTTP server (Node and Python versions in `research/01` section 3). Every project
   points its base URL at it via env (`JEV_BASE_URL` or the SDK's `TYPESAFE_BASE_URL`).
   Unit tests run against this, offline, in CI. No key, no network, ever, by default.
2. **Record and replay.** Once a real key exists, a recording proxy keys each request by
   `sha256(state + questions)` and writes `fixtures/<hash>.json`. Run it once over the
   project's fixed corpus, commit the fixtures, tests replay them free and deterministic.
3. **Measurement.** The `measure` command runs the real question set against a labeled
   corpus and prints the headline number. Calibration: reuse `jevcal` (ECE, coverage vs
   accuracy, `--lock` to CI-guard a threshold) or the 20-line Brier/reliability/threshold
   sweep in `research/01` section 5. This script is both the test and the tweet.

Gateway shim, until the TypeSafe key lands: a 40-line Node script in `tools/jev-proxy/`
that listens on localhost, accepts the direct wire format, calls
`experimental_evaluate` on `typesafe-ai/jev` through the AI SDK, and maps
`noul` <-> `boolean/probability`. That gives the Lua, Python, and shell projects real
answers today. The jev-belay drafter owned its spec (same language, same repo skills).
Confirmed 2026-09-18 from the Vercel evaluation doc: the gateway supports `boolean`,
`choice`, and `score`, so the shim serves all five projects today. What it cannot give:
a real `confidence` on choice/score (the shim synthesizes `max(probabilities)`), a
pinned `jev-1.13.0`, and auth (bind 127.0.0.1 only). Re-measure every published
threshold on the direct API before pinning it.

Failure modes to test for, from the jaggedness page (`research/01` section 6): padded
state, adversarial instruction-like text in state, negation, counting, indirection,
contradictory criteria, non-English.

## Prior art to reuse (research/03)

Per project the file:line pointers are in `research/03`. The ones that cross projects:

- Token estimator and staged degradation ladder: fast-jev-compaction `src/state.ts`.
- HTTP client with one shared `AbortSignal.timeout` across retries, backoff only on
  429/5xx: jev-guard `src/jev.js:29-67`. Hooks get killed around 30 s; fail open before
  that.
- Split-on-too-big batching: every `judge.py:184-190`.
- Exit-code contract with an explicit uncertain state: semdecide `cli.py:17-21`.
- Git lockdown for any tool reading untrusted repo content: commit-miner `src/git.rs:35-77`
  (strip `GIT_*`, `core.hooksPath=/dev/null`, `protocol.allow=never`, no lazy fetch, no
  terminal prompt, no API key in the child env).
- Key isolation in a browser extension: unclutter keeps the key in the background script,
  content scripts only relay.

## Repo conventions

- Location: this monorepo, `jev-lab/<project>/`, code next to its CONTEXT.md. Local
  commits in a human voice, no pushing until the user reviews. Splitting a project into its
  own GitHub repo happens at launch, by the user.
- MIT license (the awesome list is CC0). `.env.example` with a required/optional table.
  `CHANGELOG.md` (Keep a Changelog), first tag `v0.1.0` once the README's one command
  works end to end.
- CI runs tests against the fake, never the network.
- Fewest files that work. No abstraction before a second concrete use. Mark deliberate
  shortcuts with a `ponytail:` comment naming the ceiling and the upgrade path.
- Each repo ships exactly one runnable check per non-trivial piece of logic.

## Launch (research/00b, 04)

Order: jev-belay and jev.nvim first (no store gate, hottest channels), jev-commit next
(pre-commit framework hook works from a repo URL; the hooks.html listing needs 500 stars,
later), jev-skip as a GitHub release plus Firefox self-distribution while Chrome review
runs, Pokemon when the stream is ready. Every launch: post to the TypeSafe Discord first,
then the project's channel (r/neovim via Dotfyle for This Week in Neovim; r/ClaudeAI and
the plugin marketplace; Show HN weekday 7-10am PT; Twitch "Twitch Plays" category), then
X from the account with the clip, then add the project to the awesome list.

## What each CONTEXT.md must contain

1. Pitch, hook line, the number, the visual, and the differentiator against the named
   incumbents.
2. Scope: v0.1 (what ships), non-goals, v0.2 candidates. Smallest thing that earns the
   star.
3. Architecture: components, data flow, where Jev sits, what code owns, the regex belts.
4. Question set and state shape (start from `research/02` section 5, refine), with the
   two or three jaggedness risks and mitigations.
5. Testing: fixture corpus, fake, record/replay, the `measure` command and its exact
   output line, the calibration method, the failure-mode tests.
6. Implementation plan: ordered tasks, file layout, each task ending in a runnable check.
   Sized for one focused session each.
7. README skeleton with the project's slots filled.
8. Launch: channel, first line of the post, assets to record and how.
9. Open questions for the user, three at most, only ones that change the build.
