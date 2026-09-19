#!/usr/bin/env bash
# The clip, headless: a real Claude Code session in a scratch repo, Claude Code on the left
# and the live view on the right, recorded by vhs, cut and captioned by render.mjs.
#
#   node tools/fake-jev.mjs --port 4321 &                    # or the gateway shim on 4322
#   JEV_BASE_URL=http://127.0.0.1:4321 demo/take-vhs.sh      # -> demo/demo.mp4, demo/demo.gif
#
# Needs vhs, ttyd, ffmpeg, zellij, claude. vhs pulls its own Chromium on first run. Runs
# from anywhere, including inside another Claude Code session: vhs owns a real pty, which
# is the one thing the Claude Code TUI and zellij both refuse to live without.
#
# Nothing in the two prompts mentions tests, the block, or belay. What the model does with
# them is the recording. Roughly three minutes.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRATCH=${SCRATCH:-/tmp/belay-take}
WORK=${WORK:-/tmp/belay-vhs}
SESSION=belay-vhs
LOG="$HOME/.claude/belay/decisions.jsonl"
: "${JEV_BASE_URL:?set JEV_BASE_URL to the shim or the fake}"
for tool in vhs ttyd ffmpeg zellij claude; do command -v "$tool" >/dev/null || { echo "missing $tool"; exit 1; }; done

"$HERE/scratch.sh" "$SCRATCH"
mkdir -p "$(dirname "$LOG")" && : > "$LOG"
rm -rf "$WORK" && mkdir -p "$WORK"

# A dead session with this name makes zellij refuse to start a new one.
zj() { env -u ZELLIJ -u ZELLIJ_SESSION_NAME zellij "$@"; }
zj kill-session "$SESSION" 2>/dev/null || true
zj delete-session "$SESSION" --force 2>/dev/null || true

# The tape. The prompt typing is what the viewer sees; the launch line is hidden. Escape
# then i: the user's vim editor mode starts in NORMAL and eats the first keystrokes.
# Wait+Screen keys on the watch pane's verdict bands, so the tape follows the model's pace.
PROMPT1="Rename parseRows to parseCsvRows in parse.mjs and parse.test.mjs, and add a short jsdoc comment above it."
PROMPT2="Also trim whitespace around each field, and cover it with a test."
# Output stays relative: vhs's parser misreads a hyphen in an absolute path as a flag.
cat > "$WORK/take.tape" <<EOF
Output frames/
Set Shell "bash"
Set Width 1600
Set Height 900
Set FontSize 17
Set Padding 16
Set Framerate 15
Set TypingSpeed 25ms
Set Theme "Kanagawa"
Set FontFamily "JetBrainsMono Nerd Font Mono"
Set WaitTimeout 240s

Hide
Type "env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_FORCE_SESSION_PERSIST=1 JEV_BELAY_LOG=1 TYPESAFE_API_KEY=${TYPESAFE_API_KEY:-demo} JEV_BASE_URL=$JEV_BASE_URL zellij --config-dir $SCRATCH/zj -s $SESSION -n $SCRATCH/layout.kdl"
Enter
Sleep 8s
Escape
Sleep 3s
Type "i"
Sleep 1s
Show

Sleep 1s
Type "$PROMPT1"
Sleep 600ms
Enter
Wait+Screen@240s /BLOCKED/
Sleep 75s
Type "$PROMPT2"
Sleep 600ms
Enter
Wait+Screen@240s /PASSED/
Sleep 6s
EOF

# Answers any permission prompt the way a user would, and logs that it did.
(
  for _ in $(seq 1 400); do
    s=$(zj --session "$SESSION" action dump-screen 2>/dev/null || true)
    if grep -q "Do you want to proceed?" <<<"$s"; then
      echo "$(date +%T) approved a prompt" >> "$WORK/approvals.log"
      zj --session "$SESSION" action write 13
      sleep 3
    fi
    sleep 2
  done
) &
WATCHER=$!

(cd "$WORK" && timeout 900 vhs take.tape > vhs.log 2>&1) || true
kill "$WATCHER" 2>/dev/null || true
zj kill-session "$SESSION" 2>/dev/null || true
zj delete-session "$SESSION" --force 2>/dev/null || true

FRAMES=$(ls "$WORK/frames" 2>/dev/null | grep -c frame-text || true)
[ "$FRAMES" -gt 100 ] || { echo "vhs captured $FRAMES frames; see $WORK/vhs.log"; exit 1; }
[ -s "$WORK/approvals.log" ] && { echo "permission prompts were answered on camera:"; cat "$WORK/approvals.log"; }
echo "decisions:"; cut -c1-120 "$LOG"

# t1: seconds from Show to the first Enter (1s settle plus the typing). The second prompt
# lands 75s after the block, plus its own typing; render.mjs measures the rest by colour.
T1=$(node -e "console.log((1 + ${#PROMPT1} * 0.025 + 0.6).toFixed(2))")
T2_AFTER_BLOCK=$(node -e "console.log((75 + ${#PROMPT2} * 0.025 + 0.6).toFixed(2))")
node "$HERE/render.mjs" "$WORK/frames" "$HERE/demo.mp4" "{\"fps\":15,\"t1\":$T1,\"t2AfterBlock\":$T2_AFTER_BLOCK}"

# The README copy: same cut, half size, 12 fps, palette per frame.
ffmpeg -loglevel error -y -i "$HERE/demo.mp4" -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "$WORK/demo-raw.gif"
gifsicle -O3 --lossy=60 "$WORK/demo-raw.gif" -o "$HERE/demo.gif"
ls -la "$HERE/demo.mp4" "$HERE/demo.gif"
