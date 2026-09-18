# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versions follow
[SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-18

### Added

- Stop hook (`belay.mjs`): reads the turn's evidence from the transcript, and only when
  something changed and nothing fresh passed, spends one Jev call on four questions.
  Blocks with exit 2 and a reason, or exits 0.
- Evidence pass with two regex belts: the runner named in the command, and the runner's
  own summary in the output (jest, vitest, node:test, pytest, cargo, go, tsc).
- Fail-open on every error path: bad payload, unreadable transcript, no key, HTTP error,
  timeout, garbage answers, unwritable state directory.
- Stop-loop guard: one block per prompt (or per session plus transcript length when
  `prompt_id` is absent), no second block within 60 seconds, three per session.
- `belay.mjs watch` renders each decision live as probability bars, with `--replay` for
  recording without a key.
- Corpus tooling: `tools/extract-corpus.mjs` (projection only, redacted, gitignored),
  `tools/label.mjs` (interactive or `--proxy` through `claude -p`), `tools/measure.mjs`
  (`--labels`, `--ablation`, `--sweep`), `tools/fake-jev.mjs`.
- Plugin packaging (`.claude-plugin/`, `hooks/hooks.json`) and `.env.example`.
