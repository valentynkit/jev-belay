---
name: doctor
description: Check that jev-belay is installed, keyed, and blocking
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/belay.mjs" *)
---

# Is jev-belay actually wired up

What the doctor found:

!`NO_COLOR=1 node "${CLAUDE_PLUGIN_ROOT}/belay.mjs" doctor`

Report each line above to the user in a short list, in the order it was printed. For every
`FAIL`, give the fix the line names and say what stays broken until it is done: with no key
the hook exits 0 on every stop, and with no registration it never runs at all. A `skip` is
not a problem, it is a check that could not be made here. If every line is `ok`, say so in
one sentence and stop.
