# Quality bar and launch: five Jev tools in two weeks

## 1. README skeleton

Read the five reference repos directly. Common shape, in order:

1. **Title + tagline with a number.** `typesafe-computer-use`: "for about a fiftieth of a cent per step." `mobile-jev`: "~21 seconds across 9 actions." Number in the first sentence, not a badge.
2. **One paste-and-run command**, right under the tagline: `clicker "go to techcrunch..." --act`.
3. **GIF or asciicast right after the command**, before any prose. `mobile-jev` and `SemIf` put the demo above the fold; `typesafe-computer-use` uses a comparison table in the same slot instead.
4. **Why / the pitch**, framed against the expensive default (a frontier vision model doing the same job). The honest limit shows up here too, not just at the end: `typesafe-computer-use` puts "the big model read the event dates off the pixels unaided, the classifier needed date parsing" right inside Why.
5. **Cost / speed table**, when there's a comparison. `typesafe-computer-use` runs tokens, cost/decision, cost/task, latency against Claude Opus. `SemIf` states multipliers only ("5.21x faster"), no dollars, since it's local/free.
6. **Install**: uv/pnpm/npm one-liner plus `.env.example` copy. Every repo names its required key (`TYPESAFE_API_KEY`) and marks optional keys as optional.
7. **Bring-your-own-key**: a table row (required/optional, purpose), never prose. `mobile-jev` adds a security line: "API keys stay server-side; browser receives device-scoped credentials only."
8. **How it works**: diagram or numbered pipeline.
9. **Known limits**, own heading near the end, flat fact not apology. `typesafe-computer-use`: "OCR only sees text... an icon-only button reaches neither source." `fast-jev-compaction` lists four numbered constraints.
10. **Development** (test/lint) then **License** (MIT, one line).

**Reusable skeleton** (variable slots in brackets):

```
# [name]

[one-line pitch with a measured number]

    [one paste-and-run command]

[GIF or asciicast, or a cost/speed table if there's nothing visual to show]

## Why
[2-4 paragraphs against the expensive default; fold in one honest limit here, not just at the end]

## [Cost / Speed table, if applicable]

## Install
[git clone / package manager one-liner]
cp .env.example .env
| variable | required | purpose |

## Use
[2-4 example invocations]

## How it works
[diagram or numbered pipeline]

## Known limits
[flat bullet list, no hedging]

## Development
[test/lint commands]

## License
[MIT, one line]
```

Per project: the Neovim plugin needs a "Requirements" line between Install and Use; the extension needs a "Privacy / permissions" subsection where the security note lives; the git hook uses the `.pre-commit-config.yaml` snippet as its "one command"; the Pokemon agent needs a "Watch it live" stream link where the GIF slot is.

## 2. Recording the demo

**Terminal (vhs).** Homebrew install (needs ttyd + ffmpeg on PATH). Tape file:

```
Output demo.gif
Set FontSize 20
Set Width 1200
Set Height 600
Set TypingSpeed 40ms
Type "your-cli command here"
Enter
Sleep 3s
```

