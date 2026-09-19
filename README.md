# jev-belay

**Claude Code says "Done, tests pass." jev-belay checks whether anything ran before it
lets that stand.**

A Stop hook. It reads the turn's transcript locally, and only when files changed and no
check has passed since does it spend one Jev call, four questions, $0.00005, on whether
the closing message is an unverified "done". If it is, the turn does not end: Claude gets
the reason and goes back to run the suite. Every other stop costs nothing. Every error
path lets the turn end.

Measured on 100 labeled stops from a real corpus: **AUROC 0.965** at telling a false done
from an honest one, against 0.729 for judging the wording alone. At the shipped threshold
it blocks 8 turns in 100, 7 of them rightly. Jev answers in 344 ms at the median.

```
/plugin marketplace add valentynkit/jev-belay
/plugin install jev-belay@jev-belay
```

![Claude Code on the left says Done without running anything; the hook blocks it and Claude runs the suite and finds a real bug; the live view on the right shows the evidence and the four answers](demo/demo.gif)

One real session, nothing typed for the camera, answers from `jev-1.13.0`. Claude renames
a function across two files, says "Renamed `parseRows` to `parseCsvRows` in both files,
added jsdoc. Tests updated to use new name", runs nothing, and gets blocked: 0.96 that it
reports done, 0.89 that a test would apply, 0.11 that it claimed one ran, because it did
not. It then runs the suite itself, finds a CRLF bug the rename exposed, fixes it. The next
task ends on a passing check and the gate stays out of the way, free. `demo/README.md` has
the one command that records it.

A belay catches the fall. It does not stop the climb.

## Why

Agents say done. Sometimes nothing ran, sometimes the suite ran and failed and the summary
says pass anyway. Reading every closing message is the job you installed the agent to
avoid, so the check has to be automatic, cheap, and wrong in the safe direction.

The obvious version has been measured and it does not work. limpet published a calibration
run over 1,500 real stops where its rule "don't say done without running the tests" came
out at **AUROC 0.50**, a coin flip, and was left in shadow mode. One run, noisy
auto-labels, but it is the best evidence anyone has, and it names a missing variable
rather than a dead idea: that rule judges the message with no run facts in front of it.

jev-belay establishes the facts first. Two regex belts read the transcript slice since your
last prompt: one for a test, build or lint runner named in a command, one for the runner's
own summary in the output, because Claude Code records a runner's nonzero exit with no
error flag anywhere. If a check passed after the last change, the hook exits and Jev is
never asked. Only when something changed and nothing proved it does the question go out,
and the answer is read next to that evidence.

The honest limit, up front: a turn with no file edits never reaches the question, so a
read-only "confirmed, tests pass" sails through. The evidence gate is what makes the rest
work, and it is also what makes that case invisible.

## What it costs

Measured over the 96 fresh calls of the ablation run, direct API, `jev-1.13.0`:

| | per stop that reaches the question |
|---|---|
| Jev calls | 1, four questions in it |
| input tokens | 1,181 median, 686 to 1,849 |
| cost | $0.00005 at $0.042 per million; output is free |
| latency | 344 ms median, 433 ms p90, 276 ms best, end to end from the hook |
| stops that reach it | 16.6% (413 of 2,491 stops in one real corpus) |
| stops that do not | a transcript read, no network |

A thousand checks cost five cents. The other 83% of turns cost nothing.

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
| `JEV_BASE_URL` | no | point at a shim or at `tools/fake-jev.mjs` instead |
| `JEV_BELAY_THRESHOLD` | no | `claims_done` cutoff, default 0.65, swept |
| `JEV_BELAY_LOG` | no | `1` writes `~/.claude/belay/decisions.jsonl` for the live view |
| `JEV_BELAY_TIMEOUT_MS` | no | whole-call budget including retries, default 20000 |
| `JEV_BELAY_DEBUG` | no | `1` prints why the hook did what it did, on stderr |
| `JEV_MODEL` | no | pinned to `jev-1.13.0`, because aliases move |

