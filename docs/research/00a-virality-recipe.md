# Virality recipe: what the top Jev repos share

Source: analysis of 205 consensus repos (core.tsv), 173 tweets/articles, READMEs of the top 25 fetched live, 2026-09-18.

## Top 25 by stars (hook, number, visual, author, audience)

| # | Repo | Stars | Hook | Big number | Visual | Author | Audience |
|---|---|---|---|---|---|---|---|
| 1 | vercel/eve | 5252 | "filesystem is the interface" agent framework | none | logo only | Vercel (brand) | web devs, Jev tangential |
| 2 | browser-use/jev-ultrafast | 4910 | "i. am. speed." | Zurich to London flight search in 7.1s | demo gif + mp4, side-by-side timing | browser-use (funded co.) | browser-agent crowd |
| 3 | tamaratran/fast-jev-compaction | 2794 | "never rewrites, only deletes what Jev says is stale" | none stated | none | indie | Claude Code power users |
| 4 | TheoLeeCJ/SemIf | 1504 | "No waitlist. Runs in your browser today" (anti-vendor jab) | 21 questions, one 4B model | gif: typed decisions vs JSON token-stream race | indie researcher | ML/OSS crowd |
| 5 | vinnylarouge/jevlike | 851 | train your own Jev-like model | 4W/46D/0L chess; -97.5 reward Doom | 10s video | indie | ML researchers, gamers |
| 6 | jarrodwatts/jev-trader | 804 | "one decision every Monad block" | ~300ms cadence, real limit orders | live dashboard | known dev-rel | crypto |
| 7 | vercel-labs/ai-cli | 796 | "AI SDK in your terminal" | none | none | Vercel Labs | general devs |
| 8 | TianyuCodings/NanoJev | 313 | "nano replica, zero output-token decoding" | 0.6B params | 3-way side-by-side maze video | indie researcher | ML researchers |
| 9 | thruwire/foreman | 280 | "software factory foreman" | none | ASCII diagram | indie | agent-harness devs |
| 10 | fhshaik/typesafe-mario | 260 | "plays Mario, no screenshots" | none | gameplay footage | indie | gamers, ML |
| 11 | devagrawal09/jev-review | 251 | staged review, local dashboard | none | dashboard screenshot | indie | Claude Code users |
| 13 | awlevin/typesafe-computer-use | 203 | "$0.0002 a step" | 155x cheaper than Opus 5, ~20x faster | banner svg | known AI eng | computer-use |
| 15 | dabit3/jev-experiments | 156 | latency demos "built by Devin" | none | screenshots | Nader Dabit (huge following) | broad |
| 16 | realZachi/pg-jev | 143 | "ask your Postgres tables questions in plain language" | none | header svg, own domain | indie | backend devs |
| 17 | ekzhang/openjev-sglang | 128 | open Jev-compatible endpoint | B200/SGLang | gif | known infra dev | ML infra |
| 18 | gargpratyush/jev-router | 121 | "cheapest model in Claude Code" | none | comparison table | indie | Claude Code |
| 22 | droidrun/mobile-jev | 104 | mobile agent | ~21s / 9 actions, Uber booking | gif + mp4, live phone | droidrun | mobile agents |

## The recipe (falsifiable)

- 22/25 top repos lead with a concrete artifact (gif, video, dashboard, live demo) or a name-brand author. Only 3 survive on vendor/author trust alone.
- 11/25 have a quantified claim in the opening lines (7.1s, $0.0002/step, 155x/20x, 21s/9 actions). A number alone is not enough: bitnovus/jev-spam-eval has the best number in the dataset (98.64% zero-shot spam accuracy on 5,733 emails) and 0 stars, no visual.
- Known author or brand appears in 11/25 top vs about 1 in 2 of the bottom 180.
- First mover wins the category: every saturated niche (browser use, PR review, context compaction) has a >10x star gap between rank 1 and rank 2-3 with near-identical pitches. Never enter second with the same pitch.
- Adversarial or independent framing beats neutral: SemIf's "No waitlist" jab out-starred everything except two mega-brands.
- Game and toy demos appear 16 times with median 1 star. Genre does not sell; only NanoJev (a real model release with a benchmarked video) broke out. A game project needs a reusable technical contribution.
- Nostalgia or meme framing substitutes for a number when there is none (Cars quote, Mario, Doom).

## Saturated categories

| Category | Count | Median stars | Top | Top-25 entrants |
|---|---|---|---|---|
| Model routers | 20 | 2.5 | 121 | 1 |
| PR/code reviewers | 8 | 3 | 251 | 2 (first two movers) |
| MCP servers | 11 | 4 | 70 | 0 |
| Pi extensions | 9 | 6 | 65 | 0 |
| Replicas/clones | 12 | 3 | 313 | 1 |

Claude Code / dev-tool integrations are the largest bucket (56 of 205) with median 6 stars. Only a first mover with a visual or a number breaks out there.

## Demo tweets with no repo (unclaimed, attention proven)

Only 2 of ~30 viral demo tweets map to a tracked repo (browser-use flight search, awlevin computer use). Unclaimed: DuckDB row classifier (10s/1000 rows), "jev-rabbit" plain-English PR review rules, support-ticket triage, X post-hiding by meaning, news-framing extension, hook-panel A/B tester vs 100 personas, agent safety monitor, gomoku harness, Stagehand integration, StarCraft Brood War via WASM MCP, Kalshi trading bot, tabletop action mapper, wiki-link clicker, ViZDoom agent, Convex "ask anything" demo, Mac-app integrations.

## Strong idea, weak execution (beatable incumbents)

- AboveColin/HA-Jev (15 lists, 6 stars): "ask your house a question", README is badges only, no demo, no cost number.
- GhalebDweikat/winnow (14 lists, 11 stars): same pitch as fast-jev-compaction (2794) but zero before/after numbers.
- shiftynick/jev-axi (12 lists, 11 stars): badges, no example call, no number.
- bitnovus/jev-spam-eval (10 lists, 0 stars): best accuracy number in the dataset, no interactive artifact.
- Ying-Kai-Liao/jev-browser (10 lists, 9 stars): third entrant on the browser-use pitch, no gif.
- jexp/neo4jev (12 lists, 17 stars): novel graph-traversal wedge, no gif, no latency figure.
- reachjalil/jevlogs (10 lists, 7 stars): banner but no dropped/retained metric.

## Audience skew

Over-served: Claude Code tooling (routers, reviewers, MCP, compaction) and toy game demos. Under-served: crypto/trading (3 repos, one at 804), consumer and writing tools (ship as closed web apps, not repos), enterprise classification (viral demos, zero repos).
