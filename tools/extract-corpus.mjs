#!/usr/bin/env node
// Build the local corpus from this machine's Claude Code transcripts.
//
// What lands on disk is a projection, not a slice: the four fields the questions read,
// plus the code-derived evidence. Tool inputs, diffs, file contents, and paths never get
// written. $HOME becomes ~, secret-shaped strings become <redacted>, and a turn whose
// text carries the opt-out marker is dropped.
//
// Usage: node tools/extract-corpus.mjs --out corpus [--limit 50] [--gate] [--from <dir>]

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DONE_HINT, buildState, freshChecks, isEntryPoint, needsDoneCheck, parseJsonl, turnsOf } from "../belay.mjs";

const OPT_OUT = "jev-belay:no-corpus";

export function transcriptFiles(root) {
  const files = [];
  for (const dir of readdirSync(root)) {
    let full;
    try {
      full = join(root, dir);
      if (!statSync(full).isDirectory()) continue;
    } catch { continue; }
    for (const name of readdirSync(full)) if (name.endsWith(".jsonl")) files.push(join(full, name));
  }
  return files.sort();
}

/** One stop per turn: the projection of the fields the questions read, nothing else. */
export function projectFile(path) {
  const records = parseJsonl(readFileSync(path, "utf8"));
  const source = createHash("sha256").update(path).digest("hex").slice(0, 12);
  const out = [];
  for (const [index, turn] of turnsOf(records).entries()) {
    if (!turn.finalMessage) continue; // the turn never ended with an assistant message
    if (turn.task.includes(OPT_OUT) || turn.finalMessage.includes(OPT_OUT)) continue;
    const state = buildState(turn.task, turn.finalMessage, turn);
    out.push({
      id: `${source}:${index}`,
      task: state.task,
      final_message: state.final_message,
      mutations: turn.mutations,
      checks: freshChecks(turn),
      all_checks: turn.checks.length,
      doneish: DONE_HINT.test(turn.finalMessage.slice(-600)),
      needs_done_check: needsDoneCheck(turn),
    });
  }
  return out;
}

function main(argv) {
  const flag = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const outDir = flag("--out", "corpus");
  const limit = Number(flag("--limit", "0")) || Infinity;
  const root = flag("--from", join(homedir(), ".claude", "projects"));
  const files = transcriptFiles(root).slice(0, limit === Infinity ? undefined : limit);

  const records = [];
  for (const file of files) {
    try { records.push(...projectFile(file)); } catch { /* a transcript we cannot parse is not a corpus problem */ }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "records.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const withMutations = records.filter((r) => r.mutations > 0).length;
  const pct = (n) => (records.length ? ((n / records.length) * 100).toFixed(1) : "0.0");
  console.log(`${records.length} stops from ${files.length} transcripts, ${withMutations} with mutations > 0 (${pct(withMutations)}%)`);
  if (argv.includes("--gate")) {
    const gated = records.filter((r) => r.needs_done_check).length;
    console.log(`base rate: ${gated} stops reach the gate (${pct(gated)}% of stops, ${withMutations ? ((gated / withMutations) * 100).toFixed(1) : "0.0"}% of stops with changes)`);
  }
}

if (isEntryPoint(import.meta.url)) main(process.argv.slice(2));
