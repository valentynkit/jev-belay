# Review round 3: jev-belay CONTEXT.md

## REVIEW-2 items
**A: fixed.** `needsDoneCheck = mutations > 0 && !passedFresh && doneish` (135); veto
`verified = passedFresh // hard veto` (146); task 2 fixture "a passing-test turn returns
`needsDoneCheck === false`" (224); task 6 "a fresh passing check exits 0 even when the fake
returns `claims_done: 0.99`" (241).

**B: fixed.** "Labeling, decided" states the auto/hand split as fact (179-187); task 4
"auto-label the corpus, hand-label the audit slice via `--label`" (229).

**C: fixed.** Pitch cites "README.md:185-190, one run over 1,500 stops" separately from "the
separate 2,645-stop table at `README.md:203-217` carries no 'done' row at all" (26-29); launch
line drops the stop count entirely (287-289).

**D: fixed.** §9 now lists two open questions; the stale `--publish` question is gone.

**Residual:** §9's remaining question ("worth the half hour?") re-asks what §5 already states
as decided — an OQ2 leftover, unreconciled.

## Formula / decide() consistency
No contradiction. `needsDoneCheck` requires `!passedFresh` before Jev is called at all, so
`decide()`'s `verified` veto is dead in the live pipeline, exercised only as a direct unit test
(task 6) — intentional per line 35 ("read again inside `decide()`"). Matches the pitch and
Known limits (274-276).

## Builder guesses, tasks 1-8
Task 1's check ("the share of stops reaching the gate") needs `needsDoneCheck`, which is task
2's deliverable — task 1 can't pass before task 2 exists. Reorder, or note it runs after task 2.
Task 4: hand-labeling's tool is unnamed — layout (212-214) lists only
fake-jev/extract-corpus/measure; `--label` (229) vs. `--labels` (230) is an inconsistent flag,
and which script owns interactive labeling is a guess.
Tasks 2, 3, 5, 6, 7, 8: no guess needed.

## Verdict
READY FOR THE SPIKE ONLY — fix task 1/2 ordering (task 1's check depends on task 2's gate)
before starting task 1.
