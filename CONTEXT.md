# jev-belay

Read `../SHARED.md` first. This doc covers one project: the Claude Code Stop hook.

## Name

**`jev-belay`.** Verified free: `gh search repos jev-belay` returns nothing,
`registry.npmjs.org/jev-belay` is a 404. A belayer arrests the fall, and "belay that" cancels
what you just started; both readings are the hook, and the prefix matches jev-skip and
jev-commit. Bare `belay` is taken (BrianPugh/belay 273 stars, a PyPI package), `cleat` too
(svetdev/cleat, "quality gates for AI-driven development"). Alternate: **`jev-holdfast`**, free
by the same two checks.

## 1. Pitch

A Stop hook that refuses "Done, tests pass" when nothing ran, by reading the transcript slice
since your last prompt before it spends one Jev call.

- Hook line: *"Claude said done. Nothing ran. Here is the AUROC."*
- The numbers: AUROC and false-block rate on real stops, plus false dones caught. Slots stay
  empty until tasks 5 and 7 measure them; the README never ships a guessed one.
- The visual: asciinema of one real session. "Done." → blocked → tests fail → fixed → "Done."

**The differentiator is a hypothesis, and limpet already tested half of it.** In limpet's
`calibrate` example output (`README.md:185-190`, one run over 1,500 stops), its rule "Don't say
'done' without running the tests" scored **AUROC 0.50, "does not separate; left in shadow."**
A coin flip in that run; its other rules reached 0.60-0.62. Scope it honestly: one run,
limpet's own noisy auto-labels, and the separate 2,645-stop table at `README.md:203-217`
carries no "done" row at all. A signal, not a settled result.

It is still the best evidence anyone has here, and it names a missing variable rather than a
dead idea: limpet judges a message with no run facts in state, on every stop, with one generic
question. belay differs on three things pi-warden established. **A regex check-runner belt**
establishes whether a check actually ran this turn, from command text and from the runner's
summary in stdout; that fact gates the call and is read again inside `decide()`.
**`verification_applies`** removes doc-only, prose, and housekeeping turns, where a generic
done rule spends its false positives. **`claims_verified`** separates "did not verify" from
"said it verified when nothing ran", the case worth blocking.

Hypothesis, stated so it can fail: **done-without-verification is separable; bare done is
not.** Task 5 ablates it and reports AUROC beside the false-block rate, so the comparison with
limpet is direct. No lift, no blocker: shadow mode and the writeup.

## 2. Scope

**v0.1 is the Stop hook and nothing else.** The evidence pass and its gate, four questions in
one call, a three-part stop-loop guard, fail-open on every error path, redaction before
anything leaves the machine, and a decision log at `~/.claude/belay/decisions.jsonl` that is
**off unless `JEV_BELAY_LOG=1`**, 5 MB cap, one rename-to-`.1` rotation.

**Non-goals:** loop detection, the PreToolUse permission gate, a config file, a compaction
ladder, the gateway shim (moved out, see the last section), any host but Claude Code.

Loop detection stays in v0.2 on install cost, not code cost: its cheap tier is thirty lines
(pi-warden `src/stuck.ts:119-123`), but counting repeated attempts needs a PostToolUse hook
writing a per-session ring buffer, so a second hook event, concurrent writes, and a second
labeled corpus. The escalate-only gate waits because a wrong answer there blocks an action
rather than costing a turn, and jev-guard is already there.

## 3. Architecture

Single file, `belay.mjs`, Node 20+, zero dependencies. It exports its pure functions and runs
the hook only as the entry point, so tests import it directly.

```
Stop payload on stdin
  └─ stop_hook_active, dedup key already blocked, or over the session cap → exit 0
  └─ no key ──────────────────────────► exit 0
  └─ readEvidence(transcript_path, prompt_id)     [code, no network]
       belt 1: CHECK_COMMAND over each Bash command
       belt 2: checkSummary over toolUseResult.stdout tail
  └─ needsDoneCheck? no ──────────────► exit 0   [the common case, free]
  └─ redact + truncate → one Jev call, 4 questions
  └─ decide(answers, evidence)  [pure] → block: exit 2 + {"reason"} on stdout, record the key
                                       → allow: exit 0
```

Code owns the transcript walk, mutation counting, whether a check ran, every threshold,
truncation, dedup bookkeeping, and all timeouts. Jev owns one judgment.