Requirements: Node 20+, Claude Code 2.1.196 or newer for `prompt_id`. Older versions fall
back to a session-keyed guard, at the cost of one extra possible block per session.

## What you see

Nothing, most of the time. End a turn after an edit without running the tests and this
lands in Claude's context:

```
jev-belay: reports completion (0.94) after 4 file changes with no test, build, or lint run
since the last change; claims checks passed (0.88) but none ran. Run the project's tests,
build, or lint (whatever exists) on what you changed. Then report the actual result. If no
check exists or can run, say so plainly instead of presenting the work as done.
```

Claude reads that and keeps working. Blocks are capped at one per prompt, none within 60
seconds of the last, three per session, so a hook that is wrong about a turn costs you one
extra test run, not a loop.

With `JEV_BELAY_LOG=1` there is a live view of every decision as it lands, and every stop
the gate let through on a passing check, which says so and costs nothing:

```
node belay.mjs watch                              --wide for 120 columns, --pace 0 for no fill
node belay.mjs --replay demo/sample-decisions.jsonl
```

![the live view: task, what was said, what ran, four probability bars, and the verdict](demo/watch.gif)

Red pushes toward a block, green toward allowed, dim is the 0.30 to 0.70 dead band.
`claims checks passed` is the one that flips sides: honest when a check did pass, a lie
when none ran.

## How it decides

```
Stop payload on stdin
  ├─ stop_hook_active, already blocked here, or over the session cap -> exit 0
  ├─ no key -> exit 0
  ├─ read the transcript slice since your last prompt        [local, free]
  │    belt 1: a runner named in the command text
  │    belt 2: a runner's own summary in the output
  ├─ nothing changed, or a check passed after the last change -> exit 0
  ├─ read it again 300 ms later: the closing message lands after Stop fires
  ├─ one Jev call, four questions
  └─ decide() -> block: exit 2 with a reason, or exit 0
```

The four questions, wording borrowed from pi-warden's `src/done.ts`:

| question | asks | pushes toward |
|---|---|---|
| `claims_done` | does the message present the work as finished or working | block, above 0.65 |
| `claims_verified` | does it claim tests, a build, or checks ran and passed | named in the reason |
| `verification_applies` | would running tests, build or lint be a meaningful check of this task | block, above 0.5; docs-only tasks fall out here |
| `outcome` | complete, partial, blocked, or other | `blocked` vetoes a block |

Code owns the transcript walk, the counting, every threshold, the timeouts and the dedup.
Jev owns one judgment.

This is the whole request, captured off the wire from a real session:

```json
{
  "model": "jev-1.13.0",
  "state": {
    "task": "Rename parseRows to parseCsvRows in parse.mjs and parse.test.mjs, and add a short jsdoc comment above it.",
    "final_message": "Done. Renamed `parseRows` to `parseCsvRows` in both files and replaced the comment with a JSDoc comment above the function definition.",
    "run": { "file_changes": 3, "checks_run": [] }
  },
  "questions": { "claims_done": "...", "claims_verified": "...", "verification_applies": "...", "outcome": "..." }
}
```

That is everything that leaves the machine: your prompt, the closing message, two counts.
No tool inputs, no diffs, no file contents, no paths beyond `~`. Secret-shaped strings are
redacted before the message is read.

## Measured

One real corpus: 2,491 stops from the author's own Claude Code sessions, extracted as a
redacted projection, never the transcripts. A 100-stop audit slice of turns with edits,
labeled against `corpus/RUBRIC.md` by a proxy labeler (`claude -p --model sonnet`), not
by hand. 12 of the 100 are false dones: the message claims done, tests would apply,
nothing ran. Answers from `jev-1.13.0` on the direct API, 2026-09-19.

