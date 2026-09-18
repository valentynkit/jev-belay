# Feasibility grounding

Source: web research 2026-09-18. Verdicts: GREEN build as described, YELLOW build with the stated change, RED blocked.

## Access without the waitlist

Vercel AI Gateway lists `typesafe-ai/jev` since 2026-09-16 at $0.04/MTok input, output free, usable with a Vercel API key. https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway

## A. jev-skip: GREEN

- Caption track: content scripts read the caption `baseUrl` from the page's player response / Innertube `youtubei/v1/player`, then fetch it from the same tab. The timedtext URL is session-signed (`ei`, `expire`, `sig`) and returns an empty 200 from any other context (background script, external request). Sources: grokipedia.com/page/YouTube_timedtext_endpoint, nadimtuhin.com/blog/ytranscript-how-it-works
- Still viable in 2026: anti-adblock enforcement targets ad-blocking network interception, not passive caption reads.
- SponsorBlock exposes a public "get segments" endpoint returning `{start, end, category, uuid}` per video: wiki.sponsor.ajay.app/w/API_Docs. Use it for a measured accuracy number.
- Tokens: speech runs ~150-220 tokens/min, so a 20-minute transcript is ~3-4.5k tokens. 40 choice questions fit well under 32k. Chunk calls for 60+ minute videos.

## B. jev.nvim: YELLOW

- No universal treesitter "function" query. Use nvim-treesitter-textobjects per-language `@function.outer` captures. The plugin's `main` branch targets Neovim 0.12+, pin accordingly.
- HTTP: `vim.system()` wrapping curl is the zero-dependency idiom in 0.10+; plenary.curl is an extra dependency.
- Quickfix: `setqflist()` entries take a free `text` field; pre-sort by probability before calling. Telescope needs a custom `entry_maker`/displayer for a probability column.
- No existing semantic-grep nvim plugin with noul-per-function; VectorCode and CopilotChat.nvim do not overlap.

## C. Claude Code Stop hook: GREEN

- Stop hook stdin fields: `session_id, prompt_id, transcript_path, cwd, permission_mode, hook_event_name, last_assistant_message, stop_hook_active`. Exit 2 blocks the stop; Claude sees stderr, but a JSON `reason` on stdout (`hookSpecificOutput.reason`) takes precedence.
- `stop_hook_active` is the loop guard. If true, exit 0, or the hook blocks forever (github.com/anthropics/claude-code/issues/55754).
- Plugin packaging: `.claude-plugin/plugin.json` + `hooks/hooks.json`. No marketplace entry required; installable from a local path, or wire the hook directly in `.claude/settings.json`. code.claude.com/docs/en/hooks, code.claude.com/docs/en/plugin-marketplaces

## D. obsidian-jev: GREEN (deprioritized)

- Folders: recurse `Vault` `TFolder` children. Tags: aggregate `metadataCache` per file (same workaround as Tag Wrangler). Move: `FileManager.renameFile` updates backlinks.
- Review requires `requestUrl` not `fetch`, flags `innerHTML`. BYOK is accepted; four AI taggers already live in the store.

## E. jev-plays-pokemon: YELLOW

- RAM: Data Crystal map plus pret/pokered `.sym` files. Map id 0xD35E, x/y 0xD361/0xD362, party HP/status 0xD16B+, battle status 0xD062-64, badges 0xD356. PokemonRedExperiments re-verified many. Some fields (`wBattleResult`) sit in a WRAM union; verify by hand.
- PyBoy 2.2.0's Pokemon wrapper only exposes `game_area`, `game_area_collision`, `start_game`, `reset_game`. Read `pyboy.memory[addr]` directly against a symbol table, as pokemon-agent and pcc-labs/pokemon do.
- Legal: never commit the ROM. Save states embed copyrighted memory snapshots; keep them gitignored and user-generated. Disassembly symbol tables are fine.

## F. jev-alert-gate: GREEN (deprioritized)

- Alertmanager webhook JSON is fixed: `{receiver, status, alerts:[{status, labels, annotations, startsAt, endsAt, generatorURL, fingerprint}], groupLabels, commonLabels}`. PagerDuty Events API v2 enqueue takes `severity` directly. Prior art (Keep, Aurora) does general triage; nobody enforces escalate-only.

## G. Raycast: YELLOW (cut)

- `onSearchTextChange` fires per keystroke but Raycast's idiom is to debounce (150-250ms). BYOK AI extensions are accepted in the store.
