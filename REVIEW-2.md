# Review round 2: jev-belay CONTEXT.md

## Resolution of REVIEW-1 findings

1. **Differentiator false** — partially resolved. Pitch cites limpet's real 0.50 AUROC
   "done" finding. See new finding C: the 0.50 figure is misattributed to the 2,645-stop table.
2. **Corpus privacy** — resolved. §5 stores a projection only (`task`, redacted
   `final_message`, code-derived `checks_run`/`file_changes`), no raw slices, `--publish`
   opt-in with confirmation.
3. **Gateway shim scope violation** — resolved. Moved to `jev-lab/tools/jev-proxy/`,
   explicit non-goal in §2, absent from §6's file layout.
4. **Loop-guard assumptions** — resolved. CC `>=2.1.196` stated in Install/§3;
   session-keyed fallback with 60s/3-per-session caps; tested with `prompt_id` undefined.
5. **Zero-mutation false-done gap** — resolved by disclosure, named in §7 Known limits.
6. **Unbounded decisions.jsonl** — resolved. Off unless `JEV_BELAY_LOG=1`, 5MB cap, one rotation.
7. **Two numbers on measure line** — resolved (kept, justified against SHARED.md's table).

## New findings

**A. CONCERN — `needsDoneCheck`'s skip condition is never written as a formula, and
`decide()` never reads `evidence.checks`.** §1 promises "a turn where tests genuinely passed
never reaches the question," but §4's `unverified` formula uses only `claims_done`, `outcome`,
`verification_applies` — no evidence field. Safe only if `needsDoneCheck` independently filters
passing-check turns before Jev is called; the doc never states that filter, only implies
"mutations happened." A builder gating on mutations alone will pass a genuinely-verified done
into `decide()`, which then blocks it — inverting the tool's own promise. Fix: write the
formula out (mutation-or-command happened AND no passing check this turn), add a task-2
fixture asserting a passing-test turn exits 0 before the Jev call.

**B. CONCERN — task 4, the kill-criterion gate, cannot run without Open Question 2 answered,
and no task owns writing `RUBRIC.md`.** OQ2 (hand-label ~200 stops vs. auto-label) is still
open in §9. Task 4 needs labeled `false_done`/`legit_stop` records against a rubric §6 lists
as shipped but no numbered task authors. This is the one wall a builder hits mid-session: the
AUROC math is uncomputable until labeling method and count are decided. Fix: answer OQ2 now,
add "write RUBRIC.md" to task 1 or 4.

**C. NIT — the 0.50 AUROC citation still conflates two limpet runs.** README:184-195 is the
`calibrate` command's *example* output, explicitly "a different run from the suggest example
above" (1,500 stops). The honest 2,645-stop table (README:201-217) has no "don't say done
without running tests" row at all. CONTEXT.md:26 and the launch post (§8) both attach "2,645
real stops" to the 0.50 figure, unsupported by the source. Won't block building; will land
wrong if fact-checked against the README. Fix: cite line 190 as the example-run figure, drop
the 2,645 tie-in there.

**D. NIT — Open Question 3 is stale.** §9 asks whether to build `--publish` in v0.1; §5
already answers it (opt-in, confirmation prompt). Prune before this doc returns to the user.

## Answers to the specific checks

Separability hypothesis: computable once OQ2 is answered, not before (finding B). Structural
redaction: sufficient — all four questions read only `task`, `final_message`,
`run.file_changes`, `run.checks_run`, all present in the projection. Three-part loop guard: no
disagreement case exists — the three checks are ORed fallbacks (any true means allow), not
independent voters that can conflict. Buildable without guessing: tasks 1, 3, 5, 6, 7; task 2
needs finding A's formula spelled out; task 4 is blocked on OQ2.

## Verdict

**READY FOR THE SPIKE ONLY.** Build tasks 1-3 now; before task 4, answer Open Question 2
(labeling method and count) and write `RUBRIC.md` — the kill-criterion math cannot run
without it.
