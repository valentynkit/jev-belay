#!/usr/bin/env bash
# The two pane take: Claude Code on the left, the live view on the right, one cast.
#
# Run this from a plain terminal window, NOT from inside zellij, and do not touch the
# keyboard while it runs. It types the two prompts itself and stops on its own.
#
#   node tools/fake-jev.mjs --port 4321 &                      # or the gateway shim on 4322
#   JEV_BASE_URL=http://127.0.0.1:4321 demo/take2.sh
#
# Roughly two minutes. The cast lands at demo/take2.cast; render it with the commands in
# demo/README.md.
#
# Why this one is not headless: the Claude Code TUI needs a real terminal, and so does
# zellij. Neither runs under a pty handed to them by a script, which is why the single
# pane take (take.sh) records the watch side only.
set -euo pipefail

CAST=${1:-$(cd "$(dirname "$0")" && pwd)/take2.cast}
COLS=${2:-124}
ROWS=${3:-26}
HERE=$(cd "$(dirname "$0")" && pwd)
BELAY="$HERE/../belay.mjs"
SCRATCH=${SCRATCH:-/tmp/belay-take}
SESSION=belay-demo
LOG="$HOME/.claude/belay/decisions.jsonl"
: "${JEV_BASE_URL:?set JEV_BASE_URL to the shim or the fake}"

# --setup-only builds the scratch repo and stops, which is the half that can be checked
# without a terminal.
SETUP_ONLY=${SETUP_ONLY:-}
[ "${1:-}" = "--setup-only" ] && { SETUP_ONLY=1; CAST=/dev/null; }

[ -n "$SETUP_ONLY" ] || [ -t 1 ] || { echo "run this from a terminal window, not from a pipe or an agent"; exit 1; }
[ -n "$SETUP_ONLY" ] || [ -z "${ZELLIJ:-}" ] || { echo "you are inside zellij. Open a plain terminal window and run it there."; exit 1; }
for tool in zellij asciinema claude; do command -v "$tool" >/dev/null || { echo "missing $tool"; exit 1; }; done
[ -n "$SETUP_ONLY" ] || ! zellij list-sessions 2>/dev/null | grep -q "^$SESSION " || { echo "a session named $SESSION is already live; zellij kill-session $SESSION first"; exit 1; }

# The scratch repo: one passing test, one failing one, the hook installed through this
# repo's own settings so the real config is untouched.
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/repo/.claude"
cd "$SCRATCH/repo"
cat > parse.mjs <<'EOF'
// Splits a CSV body into rows. Windows files arrive with CRLF line endings.
export function parseRows(text) {
  return text.split("\n").filter((line) => line.length > 0).map((line) => line.split(","));
}
EOF
cat > parse.test.mjs <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRows } from "./parse.mjs";

test("unix line endings", () => {
  assert.deepEqual(parseRows("a,b\nc,d\n"), [["a", "b"], ["c", "d"]]);
});

test("windows line endings", () => {
  assert.deepEqual(parseRows("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
});
EOF
echo '{ "name": "csv-demo", "type": "module", "scripts": { "test": "node --test" } }' > package.json
printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node %s","timeout":25}]}]}}\n' "$BELAY" > .claude/settings.json
cat > .claude/settings.local.json <<'EOF'
{"permissions":{"allow":["Read","Edit","Write","Bash(npm test:*)","Bash(node --test:*)","Bash(grep:*)","Bash(ls:*)","Bash(find:*)"],"deny":[]}}
EOF
git init -q && git add -A && git commit -qm "csv parser"

# Trust this directory up front. The dialog is a keypress the driver below cannot answer,
# and answering it on camera is thirty wasted frames.
node -e '
const fs = require("fs"), os = require("os");
const path = os.homedir() + "/.claude.json";
const j = JSON.parse(fs.readFileSync(path, "utf8"));
const dir = process.argv[1];
// Idempotent, and silent when there is nothing to add: Claude Code writes this file live,
// and every needless rewrite is a chance to clobber one of its own.
if (j.projects && j.projects[dir] && j.projects[dir].hasTrustDialogAccepted) process.exit(0);
j.projects = j.projects || {};
j.projects[dir] = { ...(j.projects[dir] || {}), hasTrustDialogAccepted: true };
fs.writeFileSync(path, JSON.stringify(j, null, 2));
' "$(pwd -P)"

mkdir -p "$(dirname "$LOG")" && : > "$LOG"
[ -n "$SETUP_ONLY" ] && { echo "scratch repo ready at $SCRATCH/repo, hook and permissions written, trust pre-seeded"; exit 0; }

cat > "$SCRATCH/layout.kdl" <<EOF
layout {
    pane split_direction="vertical" {
        pane name="claude code" size="52%" {
            cwd "$SCRATCH/repo"
            command "claude"
            args "--model" "${JEV_DEMO_MODEL:-haiku}"
        }
        pane name="jev-belay" size="48%" {
            cwd "$SCRATCH/repo"
            command "node"
            args "$BELAY" "watch" "--pace" "700"
        }
    }
}
EOF

type_prompt() {
  zellij --session "$SESSION" action write-chars "$1"
  sleep 1
  zellij --session "$SESSION" action write 13   # Enter
}

# Wait for a decision of a given verdict to land, or give up. The log is the only reliable
# signal that a turn ended; sleeping a fixed number of seconds races a slow model.
wait_for() {
  for _ in $(seq 1 "${2:-90}"); do
    grep -q "\"verdict\":\"$1\"" "$LOG" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

(
  sleep 8                                   # zellij up, Claude Code past its splash
  type_prompt "Rename parseRows to parseCsvRows everywhere it appears, and add a short jsdoc comment above it."
  wait_for blocked 120 || true              # the block, then the model's own recovery
  sleep 45
  type_prompt "Also trim whitespace around each field, and cover it with a test."
  wait_for passed 120 || true
  sleep 6
  zellij --session "$SESSION" action quit || true
) &
DRIVER=$!

JEV_BELAY_LOG=1 TYPESAFE_API_KEY=${TYPESAFE_API_KEY:-demo} \
  asciinema rec "$CAST" --window-size "${COLS}x${ROWS}" --overwrite \
  -c "zellij --session $SESSION --layout $SCRATCH/layout.kdl"

wait "$DRIVER" 2>/dev/null || true
echo
echo "cast: $CAST"
echo "render it with the agg and ffmpeg commands in demo/README.md"
