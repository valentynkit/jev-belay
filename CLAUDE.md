# jev-belay

Claude Code Stop hook: blocks an unverified "done", fails open on everything else. Read
`../CLAUDE.md` for the monorepo rules, then `CONTEXT.md` here in full.

Verdict after three review rounds: **ready for the spike only**. Build tasks 1 to 4, run the
task 5 ablation, stop. The kill criterion (0.60 AUROC and +0.08 over `claims_done` alone)
decides whether this ships as a blocker or as shadow mode plus a write-up.

Project-specific rules:
- `corpus/` is built from the user's own `~/.claude/projects/*/` transcripts, gitignored,
  redacted to the projected fields only. Never commit it, never echo transcript text.
- Any hook error exits 0. Every test asserting a block has a sibling asserting fail-open.
- Zero dependencies, Node 20+, single `belay.mjs` plus `tools/` and `test/`.
- The gateway shim is not this project; its spec sits at the end of CONTEXT.md and it
  lives at `../tools/jev-proxy/`.
