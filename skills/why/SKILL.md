---
name: why
description: Explain why jev-belay blocked or allowed the last stop
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/belay.mjs" *)
---

# Why the last stop was judged the way it was

The last decision jev-belay recorded:

!`NO_COLOR=1 node "${CLAUDE_PLUGIN_ROOT}/belay.mjs" last`

Read the record above and tell the user in two sentences why that stop was blocked,
allowed, passed, or shadowed. Quote the check on the `ran` line, or say plainly that none
ran. Finish with the single command to run next, which is usually the project's test or
build command. If the record says there is no decision log, say the log is off and that
setting `JEV_BELAY_LOG=1` in the environment Claude Code runs in turns it on.
