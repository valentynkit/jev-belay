# Recording the clip

Two zellij panes: Claude Code on the left, the live view on the right.

1. Right pane: `JEV_BELAY_LOG=1 node belay.mjs watch`. Left pane: a scratch repo with a
   test suite, `JEV_BELAY_LOG=1 claude` with the hook installed.
2. `asciinema rec demo.cast` in the pane you want captured, then ask Claude for a change
   whose tests you know fail. The block, the fix, and the second "Done" are the clip.
3. No key, or a repeatable take: `node belay.mjs --replay demo/sample-decisions.jsonl`
   renders five canned decisions at about 400 ms each.
4. `agg --theme kanagawa --font-size 16 --idle-time-limit 2 --fps 15 demo.cast demo.gif`,
   then `gifsicle -O3 demo.gif -o demo-small.gif`. Keep it under 3 MB for GitHub.
5. For X, screen-record the pane instead and export MP4: GIFs get re-encoded anyway.
