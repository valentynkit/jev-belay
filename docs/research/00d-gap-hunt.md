# Gap hunt: niche saturation, 2026-09-18

Source: core.tsv, hellogumbo list (614 links), live `gh search`.

| Niche | Count | Top entry (stars) | Verdict |
|---|---|---|---|
| YouTube sponsor skip | 0 | none | EMPTY |
| Neovim/Vim plugin | 0 | none | EMPTY |
| VS Code extension | 0 | none | EMPTY |
| Obsidian plugin | 0 in GitHub data (4 AI taggers in the Obsidian store, none broke out) | none | EMPTY on GitHub, crowded in store |
| Raycast/Alfred | 0 | none | EMPTY |
| Pokemon | 3: `ybelatar/pokemon_jev` (0 commits), `milanboers/jev-plays-pokemon` (0 stars, no license, Red on emulator), `anxkhn/JevPlaysPokemon` (1 star, GPL, Gen 3 battles via Showdown, not the overworld) | 1 | THIN, weak incumbents; differentiate on speed, a reusable RAM-to-state harness, and a live probability overlay. Other games saturated: Mario, Snake, StarCraft, Civ II, Doom, Minecraft, Chess, Tetris, Pac-Man, 2048, Pong, T-Rex, Gomoku, Rubik's, Wikiracing |
| Claude Code Stop hook | 1 | noplan-inc/limpet (1) | THIN, well built, unnoticed |
| Claude Code context pruning | 5+ | fast-jev-compaction (2794) | SATURATED, one leader |
| Claude Code permission gating | many, mostly Pi-scoped | pi-warden (61, Pi only); leepokai/jev-guard (2) spreads across 8 agents | THIN for Claude-Code-native depth |
| Model routing | 12+ | jev-router (121) | SATURATED |
| PR/code review | 8+ | jev-review (251) | SATURATED |
| MCP servers | 15+ | typesafe-mcp (62) | SATURATED |
| Pi extensions | 15+ | pi-jev (65) | SATURATED |
| Alerting / PagerDuty | 0 dedicated | typesafe-triage-guard (3) has a fragment | EMPTY |
| git pre-commit / commit-msg hook | 0 as a hook | commit-miner (21, post-hoc classifier), semdecide (5) | EMPTY |
| Slack/Discord/Telegram moderation | Discord 1 (Jev-Moderation-Bot, 25); Slack, Telegram 0 | 25 | Discord THIN, others EMPTY |
| RSS/HN/Reddit filtering | 0 | none | EMPTY (dmx.to covers X only) |
| Email triage | 1 (GiesN, 4, LangGraph glue) | 4 | THIN |
| Browser hide-by-meaning | 8+ | unclutter (74) | CONTESTED |
| Postgres | pg-jev (143) | | SATURATED, good |
| DuckDB | 2 scaffolds (2 and 0 stars) | | WEAK INCUMBENT |
| Shell history | 1, mrnugget/jev-shell-history (33, 1 commit, no offline fallback, zsh only) | 33 | WEAK INCUMBENT |
| tmux/fish | 0 | | EMPTY |
| Home Assistant | HA-Jev (7, real HACS) | 7 | THIN |
| Anki, calendar, screenshot routing | 0 | | EMPTY |
| Open replicas | 12+ | jevlike (851) | SATURATED |
| Benchmarks | 10+ | | SATURATED |

## Chosen five and their niche state

1. jev-plays-pokemon: EMPTY.
2. jev.nvim: EMPTY.
3. jev-skip: EMPTY.
4. Claude Code warden (Stop hook + escalate-only gate + loop detection): THIN; port pi-warden's depth natively.
5. git pre-commit judge: EMPTY.

## Unclaimed demos (tweet only)

Hide-posts-by-meaning on X; news-framing extension; TikTok/IG hook A/B tester; Crowdcheck personas; voice turn-end gate; StarCraft Brood War via WASM MCP; Grammarly-style Mac app; Kalshi trader; tabletop free-text-to-action mapper; support-ticket classifier.
