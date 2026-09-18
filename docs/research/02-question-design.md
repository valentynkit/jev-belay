# Jev question design: distilled rules and five drafts

Sources: docs.typesafe.ai (concepts, primitives, patterns, cookbooks, jev-1.13 jaggedness doc), github.com/typesafe-ai/skills, github.com/dbreunig/building-with-jev-skill, github.com/24601/Augustus.

## 1. Writing instructions and options

- Write the full question in `instructions`. IDs are for your code only, never sent to the model (primitives.md).
- One judgment per question. "Rate from 0 to 2" and "analyze and decide" both fail by hiding more than one decision (dbreunig SKILL.md). Split multi-dimension judgments ("punctual and smart and experienced") into separate Score/Noul questions (primitives/score.md).
- Describe situations, not degrees. Score levels need concrete, matchable descriptions ("broken or degraded feature, workaround exists"), not adjectives like "moderately severe" — the model never sees level numbers or neighbors (primitives/score.md).
- Choice options: describe criteria, not just labels. Plain strings are fine until two options risk confusion; then use `{what, not_for, examples}` per option (primitives/choice.md).
- Always include an escape hatch: an `other`/`none of the above` Choice option, or explicit `true`/`false` criteria on a Noul. The model cannot select an omitted value (primitives/choice.md, typesafe-ai SKILL.md).
- Noul wording: phrase as a question or a statement, test both against real data. Define ambiguous terms ("strong in Python" means nothing undefined) — 0.5 means unsure, not "medium" (primitives/noul.md).
- State exact conditions. Jev answers "the question you wrote, not the one you meant" — no inferred intent, no double negatives (jev-1.13.md).
- State carries content and facts; questions carry the judgment. Reference nested state by name (`ticket.messages[0].text`) instead of re-describing it (concepts/state.md, typesafe-ai SKILL.md).

## 2. State packaging

- Use a JSON object for anything with more than one part, so each field has a name and relationships stay visible. Plain strings for a single passage; arrays for sequences (concepts/state.md).
- Send only what the question needs. "Unrelated detail acts as a distractor" — filter in code before the call (jev-1.13.md, dbreunig SKILL.md).
- Text and JSON only, no images/audio/video (concepts/state.md).
- Put the "goal" (query, task, objective) in state as its own field alongside the item judged, e.g. `{query, function}` or `{user_request, candidate_reply}` — every ranking/filtering cookbook does this (semantic_find.md, skill_suggestion.md, function_calling.md).
- Hard limit: state plus the single longest question must fit in 32k tokens, against a 64k total budget shared across state and all questions in the request (dbreunig SKILL.md; not restated on docs.typesafe.ai itself). Trim large trees to direct children plus a leaf sample, not the full subtree (primitives/advanced.md).
- Arithmetic, counting, dates, near-equal comparisons: do it in code. Jev "does not count reliably" and reads dates as text, not ordered quantities (jev-1.13.md).

## 3. Fan-out economics