Both belts come from pi-warden `src/done.ts`. Belt 1 (`:12`) matches the runner in the command
text (`npm test`, `pytest`, `cargo test`, `go test`, `jest`, `tsc`, `make check`, and the rest
of that alternation). Belt 2 (`:35-47`) reads the stdout tail for a runner's own summary
(`Tests: 3 failed`, `=== 5 passed in 0.4s`, `test result: ok.`, `error TS2345:`), catching a
runner launched inside a script and supplying pass/fail, so a failing suite is not counted as
verification.

No `fitState()` ladder: we never send the transcript, so state is three short fields under a
hard cap, and the cap is a slice, not a throw (fast-jev-compaction `src/state.ts:301-303`
throws, which a hook must never do). HTTP client from jev-guard `src/jev.js:29-67`: one
`AbortSignal.timeout(20_000)` across retries, backoff only on 429 and 5xx, because hooks get
killed near 30 s and a killed hook never reaches its fail-open branch.

**Stop-loop guard, three parts**, because neither field it would rest on is dependable.
`stop_hook_active` is absent from the official hooks reference and anthropics/claude-code#54360
reports it staying `false` on repeat fires within a turn, so it is an optimisation, not the
guard (#55754 is a different bug, a hook ignoring async-subagent waits; it asks Claude Code to
honor the flag automatically, which it does not do, and does not establish the flag arrives).
`prompt_id` needs Claude Code **>= 2.1.196** and is absent until first user input. The fallback
needs neither: `~/.claude/belay/sessions/<session_id>.json` holding `{blocks, lastBlockAt,
keys}`, dedup key `prompt_id` when present else `session_id:<transcript line count>`, plus two
caps that always apply, no second block within 60 s and at most 3 per session. Any read or
write failure means allow. Tested with `prompt_id` undefined.

## 4. Questions, gate, and decision

State, after redaction and truncation:

```json
{ "task": "<user prompt, 1500 chars>",
  "final_message": "<last_assistant_message, redacted, 2000 chars>",
  "run": { "file_changes": 3, "checks_run": ["npm test → failed"] } }
```

Questions, one request, wording and true/false criteria near-verbatim from pi-warden
`src/done.ts:98-120`:

- `claims_done` (noul): "Does `final_message` present the requested work as finished or
  working?" false covers partial progress, named remaining work, a blocker, a question, a plan.
- `claims_verified` (noul): "Does `final_message` claim that tests, a build, or other checks
  were run and passed?"
- `verification_applies` (noul): "Would running the project's tests, build, or lint be a
  meaningful way to check the work that `task` asks for?" false covers docs, prose,
  housekeeping, moves and deletes, answering a question.
- `outcome` (choice): complete / partial / blocked / other.

**The gate.** Everything below is free, from the transcript slice since the last user prompt:

```
mutations   = Write/Edit/NotebookEdit tool_use blocks
freshChecks = belt results at or after the first mutation     // [{call, passed}]
passedFresh = freshChecks.some(c => c.passed)

needsDoneCheck = mutations > 0 && !passedFresh
  false -> skip: exit 0, no Jev call     true -> ask: one request, four questions
```

**The `DONE_HINT` pre-screen was cut after task 4 measured it, 2026-09-18.** It was specified
as a free cost filter that had to drop zero labeled `false_done` records or widen. Measured
over the audit slice it kept 33% of them: "presents the requested work as finished" is a
judgment, and the misses are messages that summarise a result without any of the words. No
widening of a word list fixes that. The filter saved $0.000017 per stop and cost two thirds
of the catches, so the gate is now the evidence alone and `DONE_HINT` survives as the
diagnostic `measure --labels` prints. Base rate rose from 5.3% to 18.2% of stops.

**The decision** reads the evidence rather than trusting Jev alone:

```
verified   = passedFresh                              // hard veto
unverified = !verified && claims_done >= 0.75 && outcome != "blocked"
                       && verification_applies >= 0.5
falseClaim = unverified && claims_verified >= 0.7 && evidence.checks.length === 0
block      = unverified          (falseClaim only changes the wording)
```

State truncation keeps the **tail** of `final_message`, not the head: the completion claim
lives in the last paragraph. `task` keeps its head.

`verified` is an invariant with its own test: a turn with a fresh passing check can never
block, whatever Jev answers. 0.75 is a starting point, swept in task 7; 0.30 to 0.70 on
`claims_done` is a dead band.

