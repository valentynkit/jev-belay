#!/usr/bin/env bash
# One take: a real Claude Code session in a scratch repo, recorded from the watch pane.
#
#   demo/take.sh [cast] [cols] [rows]
#
# Needs a Jev backend. Real answers:
#   (cd ~/Projects/mine/jev-lab/tools/jev-proxy && AI_GATEWAY_API_KEY=... npm start)
#   JEV_BASE_URL=http://127.0.0.1:4322 demo/take.sh
# Plumbing only, no key, every probability a fixture:
#   node tools/fake-jev.mjs --port 4321 &
#   JEV_BASE_URL=http://127.0.0.1:4321 demo/take.sh
#
# The scratch repo ships a passing test and a failing one. Nothing in the two prompts
# mentions tests, the block, or belay: what the model does with them is the recording.
set -euo pipefail

CAST=$(cd "$(dirname "${1:-demo/take.cast}")" 2>/dev/null && pwd)/$(basename "${1:-demo/take.cast}")
COLS=${2:-60}
ROWS=${3:-22}
BELAY=$(cd "$(dirname "$0")/.." && pwd)/belay.mjs
SCRATCH=${SCRATCH:-/tmp/belay-take}
LOG="$HOME/.claude/belay/decisions.jsonl"
: "${JEV_BASE_URL:?set JEV_BASE_URL to the shim or the fake}"

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
# Project settings, so the hook is installed for this repo only and the real ~/.claude is
# left alone. The decision log is the real one; it is cleared here, not deleted.
printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node %s","timeout":25}]}]}}\n' "$BELAY" > .claude/settings.json
git init -q && git add -A && git commit -qm "csv parser"

mkdir -p "$(dirname "$LOG")" && : > "$LOG"

TOOLS="Read,Edit,Write,Bash(npm test:*),Bash(node --test:*)"
run() { echo "$1" | JEV_BELAY_LOG=1 TYPESAFE_API_KEY=${TYPESAFE_API_KEY:-demo} \
  timeout 420 claude -p ${2:-} --model "${JEV_DEMO_MODEL:-haiku}" --allowedTools "$TOOLS" >/dev/null 2>&1 || true; }

(
  sleep 3
  run "Rename parseRows to parseCsvRows everywhere it appears, and add a short jsdoc comment above it."
  sleep 2
  run "Also trim whitespace around each field, and cover it with a test." -c
  sleep 3
  pkill -f "belay.mjs watch" || true
) &

asciinema rec "$CAST" --window-size "${COLS}x${ROWS}" --overwrite \
  -c "node $BELAY watch --pace 700"
wait
echo "cast: $CAST"
