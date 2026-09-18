# jev-belay

A Claude Code Stop hook that blocks "Done, tests pass" when nothing ran. AUROC __ against
__ for the wording alone, on 100 labeled stops out of a 2,491-stop corpus, at about
$0.00002 a decision.

The two AUROC slots stay empty until `npm run measure -- --ablation` runs against a real
key. Nothing in this README is a guessed number.

Read the interval before the number when it lands. At 100 stops with around 12 of them
labeled false done, the 95% interval on an AUROC is roughly plus or minus 0.17, wide enough
to cover both the 0.60 this project set as its bar and the 0.50 it is arguing with. The
measure command prints the interval next to every figure and says so itself when the
interval is wider than the difference being tested.

```
/plugin marketplace add valentynkit/jev-belay
/plugin install jev-belay@jev-belay
```

<!-- demo.gif goes here: the block, the fix, the second Done. See demo/README.md. -->

## Why

limpet published a calibration run over 1,500 real stops where its rule "don't say done
without running the tests" came out at **AUROC 0.50** and got left in shadow mode
(`README.md:185-190`). A coin flip. Its other rules reached 0.60 to 0.62, and the separate
2,645-stop table in that README carries no "done" row at all.

That is one run with the author's own noisy auto-labels, but it is the best evidence
anyone has, and it names a missing variable rather than a dead idea. limpet judges the
message with no run facts in front of it. belay reads the transcript first: a regex belt
establishes whether a check actually ran this turn, from the command text and from the
runner's own summary in stdout. The question is only asked when something changed and
nothing fresh passed, and the answer is read together with that evidence.

The honest limit, up front: a turn with no file edits never reaches the question, so a
read-only "confirmed, tests pass" sails through. The evidence gate is what makes the rest
work, and it is also what makes that case invisible.

## Cost and speed

| | per stop that reaches the question |
|---|---|
| Jev calls | 1, four questions in it |
| input tokens | 410 on one measured call |
| cost | $0.000017 at $0.042 per million |
| latency | __ measured; TypeSafe documents about 100 ms direct, and the hook budget is 20 s inside a 25 s timeout |
| stops that reach it | 16.6% (413 of 2,491 stops in one real corpus) |

Every other stop costs nothing: the gate is a transcript read.

## Install

As a plugin:

```
/plugin marketplace add valentynkit/jev-belay
/plugin install jev-belay@jev-belay
```

Or by hand in `~/.claude/settings.json`:

```json
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node ~/src/jev-belay/belay.mjs","timeout":25}]}]}}
```

Then `cp .env.example .env` and set a key.

| variable | required | purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | yes | the Jev key. Without it the hook exits 0 and does nothing |
| `JEV_API_KEY` | no | accepted as an alternative name for the same key |
| `JEV_BASE_URL` | no | point at a gateway shim or at `tools/fake-jev.mjs` instead |
| `JEV_BELAY_THRESHOLD` | no | `claims_done` cutoff, default 0.75 |
| `JEV_BELAY_LOG` | no | `1` writes `~/.claude/belay/decisions.jsonl` |
| `JEV_BELAY_TIMEOUT_MS` | no | whole-call budget including retries, default 20000 |
| `JEV_BELAY_DEBUG` | no | `1` prints why the hook did what it did, on stderr |
| `JEV_MODEL` | no | pinned to `jev-1.13.0`, because aliases move |

Requirements: Node 20+, and Claude Code 2.1.196 or newer for `prompt_id`. Older versions
fall back to a session-keyed guard, at the cost of one extra possible block per session.

## Use

Nothing to run. End a turn after an edit without running the tests and the hook speaks up:

```
jev-belay: reports completion (0.96) after 2 file changes with no test, build, or lint run
since the last change. Run the project's tests, build, or lint on what you changed. Then
report the actual result.
```

Watch the decisions as they land, which is also how the demo is recorded:

```
JEV_BELAY_LOG=1 node belay.mjs watch
node belay.mjs --replay demo/sample-decisions.jsonl
```

## How it works

```
Stop payload on stdin
  ├─ stop_hook_active, already blocked here, or over the session cap -> exit 0
  ├─ no key -> exit 0
  ├─ read the transcript slice since your last prompt        [local, free]
  │    belt 1: a runner named in the command text
  │    belt 2: a runner's own summary in the output
  ├─ nothing changed, or a check passed after the last change -> exit 0
  ├─ one Jev call, four questions, state is 3 short fields
  └─ decide() -> block: exit 2 with a reason, or exit 0
```

The four questions are `claims_done`, `claims_verified`, `verification_applies`, and
`outcome`, wording borrowed from pi-warden's `src/done.ts`. Code owns the transcript walk,
the counting, every threshold, the timeouts and the dedup. Jev owns one judgment.

State is the task, the tail of the final message, the number of file changes, and the
checks that ran. The transcript itself never leaves the machine: no tool inputs, no diffs,
no file contents, no paths beyond `~`. Secret-shaped strings are redacted first.

## Known limits

- One turn. A false done spread over three turns reads as three separate stops.
- A turn with no file edits never reaches the question, so a read-only "confirmed, tests
  pass" passes through untouched. The demo clip shows a turn with edits for that reason.
- Work done by a subagent is invisible. Claude Code writes it to a separate transcript file
  that the hook never opens, so a turn that delegated the edits looks like a turn that
  changed nothing and never reaches the question.
- Needs a recognisable runner. A bespoke `./check.sh` counts only if its output carries a
  summary from one of the runners belt 2 knows (jest, vitest, bun, pytest, cargo, go, mix,
  dotnet, gradle, maven, eslint, tsc, `node --test`).
- Blocks are capped: one per prompt, none within 60 seconds of the last, three per session.
  Claude Code caps consecutive blocks at 8 on its own, whatever any hook says.
- One of the four decision thresholds has a sweep behind it. `claims_done` at 0.75 is swept
  by `npm run measure -- --sweep`; the 0.5 on `verification_applies`, the 0.7 on
  `claims_verified` and the 0.4 floor under the `outcome` pick are reasoned, not measured.
- The numbers come from one person's private corpus, labeled by a proxy labeler, not by
  hand. `corpus/RUBRIC.md` says exactly what was labeled and how.
- Every error path exits 0. A hook that blocks by accident costs more trust than one that
  misses a case.
- The separability hypothesis is not settled yet. Until the ablation runs against a real
  key, treat this as shadow-mode evidence: install it, set `JEV_BELAY_LOG=1`, watch what it
  would have blocked.

## Development

```
npm test                         offline, no key, against tools/fake-jev.mjs
node tools/extract-corpus.mjs --out corpus --gate
node tools/label.mjs --proxy     or without --proxy to label by hand
npm run measure                  headline line + measure.json
npm run measure -- --ablation    the three arms and the kill criterion
npm run measure -- --sweep       thresholds against the false-block budget
npm run measure -- --dir corpus/synthetic --labels    the eight stops shipped in the repo
```

`corpus/` is gitignored except the rubric: it is built from your own transcripts and stays
on your machine.

## License

MIT.
