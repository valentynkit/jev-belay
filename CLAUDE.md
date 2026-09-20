# jev-belay

A Claude Code Stop hook that blocks an unverified "done" and fails open on everything
else. The hook is `belay.mjs`; the live view and the doctor are `tui.mjs`, which the hook
path never loads. No dependencies, Node 20+. `README.md` says what it does,
`CONTRIBUTING.md` says how to work on it, `demo/README.md` says how the clip is recorded.

Rules that are easy to break by accident:

- `corpus/` is built from the machine owner's own Claude Code transcripts. It is gitignored
  apart from `RUBRIC.md` and `synthetic/`. Never commit it, never paste transcript text
  into a test, an issue, or a commit message.
- Every error path exits 0. Every test that asserts a block has a sibling asserting the
  same path fails open.
- `npm test` runs offline against `tools/fake-jev.mjs`. Real calls happen only through
  `JEV_BASE_URL`, and only from `measure`, `label` and the demo scripts, never from tests.
- Fixtures copy the shape Claude Code actually writes. A runner exiting nonzero leaves no
  `is_error` and no exit code in the transcript; a tidied fixture once hid a bug that made
  the whole gate a no-op.
- Thresholds are measured with `npm run measure -- --sweep` and `--ablation`, which print
  a 95% interval next to every figure. A change inside the interval has not been shown to
  do anything.
- Fewest files that work. A deliberate shortcut carries a `ponytail:` comment naming its
  ceiling. Comments say why, not what. No em dashes.
