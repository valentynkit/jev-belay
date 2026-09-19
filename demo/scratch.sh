#!/usr/bin/env bash
# Builds the scratch repo the demo is recorded in: one passing test, one failing one, the
# hook installed through the repo's own settings so the real ~/.claude is untouched.
#
#   demo/scratch.sh [dir]        default /tmp/belay-take
set -euo pipefail

SCRATCH=${1:-/tmp/belay-take}
BELAY=$(cd "$(dirname "$0")/.." && pwd)/belay.mjs

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
# statusLine blanked: the user's own status bar is noise on camera.
printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node %s","timeout":25}]}]},"statusLine":{"type":"command","command":"true"}}\n' "$BELAY" > .claude/settings.json
cat > .claude/settings.local.json <<'EOF'
{"permissions":{"allow":["Read","Edit","Write","Bash(npm test:*)","Bash(node --test:*)","Bash(grep:*)","Bash(rg:*)","Bash(ls:*)","Bash(cat:*)"],"deny":[]}}
EOF
git init -q && git add -A && git commit -qm "csv parser"

# Trust the directory up front: the dialog is a keypress the driver cannot answer. Only
# written when missing, because Claude Code writes this file live.
node -e '
const fs = require("fs"), os = require("os");
const path = os.homedir() + "/.claude.json";
const j = JSON.parse(fs.readFileSync(path, "utf8"));
const dir = process.argv[1];
if (j.projects && j.projects[dir] && j.projects[dir].hasTrustDialogAccepted) process.exit(0);
j.projects = j.projects || {};
j.projects[dir] = { ...(j.projects[dir] || {}), hasTrustDialogAccepted: true };
fs.writeFileSync(path, JSON.stringify(j, null, 2));
' "$(pwd -P)"

# zellij without startup tips (they swallow the first prompt), themed like the user's own.
mkdir -p "$SCRATCH/zj"
{ grep -vE "^\s*show_(startup_tips|release_notes)" ~/.config/zellij/config.kdl 2>/dev/null || true
  printf '\nshow_startup_tips false\nshow_release_notes false\n'; } > "$SCRATCH/zj/config.kdl"
ln -sfn ~/.config/zellij/themes "$SCRATCH/zj/themes"
cat > "$SCRATCH/layout.kdl" <<EOF
layout {
    pane split_direction="vertical" {
        pane name="claude code" size="55%" {
            cwd "$SCRATCH/repo"
            command "claude"
            args "--model" "${JEV_DEMO_MODEL:-haiku}"
        }
        pane name="jev-belay watch" size="45%" {
            cwd "$SCRATCH/repo"
            command "node"
            args "$BELAY" "watch" "--pace" "700"
        }
    }
}
EOF
echo "scratch repo at $SCRATCH/repo"
