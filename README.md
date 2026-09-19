# jev-belay

**Claude Code says "Done, tests pass." jev-belay checks whether anything ran before it
lets that stand.**

A Stop hook. It reads the turn's transcript locally, and only when files changed and no
check has passed since does it spend one Jev call, four questions, about $0.00002, on
whether the closing message is an unverified "done". If it is, the turn does not end:
Claude gets the reason and goes back to run the suite. Every other stop costs nothing.
Every error path lets the turn end.

```
/plugin marketplace add valentynkit/jev-belay
/plugin install jev-belay@jev-belay
```

![Claude Code on the left says Done without running anything; the hook blocks it and Claude runs the suite and finds a real bug; the live view on the right shows the evidence and the four answers](demo/demo.gif)

One real session, nothing typed for the camera. Claude renames a function across two
files, says "Done. Tests should still pass", runs nothing, and gets blocked. It then runs
the suite itself, finds a CRLF bug the rename exposed, fixes it. The next task ends on a
passing check and the gate stays out of the way, free. The four probabilities in this take
came from `tools/fake-jev.mjs` and the footer says so; `demo/README.md` has the one
command that re-records it against a key.

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

| | per stop that reaches the question |
|---|---|
| Jev calls | 1, four questions in it |
| input tokens | about 410 |
| cost | $0.000017 at $0.042 per million |
| latency | TypeSafe documents about 100 ms direct; 1.3 s through a gateway shim in my runs |
| stops that reach it | 16.6% (413 of 2,491 stops in one real corpus) |
| stops that do not | a transcript read, no network |

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
| `JEV_BELAY_THRESHOLD` | no | `claims_done` cutoff, default 0.75 |
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
| `claims_done` | does the message present the work as finished or working | block, above 0.75 |
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

## Measured, and not yet

Measured on one real corpus of 2,491 stops from the author's own Claude Code sessions,
labeled by a proxy labeler against `corpus/RUBRIC.md`, never by hand:

- 16.6% of stops reach the question (413). The rest never leave the machine.
- Of the 100-stop audit slice, 12 are labeled false done.
- A keyword pre-screen on the closing message ("done", "fixed", "passes") catches 41.7% of
  those. It is not in the gate; that number is why.

Not yet measured: whether Jev's four questions separate false dones from honest ones
better than the wording alone. The bar this project set for itself is AUROC 0.60 and at
least +0.08 over `claims_done` on its own; under that, the right product is shadow mode
and a writeup, not a blocker. At n=100 the 95% interval on an AUROC is roughly plus or
minus 0.17, so even a good result will point rather than decide. `npm run measure --
--ablation` prints the three arms with their intervals and says so itself when the
interval is wider than the difference being tested. Until it runs against real answers:
install it, set `JEV_BELAY_LOG=1`, and watch what it would have blocked.

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
- One of four thresholds has a sweep behind it (`claims_done` at 0.75). The 0.5 on
  `verification_applies`, the 0.7 on `claims_verified` and the 0.4 floor under `outcome`
  are reasoned, not measured.
- The corpus is one person's, labeled by a model, not by hand.
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
