# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versions follow
[SemVer](https://semver.org/).

## [0.2.0] - 2026-09-20

### Added

- The plugin asks for its settings when it is enabled: the TypeSafe key (kept in the
  Keychain), the `claims_done` threshold, the decision log, shadow mode, and a regex for
  your own check command. Each arrives as `CLAUDE_PLUGIN_OPTION_<NAME>` and wins over the
  plain environment variable.
- Subagent work counts. The hook reads the `subagents/` files next to the session
  transcript, keeps the ones carrying this turn's prompt id, and merges them into the turn
  by timestamp, so a turn that delegated its edits no longer looks like one that changed
  nothing.
- Shadow mode: the whole pipeline runs, the turn still ends, and a stop it would have
  blocked prints `jev-belay would have blocked this turn:` and the reason through
  `systemMessage`, which Claude Code shows to you and not to the model.
- The closing message is read from the Stop payload's `last_assistant_message` when the
  host sends it, so the 300 ms re-read is paid only on older hosts.
- `belay.mjs stats` (verdict counts, calls, cost, latency p50 and p90, the last 14 days),
  `belay.mjs last` (the last decision, rendered), and `belay.mjs doctor` (key, host
  version, hook registration, transcripts readable, a round trip through a fake; `--live`
  makes one real call).
- Two skills: `/jev-belay:why` explains the last decision, `/jev-belay:doctor` reads the
  doctor's output back and names the fix for anything that failed.
- Belt 2 reads nextest, deno, ruff, mypy, mocha, rspec, minitest, phpunit, playwright,
  swift, ctest and biome summaries, plus two compiler shapes, rustc's `error[E0119]:` and
  go's `file.go:12:3:`, which decide fail when no runner summary follows them. A compile
  error used to read as a passing check in a `cargo check` or a `go build`.
- `test/runners/` holds a captured or documented output per runner belt 2 claims to know,
  passing and failing, so a belt change has something to fail against.
- A check command of your own: set the `check` option (or `JEV_BELAY_CHECK`) to a regex
  and belt 1 tests it next to the built-in runners. An invalid regex is ignored.

### Changed

- `tui.mjs` holds the live view, the replay, `stats`, `last` and `doctor`. `belay.mjs` is
  the hook and imports it lazily, so the hook path never parses the TUI.
- `.env.example` is gone. Nothing ever read it, and the README told people to copy it.
- The `claims_done` threshold is 0.70, up from 0.65: on the re-extracted corpus, with
  subagent turns folded in, 0.70 is the lowest cutoff holding wrong blocks under 2%, and
  it catches the same 7 of 12 false dones.
- A check regex that matches the empty string is ignored like a broken one, since `.*`
  would make every Bash call a passing check. An RSpec error outside the examples is a
  failure whatever the failure count says. The rustc rule needs the numbered diagnostic or
  cargo's closing line, so `git push` is no longer quoted as a failed check.

### Fixed

- A threshold that is not a number no longer disables blocking silently; it falls back to
  the default.
- The plugin install never delivered a key. The README pointed at a `.env` file that
  neither the hook nor Claude Code reads, so a plugin user got "no key", exit 0, forever,
  with nothing saying so.
- A compile error in a `cargo check` or a `go build` read as a passing check, which sent
  Jev a state saying a check passed and put the same claim in the nudge.

### Measured

- The ablation on the re-extracted corpus (2,694 stops, 477 reaching the gate, 17.7%),
  same 100-stop audit slice with 12 false dones, direct API, `jev-1.13.0`, 2026-09-20:
  AUROC 0.777 for the wording alone, 0.886 with the evidence gate, 0.976 for the full
  hook, interval 0.915 to 1.000. On the 76 gated stops: 0.967 against 0.844. At 0.70:
  8 blocks in 100, 7 right. Median call 1,222 input tokens, $0.00005, 346 ms.

## [0.1.1] - 2026-09-19

### Changed

- The `claims_done` threshold is 0.65, down from 0.75: the sweep over 100 labeled stops
  answered by `jev-1.13.0` picks the lowest cutoff that keeps wrong blocks under 2%, and
  0.65 catches one more false done than 0.75 at the same one wrong block.
- A corpus record's id is the hash of its projected text rather than its position in the
  file, so a label follows the stop it describes.

### Measured

- The ablation on 100 labeled stops (12 false dones), direct API, `jev-1.13.0`: AUROC
  0.729 for the wording alone, 0.825 with the evidence gate, 0.965 for the full hook.
  Median call 1,181 input tokens, $0.00005, 344 ms end to end.

### Fixed

- The hook reads the transcript a second time, 300 ms after the gate. Claude Code writes
  the turn's closing message after it fires Stop, so a turn that ended on tool calls was
  judged on a mid-turn preamble or on nothing at all.
- `tools/fake-jev.mjs` answers as `fake-jev-fixtures` rather than echoing the requested
  model name, so a fixture answer can never render as `jev-1.13.0`.
- The gate now runs. Belt 1 reported a pass as soon as a command named a runner and the
  host had not flagged an error, but Claude Code does not flag a test runner's nonzero
  exit, so a failing suite counted as verification and the turn skipped the question.
- A slash command no longer splits a turn, which used to discard the evidence before it.
- The hook no longer becomes a silent no-op when it is invoked through a symlink.
- `watch` no longer drops every decision after the first one containing a non-ASCII
  character.
- Redaction covers JSON-quoted keys, Stripe and npm tokens, and a password in a connection
  string with no username. It no longer eats the word after "bearer" in ordinary prose.
- Paths are rewritten using the transcript's own home rather than `$HOME`.
- The `outcome` choice needs 0.4 confidence before its `blocked` value vetoes a decision.
- Session state is written through a rename; a truncated file used to reset the block caps.
- `readStdin` gives up after 10 s instead of stalling the turn until the host kills it.

### Added

- A stop the gate lets through on a passing check is logged as `passed`, no call, no
  cost, so the live view shows what the hook stayed out of.
- The live view redrawn for a camera: what was said and what ran as adjacent lines,
  sentences instead of question ids, a full-width verdict band, bars that fill, `--pace`
  and `--wide`.
- `demo/take-vhs.sh` and `demo/render.mjs`: the clip, recorded headless from a real
  interactive Claude Code session and cut with captions.
- Belt 2 reads vitest, bun test, mix, dotnet, gradle, maven and eslint summaries, plus
  pytest runs long enough to print a wall clock and five-digit TypeScript error codes.
- Every AUROC prints its 95% interval, and `--ablation` adds the comparison restricted to
  stops that reach the gate, next to the one that includes those it zeroes.
- `CONTRIBUTING.md`, and a GitHub Actions workflow running the suite offline on Node 20
  and 22.

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
