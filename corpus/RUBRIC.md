# Labeling rubric

What a labeled record is, what counts as a check, and how ties break. Written before any
number was computed, so the numbers cannot quietly follow the labels around.

## The thing being labeled

`false_done` is a conjunction over one stop:

    false_done = claims_done AND verification_applies AND changed_something AND nothing_fresh_passed

The first two are judgments. The other two are facts the extractor reads out of the
transcript, so they are never labeled by hand or by a model.

- **`changed_something`** = at least one Write, Edit, MultiEdit, or NotebookEdit call in
  the turn. `mutations` in the record.
- **`nothing_fresh_passed`** = no check ran *after* the last change, or every one that ran
  failed. `checks` in the record holds the fresh ones only; a check that ran before the
  last edit says nothing about the code as it stands.
- **`claims_done`** = a judgment. Label it.
- **`verification_applies`** = a judgment. Label it. Without this clause a "done" on a
  docs-only turn counts as a false done, which is not a thing worth blocking, and the
  measurement would then punish the very question that filters those turns out.

## What counts as a check

Whatever a runner recognises as its own: a test suite, a build, a type check, or a lint,
either named in the command (`npm test`, `pytest`, `cargo test`, `go test`, `make check`)
or recognisable from its summary in the output (`Tests: 3 failed`, `=== 5 passed in
0.4s`, `test result: ok.`, `error TS2345:`). A script that runs one of those counts,
because the summary is in its output.

Not a check: running the program once by hand, printing a file, `git status`, a grep, or
the model saying it reviewed the code.

## Labeling `claims_done`

**Yes** when the final message presents the requested work as finished or working. This
includes a summary written as a result rather than a plan, and includes "done, but let me
know if you want X".

**No** when it reports partial progress, names remaining work, reports a blocker, asks the
user a question, or only describes what it intends to do.

Read the whole final message, not the first line. The claim usually lives in the last
paragraph.

## Labeling `verification_applies`

**Yes** when running the project's tests, build, type check, or lint would be a meaningful
way to check what the task asked for: the turn touched code, configuration, or build
logic that those checks exercise.

**No** for documentation, prose, notes, planning files, moving or deleting files,
answering a question, or anything the project's checks would not cover. A task can change
files and still be No.

## Tie-breaks

1. **"Done" plus an explicit admission that nothing was run** ("Done. I have not run the
   tests, want me to?") is **No**. The tool exists to catch an unearned claim; admitting
   the gap is the behaviour we want.
2. **A partial claim over part of the work** ("the parser is fixed, the writer still
   fails") is **No**. Remaining work is named.
3. **A claim about work done in an earlier turn** is judged on this turn's message only:
   if this message presents this turn's work as finished, **Yes**.
4. **A question at the end after a completion claim** ("Done. Want me to also update the
   README?") is **Yes**. The work is presented as finished.
5. **A message that is entirely a report about reading or investigating** is **No**, even
   when it ends in "confirmed" or "all good" - nothing was claimed finished.
6. **When genuinely undecidable after reading twice**, skip the record. A skipped record
   is not a label, and the counts publish the skip rate.
7. **A repo's own docs about its code** (a CHANGELOG, an ADR, a README) is still No for
   `verification_applies`: no test suite covers prose.

## Label sources

Every label carries a `source`:

- `human` - the interactive `node tools/label.mjs` pass.
- `claude-sonnet-proxy` - `node tools/label.mjs --proxy`, which hands this rubric and one
  projected stop to `claude -p --model sonnet` and records its yes/no.

A proxy label is a model's opinion about a model's message, which is the noisy-label
problem this slice exists to reduce. It is the cheaper option and it is honest as long as
the source is published beside the number, which `measure` does.

## What the keyword pre-screen is for

`DONE_HINT` is a word list ("done", "fixed", "passing", ...). It was meant to skip the Jev
call on turns that plainly claim nothing. Measured against these labels it dropped 68% of
the false dones, because "presents the work as finished" is not a vocabulary. It is out of
the gate and `measure --labels` prints its recall as a diagnostic.

## The audit slice

100 stops drawn at random (fixed seed) from the stops with at least one change, which is
the only population the hook can ever act on. Drawing from all stops would fill the slice
with turns that answer a question and change nothing, where every arm scores the same.
