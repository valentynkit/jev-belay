# Contributing

Small project, few rules, one of them unusual. Read that one first.

## The corpus never leaves your machine

The numbers in the README come from the author's own Claude Code transcripts. That corpus
is not in this repo and never will be. `corpus/` is gitignored apart from `RUBRIC.md` and
`synthetic/`.

If you want to reproduce anything, build your own from your own sessions:

```
node tools/extract-corpus.mjs --out corpus --gate
```

That reads `~/.claude/projects/*/*.jsonl`, and the `subagents/` files beside each session,
and writes a **projection**, not a copy. It runs the evidence pass at extraction time,
folding a turn's subagent lines in, and keeps only the fields the questions read: the task,
the tail of the final assistant message, a count of file changes, and the check commands
with pass or fail. Tool inputs, diffs, file contents and paths never reach disk. On top of
that, `$HOME` becomes `~` and secret-shaped strings become `<redacted>`. A turn whose text
contains `jev-belay:no-corpus` is dropped.

A record's id is `sha256(task + final_message)`, so a label stays attached to the stop it
was written about even when the extractor changes and the turns renumber.

Two things follow for anyone sending a patch: never paste transcript text into an issue, a
commit message or a test fixture, and never commit anything under `corpus/`.

## Tests run offline

```
npm test
```

No key, no network, no install step. There are no dependencies and there will not be any.
Answers come from `tools/fake-jev.mjs`. The five skipped tests are the model-side checks;
they run only with `JEV_LIVE_URL` set, and they are the only tests that ever make a call.

Two rules the suite holds itself to:

- **Every test that asserts a block has a sibling asserting the same path fails open.** A
  hook that blocks by mistake costs more trust than one that misses.
- **Fixtures copy the shape Claude Code actually writes, not a tidied one.** The builder in
  `test/fixtures.mjs` used to set `is_error` whenever a test meant a failure. Real
  transcripts do not: a test runner exiting nonzero leaves no error flag and no exit code
  anywhere in the record. That single tidy-up hid a bug that made the whole gate a no-op.
  If you add a fixture, check the shape against a real transcript first. A runner added to
  belt 2 brings a passing and a failing sample into `test/runners/`, captured from the
  runner where it is installed, or copied from its documentation and marked as such.

## Changing a threshold or a question

Thresholds are measured, not argued about:

```
npm run measure -- --sweep
npm run measure -- --ablation
```

Both print a 95% interval next to every AUROC. The audit slice is small, so the interval is
usually wider than the effect being discussed; a change that moves the point estimate inside
the interval has not been shown to do anything. If you change a question's wording, the
recorded answers are keyed by `sha256(state + questions)` and your change invalidates the
cache, which means a fresh recording run.

## Style

Fewest files that work. No dependency for what a few lines do. Mark a deliberate shortcut
with a `ponytail:` comment naming the ceiling and the upgrade path. Comments explain why,
not what. No em dashes.