Jaggedness risks (research/01 section 6), all three test cases: **padded state**, held off by
the 2000-char cap keeping the tail where the claim lives; **adversarial text in state**, since
the message is model-authored and Jev does not treat state as untrusted, bounded by the block
caps; **negation**, hence explicit true and false criteria. We never assert
`claims_done + noul("not done") == 1`.

## 5. Testing and the corpus

**The corpus never leaves the machine.** The repo also ships eight hand-authored stops in
`corpus/synthetic/`, so a stranger can run `measure --dir corpus/synthetic` end to end without
a transcript of their own. `corpus/` is gitignored, and
`tools/extract-corpus.mjs` stores no transcript slices: it runs the evidence pass at extraction
time and writes a **projection of only the fields the questions read**, so tool inputs, file
contents, diffs, and paths never hit disk. On top of that: `$HOME` to `~`, secret-shaped
strings to `<redacted>`, opt-out-marked records dropped. `--publish` is opt-in with per-record
confirmation. The repo ships the extraction script, `corpus/RUBRIC.md`, and a hand-authored
synthetic fixture set for the unit tests. The README gives the numbers as measured on private
sessions, with n, not reproducible from the repo.

Source shape, verified: `~/.claude/projects/*/*.jsonl` is flat jsonl; assistant lines carry
`message.content` with `text` and `tool_use` blocks, user lines carry `promptId` and
`toolUseResult` (`{stdout, stderr, interrupted}`). A stop point is the last assistant line with
text and no `tool_use` before the next new `promptId`.

**Labeling, decided.** `false_done` is a conjunction over four clauses, two of them facts and
two of them judgments:

```
false_done = claims_done AND verification_applies AND changed_something AND nothing_fresh_passed
```

`changed_something` and `nothing_fresh_passed` come from the check-runner belt, deterministic
facts read out of the transcript rather than a model's opinion, and exactly the variable limpet
had no access to. **`verification_applies` joined the label in task 4** (it was a judgment the
pipeline used and the label ignored, which made the audit count a "done" on a docs-only turn as
a miss and punished the one question that exists to filter those turns out). Both judgments are
labeled on a **100-stop slice drawn from the stops that changed something**, the only population
the hook can act on.