Run `vhs demo.tape`. [charmbracelet/vhs](https://github.com/charmbracelet/vhs), example tape at [examples/demo.tape](https://github.com/charmbracelet/vhs/blob/main/examples/demo.tape).

**Terminal (asciinema + agg)**, for a real recorded session rather than scripted: `asciinema rec demo.cast`, then `agg --theme kanagawa --font-size 16 --idle-time-limit 2 --fps 15 demo.cast demo.gif`, pipe through `gifsicle -O3` for size. [asciinema/agg](https://github.com/asciinema/agg), [manual](https://docs.asciinema.org/manual/agg/).

**Neovim screencasts**: same vhs/asciinema path; script the `nvim` invocation inside the tape/cast, use `Hide`/`Show` to skip past the LazyVim startup screen so the GIF opens on content.

**Browser extension on macOS.** Record with QuickTime (crop to a window, not the full 5120x1440 display), save as `.mov`, convert with ffmpeg two-pass palette:

```
ffmpeg -i recording.mov -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=none" -loop 0 output.gif
```

800px width, 15fps, no dithering (it scatters noise on flat UI colors, softens text). [FFmpeg palette guide](https://www.ffmpeg-micro.com/blog/how-to-turn-a-screen-recording-into-a-gif-for-your-readme). Alternative: [Gifski](https://github.com/sindresorhus/Gifski), drag the recording onto it for frame-by-frame palette optimization instead of one global palette.

**Emulator overlay (PyBoy agent).** Same ffmpeg pipeline, cropped tight to the game window (crop alone cuts file size ~75% before any compression). For a live element, link the Twitch stream instead of GIFing a long agent run.

**Size targets.** GitHub: no hard block, but keep under 5MB, ideally 1-3MB; repo warns at 50MB, limits at 100MB. Drag a GIF into an issue comment without submitting to get a CDN-hosted URL that stays out of clone history. [GitHub GIF size discussion](https://dev.to/voyz/adding-large-external-gifs-to-github-readme-md-over-10mb-limit-49k2). X: GIFs cap at 15MB desktop / 5MB mobile, ~1280x1080 max; X re-encodes GIFs to muted MP4 anyway, so for real video use MP4/MOV, H.264+AAC, 1080p max free tier, under 512MB, up to 140s. [X media specs](https://www.heyorca.com/blog/x-twitter-media-specs-best-practices-2026).

## 3. Measurement script convention

One command per repo, matching its package manager: `npm run measure` (extension, Claude Code hook), `make measure` (git hook, plain shell/Python, no JS toolchain), `uv run measure` (Pokemon agent), a `nvim --headless -c` script for the Neovim plugin.

**Convention**: runs against a small in-repo fixture (no live API calls by default), prints one headline line to stdout in a fixed format, exits 0/1 if there's a threshold to gate on. Model on `typesafe-computer-use`'s own pattern: a human-readable summary line plus a machine-readable JSON next to it for CI diffing.

Output format: `<headline number> <unit> (n=<sample size>, <method note>)`, e.g. `7.09s median Google Flights run (n=20, vs 9.45s baseline)` or `$0.0002/decision (n=500 fixture calls)`.

**Corpus in-repo**: commit the fixture (screenshots, a save state, a short transcript) under `fixtures/`, MIT-licensed with the code — except copyrighted ROM bytes; use save-state deltas or a user-supplied-ROM path instead. Cap fixture size like the GIFs, low single-digit MB, so CI clone stays fast.

## 4. Distribution checklist per channel

**r/neovim / r/ClaudeAI.** Could not fetch the live subreddit rules pages (Reddit blocks fetch from this environment). Treat this as general Reddit norm, not verbatim wiki text: build genuine non-promotional activity first, keep self-promo under roughly 10% of your posting history, check for a dedicated showcase thread before a standalone link. [Reddit self-promotion overview](https://redship.io/blog/reddit-self-promotion-rules). Verify exact wording at `reddit.com/r/neovim/about/rules` and `reddit.com/r/ClaudeAI/about/rules` before posting.

**This Week in Neovim.** Hosted via Dotfyle; submit through Dotfyle's submission form (linked in every issue) to enter the index the curator pulls from. [Dotfyle](https://dotfyle.com/this-week-in-neovim).

**Claude Code plugin marketplace.** One file, `.claude-plugin/marketplace.json`, at repo root: `name`, `owner`, a `plugins` array with each plugin's `source`. Install path: `/plugin marketplace add <repo>` then `/plugin install <plugin>@<marketplace-name>`. [Docs](https://code.claude.com/docs/en/plugin-marketplaces), [schema](https://json.schemastore.org/claude-code-marketplace.json).

**Show HN.** Title must start "Show HN:", personally built, try-able with no signup wall, no vote brigading, be present in the thread. Best window: weekday mornings Pacific, roughly 7-10am PT; avoid weekends and late nights. [HN discussion](https://news.ycombinator.com/item?id=44625897).

**pre-commit.com hooks.html.** Explicit gate, quoted: "the tool must already be fairly popular (>500 stars)," "must use a managed language," "must operate on files." Submit via PR to [pre-commit/pre-commit.com](https://github.com/pre-commit/pre-commit.com/blob/main/sections/hooks.md). Under 500 stars, the hook still works via a plain `.pre-commit-hooks.yaml` and users pointing at the repo URL; the listing is a later milestone, not a launch blocker.

**Firefox AMO.** Listed (public directory, full review) or unlisted/self-distribution (signed, not listed, still spot-reviewed). Up to 24h to sign, longer if flagged manual. For unpacked-first, self-distribute the signed .xpi from a GitHub release, submit listed once stable. [Self-distribution docs](https://extensionworkshop.com/documentation/publish/self-distribution/).

**Chrome Web Store.** Two review tracks: narrow-permission extensions clear automated review in under an hour; manual review can run up to three weeks. Developer mode/unpacked is dev-only (persistent warning bar), never the end-user install path. [2026 review-time update](https://developer.chrome.com/blog/cws-review-updates-2026). Submit day one given the latency; sideload as interim README instructions until it clears.

**Twitch (Pokemon agent stream).** Use the dedicated "Twitch Plays" category for autonomous/audience-driven play, not plain "Pokemon Red." Content labels apply automatically off ESRB/IGDB rating; Pokemon Red is unrated there, so you're responsible for correct labeling. [Twitch Plays category](https://blog.twitch.tv/en/2016/01/13/announcing-the-twitch-plays-game-category-55149935ad79/), [Content Classification Guidelines](https://safety.twitch.tv/s/article/Content-Classification-Guidelines).

**Anthropic Discord and showcase form.** Public Claude Discord exists ([discord.com/invite/anthropic](https://discord.com/invite/anthropic)) with project-sharing channels; could not confirm a channel literally named "Show and Tell," verify inside the server. Confirmed showcase intake: a Typeform at `form.typeform.com/to/VIUAjxNi`, linked from [claude.com/community](https://claude.com/community).

## 5. Repo hygiene reviewers check

- **License**: MIT for all five code repos, matching what the reference repos use (`awlevin/typesafe-computer-use`, `droidrun/mobile-jev` both plain MIT). Any curated list shipped alongside gets CC0 instead, the convention `sindresorhus/awesome` popularized for non-code content. [CC0 for awesome-lists](https://github.com/sindresorhus/awesome/issues/1598), [choosealicense](https://choosealicense.com/non-software/).
- **`.env.example`**: every reference repo ships one, required/optional column per var, matching the README table.
- **No key, no network by default**: dry-run as the default invocation (`typesafe-computer-use`'s bare `clicker "goal"` without `--act` prints the plan, touches nothing); CI and tests must not require a live key.
- **CI runs against a fixture, not the network**: `mobile-jev`'s README states this outright ("CI runs offline without API keys"). Reuse the section-3 measurement fixture as the CI fixture too, one corpus not two.
- **Semantic versioning + first tag**: start at `v0.1.0`, not `v1.0.0` — under SemVer, 0.y.z means "anything may still change." [SemVer spec](https://semver.org/). Tag it once the README's one-command demo works end to end.
- **CHANGELOG.md**: Keep a Changelog format, `Unreleased` always at top, `YYYY-MM-DD` dates, first entry `## [0.1.0] - <date>` under `### Added`. [keepachangelog.com](https://keepachangelog.com/en/1.0.0/).
- **API keys in the browser extension**: MV3 bundles are fully client-side and reverse-engineerable, so never hardcode the key. Proxy through a backend you control with a scoped, revocable token, or take a bring-your-own-key field the user pastes into extension storage, never compiled into the bundle. State it as a one-line "Security" note under Privacy/permissions. [Chrome extension security guidance](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security).