- Send many questions — including speculative ones — in one call; code decides what's relevant after. Parallel questions add no meaningful latency (patterns/fan-out.md).
- Cost scales with content transmitted, not question count: parallel_questions.md ran 13 questions (8 Noul, 2 Choice, 3 Score) over one 54k-char shared document in one call, getting a 12.2x cost cut and 10x speedup vs. 13 separate calls, since the document ships once. Formula: `cost(batched) ≈ tokens(state) + Σ tokens(question_i)`, vs. `N × (tokens(state) + tokens(question))` for N solo calls.
- Split into a second request only when an earlier answer determines what state or options to build next (typesafe-ai SKILL.md, primitives/advanced.md). Otherwise, one call.
- Past 255 options (Choice's hard cap) or the 32k/64k budget: two-pass windowing, one Choice narrows to a window, a second ranks inside it (semantic_find.md); or loop in code building one question per record, all still in one request (primitives/advanced.md).

## 4. Confidence

- Probability is the full distribution; confidence is a single 0-1 number from its shape — concentrated means confident, flat means not (confidence.md). "The answer tells you what; confidence tells you whether to act" (patterns/confidence-routing.md).
- Three-band pattern: high confidence acts autonomously, medium confirms/reviews, low falls back to human. Thresholds are domain-specific; worked examples cluster around a 0.5-0.6 floor for any action and 0.85-0.9 for high-stakes ones (confidence.md, patterns/confidence-routing.md, dbreunig SKILL.md).
- One global threshold undersells nuance: classification_using_confidence.md shows a 0.9 cutoff splits a task into a confident half right 90% of the time and an unsure half right 40% — instead of discarding the unsure half, it falls back to a coarser but still-correct parent label, lifting that half to 70%.
- Self-consistency: consistency_noul_cookbook.md runs the same 14-question rubric over one input 15 times, each with a fresh irrelevant `uid` to force independent draws, then measures standard deviation across repeats (0.0102 in that run) instead of trusting one sample. Near a boundary, use a dead band (0.30-0.70 → "uncertain," route to review) instead of a single cutoff.
- Confidence on a composite answer (function_calling.md) is the minimum across sub-judgments, not their product — one wrong argument spoils the call.

## 5. Five tools

### Neovim semantic grep
One Noul per candidate function, batched per file/module in a single call (primitives/advanced.md's "one question per record" loop), never per-repo in one shot.
- `match` (noul): `Does this function implement or is it directly responsible for: "{query}"?` Criteria — true: "name, signature, or body directly performs {query}"; false: "unrelated, or only shares surface keywords with {query}." Plain "does this match" invites the literal-interpretation trap.
- State: `{query, function: {name, signature, docstring, body_excerpt, file_path}}` — trim body, strip imports.
- Risks: (1) vague match criteria → literal misread; fixed by the true/false criteria above. (2) large repos blow the token budget; mitigate with a regex/ctags pre-filter (regex belt) before invoking Jev, then chunk remaining candidates. (3) long bodies act as distractors; send signature + docstring + short excerpt only (code-owned trimming).

### YouTube sponsor-segment skipper
One Choice per 30s segment: `content, sponsor, intro, outro, self_promo, recap, other`. Keep `other` even though the taxonomy looks exhaustive — misclassifying a novel segment as `content` (fail open) beats forcing a wrong specific label.
- Instructions: `Which category best describes this transcript segment, given it's from {video_title} by {channel}?` Use structured `{what, not_for, examples}` descriptions for the confusable pair `sponsor`/`self_promo`.
- State: `{video_title, channel, segment_text, prev_segment_tail, next_segment_head}` — a sliver of neighbors for context, not the whole transcript.
- Risks: (1) 30s boundaries cut mid-sentence; snap to sentence breaks in code first (regex belt). (2) sponsor/self-promo is genuinely fuzzy; use the structured criteria and fail low-confidence toward `content` (don't skip). (3) fan-out is naturally fine — a 30-min video is ~60 short segments, batch the whole video in one call (parallel_questions pattern).

### Claude Code Stop hook
Four Nouls, one call: `claimed_done_without_verification`, `narrowed_scope`, `left_todo`, `asked_instead_of_finishing`.
- Each needs a concrete true/false signal, e.g. `claimed_done_without_verification` — true: "asserts completion without describing a test run, build, or output check"; false: "describes a concrete verification step, or makes no completion claim."
- State: `{user_request, last_assistant_message}` — strip raw tool logs, keep only a code-generated one-line verification summary (e.g. "ran: npm test, exit 0").
- Risks: (1) "verification"/"scope" are vague unless spelled out as above. (2) full transcripts are large and mostly irrelevant; strip to final message + summary (code-owned extraction). (3) `narrowed_scope` risks a double-negative framing; state it directly as "described changes cover less than the request" per the anti-indirection rule in jev-1.13.md.

### Git pre-commit judge
Four Nouls over `{diff, message}`: `message_matches_diff`, `debug_leftovers`, `scope_creep`, `secret_shaped_strings`.
- `secret_shaped_strings` shouldn't really be a Jev question: exact-pattern/entropy matching is arithmetic-adjacent, and Jev "does not count reliably." Run a regex/entropy scan in code first (regex belt), use the Noul only as a soft secondary check ("looks like a live credential, not a placeholder").
- `debug_leftovers` is also mostly regex-detectable; reserve the Noul for cases the regex misses.
- State: diff truncated to changed hunks plus a couple context lines, not full files — chunk by file if large (32k budget, and unchanged code is distractor state).
- Risks: (1) using Jev as the primary secret scanner — fixed with code-owned regex first. (2) oversized diffs — chunk per file, hunk-only context. (3) `scope_creep` needs a crisp definition ("touches files/paths not implied by the message or linked issue") or it collapses into an ungroundable "feels too big."

### Pokémon Red agent
One Choice over the legal action set (single-digit menu/move options, well under the 255 cap), described by intent not button label — function_calling.md's rule to write questions "about the idea rather than the words" is what let its example route "is amd tracking nvidia lately" to `rolling_correlation` with no keyword overlap.
- Instructions: `Given the current battle/map state and the player's goal, which action should be taken next?` Options as named actions with short descriptions (`use_move_x: "attack with {move_name}, a {type} move"`), not raw button codes.
- State: `{goal, party: [...trimmed fields], battle_or_map_context, immediate_options}` — the current objective (`goal`) sits alongside the RAM facts as its own field, per the state.md pattern of naming judgment target and goal separately.
- Risks: (1) HP-threshold, damage, and type-multiplier math must be pre-computed in code and handed over as a labeled fact ("this move is super effective") — never left for the model to derive. (2) full RAM dumps carry irrelevant state (inventory, distant map flags); strip to what the current decision needs (code-owned filtering). (3) multi-turn planning is the multi-hop reasoning Jev is bad at; scope every question to the current turn only, chain calls turn-by-turn in code instead of asking it to plan ahead.