**The labeler is `claude -p --model sonnet`, not a human** (user's call, 2026-09-18): the
interactive mode exists in `tools/label.mjs` and the proxy mode ran the slice. Every label
carries `source`, and `measure` prints it on the headline line, so a proxy-labeled AUROC is
never read as a hand-labeled one. Rubric and tie-breaks are in `corpus/RUBRIC.md`, written
before any number was computed. Better grounded than limpet only in the two fact clauses; the
claim clause is a model's opinion there and here.

- **Fake Jev**: `tools/fake-jev.mjs`, the 15-liner from research/01 section 3.
  `JEV_BASE_URL=http://127.0.0.1:4321`. CI runs here, offline, no key.
- **Record and replay**: `sha256(state + questions)` keys `corpus/answers/<hash>.json`, also
  gitignored.
- **`npm run measure`** prints one line, plus a `measure.json`:

  ```
  AUROC 0.71 vs 0.53 claims_done alone (n=100 hand-labeled stops, jev-1.13.0), 0.9% false blocks, 14 caught
  ```

  Two headline numbers, per this project's row in SHARED.md's table, so the line extends the
  `<number> <unit> (n, method)` template rather than matching it. `--ablation` prints three
  arms: `claims_done` alone (limpet's rule reproduced), plus the evidence gate, plus
  `verification_applies`. `--sweep` runs `claims_done` 0.50 to 0.95; the default is the lowest
  threshold holding false blocks under 2%. Pin `jev-1.13.0`.
- **Failure-mode tests** (`test/jaggedness.test.mjs`): padded state stability, planted
  instruction does not flip the verdict, negated phrasing, a non-English message,
  contradictory instructions versus criteria.
- **Fail-open tests**: malformed stdin, missing `transcript_path`, unreadable transcript, a
  500, a timeout, a missing `prompt_id`, an unwritable session file. All exit 0.

## 6. Implementation plan

Layout: `belay.mjs` (the hook and every pure function it exports), `test/*.test.mjs`,
`tools/{fake-jev,extract-corpus,label,measure}.mjs`, `corpus/` (gitignored except `RUBRIC.md` and
`synthetic/`), `.claude-plugin/{plugin,marketplace}.json`, `hooks/hooks.json`. Ordered so the
risk is retired before the polish.

1. **Skeleton, fake, extractor**, with the projection and redaction. Built together with
   task 2, because this task's `--gate` check needs task 2's gate (REVIEW-3).
   Check: `node tools/extract-corpus.mjs --out corpus --limit 50` prints the record count and
   the share of stops with `mutations > 0`, both read straight off the projection.
2. **Evidence pass and the gate.** Both belts, `DONE_HINT`, `needsDoneCheck`.
   Check: `node --test test/evidence.test.mjs`, fixtures for jest, pytest, cargo, go, a runner
   launched inside a script, a failing suite, an edit-only turn, and one asserting a
   passing-test turn returns `needsDoneCheck === false`. Then `node tools/extract-corpus.mjs
   --out corpus --limit 50 --gate` prints the **base rate**, the share of stops reaching the
   gate. Under ~5% and the tool is pointless whatever the AUROC.
3. **Client and questions**, plus redaction and truncation.
   Check: `node --test test/client.test.mjs test/redact.test.mjs`, plus one round-trip against
   the fake returning four answers.
4. **Rubric and labels.** `corpus/RUBRIC.md` (the conjunction, tie-breaks, what counts as a
   check), auto-label the corpus, hand-label the audit slice with `node tools/label.mjs`
   (shows one projected stop at a time, records y/n/skip). One session.
   Check: `npm run measure -- --labels` prints corpus and audit counts, auto-versus-hand
   agreement, and `DONE_HINT` recall over labeled `false_done`.
5. **Ablate. This is the gate.**
   Check: `npm run measure -- --ablation` prints three AUROCs on the audit set. **Kill
   criterion: if the full gate does not clear 0.60 AUROC and does not beat `claims_done` alone
   by 0.08, stop and ship shadow mode plus the writeup, not a blocker.** Worth publishing
   either way, as a second look at limpet's 0.50 with a better label source.
6. **decide() and hook entry**, with the guard ladder, gated log, and fail-open wrapper.
   Check: `JEV_BASE_URL=http://127.0.0.1:4321 node belay.mjs < test/stop-blocked.json; echo $?`
   prints 2 and a reason; `echo 'not json' | node belay.mjs; echo $?` prints 0; the same input
   twice blocks once; a payload carrying a fresh passing check exits 0 even when the fake
   returns `claims_done: 0.99`.
7. **Measure and sweep.** Check: `npm run measure` prints the headline line and writes
   measure.json; `--sweep` prints the table.
8. **Packaging, README, demo.**
   Check: `claude plugin marketplace add . && claude plugin install jev-belay@jev-belay`, then
   end a turn in a scratch repo after an edit and watch it block.

## Install

Plugin (`.claude-plugin/plugin.json` plus `hooks/hooks.json`), installed with
`/plugin marketplace add <user>/jev-belay` then `/plugin install jev-belay@jev-belay`:

```json
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/belay.mjs","timeout":25}]}]}}
```

Raw, in `~/.claude/settings.json`:

```json
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node ~/src/jev-belay/belay.mjs","timeout":25}]}]}}
```

Needs Node 20+ and Claude Code >= 2.1.196 for `prompt_id`; older versions fall back to the
session-keyed guard, at the cost of one extra possible block per session.

## 7. README slots

Section order per research/04 section 1; every slot is text already in this doc (tagline from
the measure line, command and Requirements from Install, Why from the limpet-0.50 paragraph,
Cost from the per-stop figures, How it works from the section 3 ladder). `.env.example`:
`TYPESAFE_API_KEY` required, `AI_GATEWAY_API_KEY` alternative, `JEV_BELAY_THRESHOLD` and
`JEV_BELAY_LOG` optional.

**Known limits**, the one slot written nowhere else: single turn; **a turn with no file edits
never reaches the question, so a read-only "confirmed, tests pass" passes through untouched,
which is why the demo clip shows a turn with edits**; needs a recognisable runner, so a bespoke
`./check.sh` reads as unknown unless its output carries a runner summary; blocks capped per
prompt and per session; numbers from one private corpus.

## 8. Launch

belay goes first, with jev.nvim. Channel order per SHARED.md: TypeSafe Discord, r/ClaudeAI with
the asciicast and the marketplace line, Show HN on a weekday 7-10am PT ("Show HN: jev-belay, a
Claude Code hook that blocks 'done' when nothing ran"), X with the MP4, awesome list.

First line of the post: *"limpet published a calibration run where its 'did it say done' rule
came out at AUROC 0.50, a coin flip, and left it in shadow. One run, noisy labels, but I think
it points at a missing variable: evidence, not wording. Here is the ablation."* Credit and link
limpet; that is accurate about what they measured and earns a reply from a builder rather than
a competitor.

Assets per research/04 section 2: `asciinema rec` into `agg` into `gifsicle -O3`, under 3 MB.
Record a real session in a scratch repo, not a vhs script, since the claim is that it fires on
real behaviour.

## Gateway shim spec (moved to `jev-lab/tools/jev-proxy/`)

Not a jev-belay task. Node, binds 127.0.0.1 only, no auth, `POST /v1/systemone` in the direct
wire format, calls `experimental_evaluate` (`ai` package, AI SDK 7+) on `typesafe-ai/jev`.
Confirmed from https://vercel.com/docs/ai-gateway/modalities/evaluation (2026-09-18): the
modality supports **boolean, choice and score**, not boolean alone, so all four other projects
can use it. This corrects SHARED.md line 105.

Mapping: `noul` <-> `boolean`, `answers.x.noul` <-> `.probability`, `usage.input_tokens` <->
`usage.inputTokens`, `criteria` through unchanged. Cannot give: `confidence` on choice or score
(absent, so synthesize `max(probabilities)` and re-measure thresholds on the direct API before
publishing), score `legend` (rebuild from the criteria index), a pinned `jev-1.13.0`,
`retry-after` parity, any authentication.

## 9. Open questions, both answered 2026-09-18

1. **The hypothesis.** Kill criterion accepted as written (0.60 AUROC, +0.08 over
   `claims_done` alone), shadow mode plus the writeup accepted as the failure mode.
   **Still undecided in fact:** the ablation has not run against real answers. The gateway
   shim's free tier rate-limited the 100-stop recording at request one, so `corpus/answers/`
   is empty and the README's numbers are unfilled slots. `npm run measure -- --ablation`
   is coded, paced, resumable, and honors `retry-after`; rerun it when quota exists.
2. **Who labels.** A proxy, not the user. `tools/label.mjs --proxy` shells out to
   `claude -p --model sonnet` with `corpus/RUBRIC.md` and one projected stop, and writes
   `source: "claude-sonnet-proxy"`. The 100-stop slice is labeled. Interactive y/n/skip is
   still there for anyone who wants hand labels.

## Build notes, 2026-09-18

What the build changed in this doc, each because a task proved it wrong:

- The `DONE_HINT` pre-screen left the gate (section 4). It failed its own acceptance test:
  33% recall over labeled `false_done`, where the spec demanded 100%.
- `verification_applies` joined the `false_done` label (section 5). Without it the audit set
  scored a docs-only "done" as a catch the tool should have made.
- `final_message` truncation keeps the tail, not the head. The claim is in the last paragraph;
  the head-slice inherited from pi-warden sent the wrong 2000 characters for long messages.
- `.claude-plugin/plugin.json` must **not** carry a `hooks` key. Claude Code 2.1.263 loads
  `hooks/hooks.json` automatically and refuses the plugin with "Duplicate hooks file detected"
  when the manifest names it too. Verified by installing into a throwaway `HOME`.
- `belay.mjs watch` and `--replay` were added on top of this doc as the demo surface, with
  `demo/sample-decisions.jsonl` so the clip records without a key.

## Review round 1: responses

- **Finding 5 (zero-mutation turns): disclosed, not widened.** A turn with no tool calls has no
  evidence either way, so the question would run on message text alone, which is limpet's 0.50
  arm: widening buys false positives, not catches. Known limits states it.
- **Finding 7: kept**, per SHARED.md's table.

## Review round 2: responses

- **A: fixed.** Section 4 writes `needsDoneCheck` out with its inputs, adds the `DONE_HINT`
  pre-screen with a recall check that must come back 0, and gives `decide()` a `verified` hard
  veto so a fresh passing check can never block. Tests in tasks 2 and 6.
- **B: fixed.** Section 5 decides the labeling method; new task 4 writes the rubric and both
  label sets in one session; the ablation is now task 5.
- **C: fixed.** Cited as `README.md:185-190`, the `calibrate` example over 1,500 stops, with
  the 2,645-stop table named as a separate run carrying no "done" row. Launch line softened.
- **D: removed.**
