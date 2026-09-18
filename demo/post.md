# Launch copy

Drafts. **Every `__` is a slot that stays empty until `npm run measure -- --ablation` runs
against a real key.** Posting with a number in it before then would be the one thing this
project spent a week not doing.

Channel order (docs/SHARED.md, "Launch"): TypeSafe Discord, r/ClaudeAI, Show HN on a
weekday 7-10am PT, X with the MP4, awesome list.

## X, three posts

**1 (the clip goes here, `demo/demo.mp4`)**

> limpet published a calibration run where its "did it say done" rule came out at AUROC
> 0.50, a coin flip, and left it in shadow mode. One run, noisy auto-labels, but I think it
> points at a missing variable rather than a dead idea: evidence, not wording.
>
> jev-belay reads the transcript first. A Claude Code Stop hook, 700 lines, no deps.

**2**

> The rule limpet measured asks a model to judge "Done, tests pass" with no run facts in
> front of it. belay establishes whether a check actually ran this turn, from the command
> text and from the runner's own summary in stdout, and only then spends one Jev call on
> four questions. 16.6% of stops reach that call. The rest are a local file read.
>
> Ablation over 100 labeled stops: claims_done alone __, plus the evidence gate __, plus
> verification_applies __. At n=100 the interval is about ±0.17, so read it as a direction.

**3**

> ```
> /plugin marketplace add valentynkit/jev-belay
> /plugin install jev-belay@jev-belay
> ```
>
> $0.000017 a decision, about 100 ms, every error path exits 0. Corpus is 2,491 stops from
> my own machine and never leaves it. Known limits are in the README, including the two I
> have not fixed.
>
> limpet: <link>

Credit and link limpet in post 1, not post 3, and say what they measured accurately. The
point of leading with their number is that it is the best evidence anyone has published,
not that it is wrong.

## Show HN

Title: `Show HN: jev-belay, a Claude Code hook that blocks "done" when nothing ran`

First comment: the limpet paragraph above, then the ablation table with its intervals, then
the Known limits list verbatim from the README. Do not soften the limits for HN; the
subagent gap and the three unswept thresholds are the first two things anyone will find.

## r/ClaudeAI

Title: `I measured whether "Done, tests pass" is detectable when you give the judge the run facts`

Body: the asciicast link, the marketplace line, the base rate (413 of 2,491 stops reach the
gate, 16.6%), and the honest framing that this is shadow-mode evidence until the ablation
lands. r/ClaudeAI reads as a user forum, so lead with the install and put the measurement
second.

## awesome-jev-typesafe

One line, in that repo's format:

```
- [jev-belay](https://github.com/valentynkit/jev-belay) - Claude Code Stop hook that blocks an unverified "done": reads the transcript for a check that actually ran, then asks Jev four questions. $0.000017 a stop.
```
