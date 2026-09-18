# Review of jev-belay CONTEXT.md

Verified against source: (1) pi-warden `src/done.ts:12,35-47,98-120` — question wording and
both regex belts match verbatim. (2) Vercel evaluation doc (fetched live) — boolean/choice/score
confirmed, no `confidence` field on choice/score responses, `usage.inputTokens` camelCase, all
match CONTEXT.md's shim table exactly. (3) limpet `README.md` — exit-2/stderr and
second-stop-through claims match, but see Finding 1: the doc's differentiator claim about limpet
is wrong.

## Findings, most severe first

**1. BLOCKER — the differentiator against limpet is false, and the source that disproves it is
cited elsewhere in the same doc.** CONTEXT.md line 33: "None publishes a false-positive number on
real sessions." limpet's own README (`README.md:201-217`) publishes exactly that: an AUROC and
"Caught at 5% false positives" table over 2,645 real Claude Code/Codex stops. Worse for the
differentiator, it undermines it usefully instead: limpet's generic single-question "done" rule
scored AUROC 0.50 on real data — "does not separate; left in shadow" (`README.md:190`). That's the
real differentiator: a regex evidence gate plus narrow structured questions catches what one
generic yes/no rule provably can't, per limpet's own numbers — not "nobody measures this."
Fix: rewrite the paragraph to cite limpet's 0.50 AUROC finding directly instead of asserting no
one publishes a number.

**2. BLOCKER — the corpus privacy plan doesn't match the redaction it describes.** §5 has the
corpus (real transcript slices under `corpus/transcripts/`) as the default testing/measurement
substrate, with redaction limited to `$HOME`→`~` and secret-shaped strings. Real transcript slices
carry full Write/Edit content, prompts, and file paths — proprietary code, other repos' or
clients' names, and non-secret-shaped PII survive that regex untouched. Open question 1 correctly
flags "may the repo ship a redacted slice" as undecided, but §5 is written as if the answer is
already yes (commit-and-replay is the given design), and even a "yes" doesn't make the described
redaction sufficient. Fix: default to not committing `corpus/transcripts/`; ship the extraction
script, `RUBRIC.md`, and a small hand-authored synthetic fixture set instead, and label the
headline number "computed locally, not reproducible from the repo" until a real sanitization pass
is designed and itself tested.

**3. BLOCKER — the gateway shim violates the doc's own scope statement and SHARED.md's
abstraction rule.** §2: "v0.1 is the Stop hook and nothing else," with an explicit non-goals list.
§6 task 7 nonetheless requires building and shipping `tools/jev-proxy/` — a second HTTP server
translating two wire protocols, with its own live-key check — solely for the benefit of four other
projects that don't exist yet. `belay.mjs` itself needs no proxy; it talks to the fake, the direct
API, or the shim indifferently. This is textbook "abstraction before a second concrete use"
(SHARED.md, Repo conventions), operationalized here even though SHARED.md is the one that assigned
it to this repo. Fix: drop task 7 from jev-belay's plan (build it once a second project actually
needs it, or as its own tiny repo), or delete "and nothing else" from §2 and own the larger scope
explicitly.

**4. CONCERN — the stop-loop safety net rests on two unverified assumptions.** `stop_hook_active`
is absent from the current official hooks reference entirely, and a live bug
(anthropics/claude-code#54360) reports it staying `false` on repeat fires within one turn. The
doc's own citation, #55754, is a different bug (a hook ignoring async-subagent waits) whose fix
request is "honor `stop_hook_active` automatically... left to user-hook implementers today" — it
does not establish the flag reaches the hook reliably. Separately, `prompt_id` — the actual
backstop, since it's what "one block per prompt_id" keys on — is documented as absent until first
user input and requires Claude Code ≥2.1.196; CONTEXT.md never states this floor or what happens
when the field is undefined. Fix: state the CC version requirement in Install/README; add a
fallback dedup key (`session_id` + counter) for when `prompt_id` is missing, with a test.

**5. CONCERN — a real false-done scenario is silently out of scope.** The gate (§3) skips Jev
entirely whenever `evidence.mutations === 0`, independent of whether checks ran. A read-only or
investigation turn ("confirmed the bug, tests pass" with zero edits and zero Bash calls) can never
reach the questions — exactly the hook line's own scenario, just without a file edit attached.
"Known limits" (§7) lists single-turn and runner-recognition gaps but not this one. Fix: gate on
mutation-or-command-executed, or disclose the gap explicitly so the published false-block rate
isn't read as "catches all false dones."

**6. NIT — `~/.claude/belay/decisions.jsonl` has no defined reader.** `measure.mjs` replays
`corpus/answers/`, `extract-corpus.mjs` reads live session transcripts; neither touches
`decisions.jsonl`. As specified it's an unbounded, unrotated local log of every stop's (redacted)
final message, on by default, for a "Stop hook and nothing else" v0.1. Fix: gate behind
`JEV_BELAY_LOG`, or state a rotation/size cap.

**7. NIT — the measure line carries two numbers**, bending SHARED.md's
`<number> <unit> (n=<sample>, <method>)` template. Justified by this project's own SHARED.md table
row (it's the one project with two headline numbers), but a one-line note in the doc would save a
future reader the cross-check.

## Keep as-is

pi-warden's question wording and both regex belts, reused near-verbatim, check out against source.
jev-guard's shared-timeout HTTP client (`src/jev.js:29-67`) is a sound lift. The gateway shim's
boolean/choice/score claim and the "no confidence field" claim are accurate against Vercel's
current docs. The fail-open ladder and one-block-per-prompt design are the right shape once
Finding 4's version/fallback gap is closed.