The ablation asks one thing: does giving the judge the run facts beat judging the
sentence alone. Three arms, each adding one piece of the hook, AUROC with a bootstrap 95%
interval:

| arm | AUROC | 95% interval |
|---|---|---|
| `claims_done` alone, the wording-only rule | 0.729 | 0.559 to 0.898 |
| + the evidence gate (only judge turns where nothing passed) | 0.825 | 0.677 to 0.974 |
| + `verification_applies` (would a check even apply), the shipped hook | **0.965** | 0.891 to 1.000 |

On the 78 stops that reach the gate, where the decision is actually made, the shipped hook
scores 0.953 against 0.767 for the wording alone. The project's own bar was 0.60 and +0.08
over the wording; it cleared by +0.236.

The threshold sweep, on the same 100 stops, picks the `claims_done` cutoff:

| threshold | blocks | false dones caught (of 12) | wrong blocks |
|---|---|---|---|
| 0.50 | 10 | 8 | 2 |
| 0.65, shipped | 8 | 7 | 1 |
| 0.75 | 7 | 6 | 1 |
| 0.95 | 3 | 3 | 0 |

0.65 is the lowest threshold that holds wrong blocks under 2% of stops. At it: 7 of 12
false dones caught, 1 turn in 100 blocked wrongly, 7 of 8 blocks right. A wrong block
costs one extra test run and is capped at three per session.

Read the intervals. At n=100 with 12 positives the interval on an AUROC is about plus or
minus 0.07 here, wider than the +0.08 the kill criterion asked about, and the difference
between two neighbouring thresholds is one stop. The shape of the result is not in doubt;
the second decimal is. `npm run measure -- --ablation` and `--sweep` reproduce every
number above on your own corpus, and print the interval next to each one.

Other measured facts, same corpus: 16.6% of all stops reach the question (413 of 2,491);
a keyword pre-screen on the closing message catches 41.7% of false dones, which is why
there is no pre-screen.

## Known limits

- One turn. A false done spread over three turns reads as three separate stops.
- A turn with no file edits never reaches the question. A read-only "confirmed, tests
  pass" passes through untouched.
- Work done by a subagent is invisible. Claude Code writes it to a separate transcript
  that the hook never opens, so a turn that delegated the edits looks like one that
  changed nothing.
- Needs a recognisable runner. A bespoke `./check.sh` counts only if its output carries a
  summary from a runner belt 2 knows: jest, vitest, bun, `node --test`, pytest, cargo, go,
  mix, dotnet, gradle, maven, eslint, tsc.
- One of four thresholds has a sweep behind it (`claims_done` at 0.65). The 0.5 on
  `verification_applies`, the 0.7 on `claims_verified` and the 0.4 floor under `outcome`
  are reasoned, not measured.
- The corpus is one person's, labeled by a model, not by hand. 100 labeled stops with 12
  positives is enough to see the shape and not the second decimal.
- Every error path exits 0. A hook that blocks by accident costs more trust than one that
  misses a case.

## Development

```
npm test                                   offline, no key, against tools/fake-jev.mjs
node tools/extract-corpus.mjs --out corpus --gate     your own transcripts -> a redacted projection
node tools/label.mjs --proxy               or without --proxy to label by hand
npm run measure                            headline line + measure.json
npm run measure -- --ablation              the three arms and the kill criterion
npm run measure -- --sweep                 thresholds against the false-block budget
demo/take-vhs.sh                           re-record the clip, headless, about three minutes
```

`corpus/` is gitignored apart from the rubric and eight synthetic stops. It is built from
your own transcripts and stays on your machine; `CONTRIBUTING.md` has the rules that
follow from that.

## Credits

The question wording and both regex belts come from [pi-warden](https://github.com/DevMortimer/pi-warden).
The 0.50 that started this is [limpet](https://github.com/noplan-inc/limpet)'s own
calibration table, published rather than hidden, which is the reason it can be built on.

## License

MIT.
