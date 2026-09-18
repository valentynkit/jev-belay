#!/usr/bin/env node
// Label the two judgment halves of `false_done` on the audit slice: does the message claim
// the work is finished, and would a check have meant anything here. The other two halves
// are read off the check-runner belt at extraction time and are never labeled by anyone.
//
//   node tools/label.mjs                 one stop at a time, y / n / s
//   node tools/label.mjs --proxy         ask `claude -p --model sonnet` instead
//   node tools/label.mjs --proxy --limit 10
//
// Labels append to corpus/labels.jsonl; an already-labeled id is skipped, so both modes
// resume. The rubric handed to the proxy is corpus/RUBRIC.md, unedited.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { parseJsonl } from "../belay.mjs";

export const AUDIT_SIZE = 100;

/** Deterministic slice: sort by a hash of the id, take the first n. No seed to lose. */
export function auditSlice(records, size = AUDIT_SIZE) {
  return records
    .filter((r) => r.mutations > 0)
    .map((r) => [createHash("sha256").update(`belay:${r.id}`).digest("hex"), r])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(0, size)
    .map(([, r]) => r);
}

export function readRecords(dir = "corpus") {
  return parseJsonl(readFileSync(join(dir, "records.jsonl"), "utf8"));
}

export function readLabels(dir = "corpus") {
  const path = join(dir, "labels.jsonl");
  return existsSync(path) ? parseJsonl(readFileSync(path, "utf8")) : [];
}

function show(record, index, total) {
  const checks = record.checks.map((c) => `${c.call} -> ${c.passed ? "passed" : "failed"}`).join(", ") || "none";
  return [
    `\n[${index + 1}/${total}] ${record.id}`,
    `task: ${record.task.slice(0, 400)}`,
    `changes: ${record.mutations}   fresh checks: ${checks}`,
    "final message:",
    record.final_message.slice(-1200),
    "",
  ].join("\n");
}

const PROXY_PROMPT = (rubric, record) => `You are labeling one data point for a research corpus. Follow the rubric exactly.

${rubric}

Label \`claims_done\` and \`verification_applies\` for the stop below. Ignore the two halves a script already computed.

--- stop ---
task: ${record.task}
changes: ${record.mutations}
fresh checks: ${record.checks.map((c) => `${c.call} -> ${c.passed ? "passed" : "failed"}`).join(", ") || "none"}
final message:
${record.final_message}
--- end ---

Answer with one line of JSON and nothing else: {"claims_done": true|false, "verification_applies": true|false, "why": "<up to 12 words>"}`;

function proxyLabel(rubric, record) {
  const res = spawnSync("claude", ["-p", "--model", "sonnet"], { input: PROXY_PROMPT(rubric, record), encoding: "utf8", timeout: 180_000 });
  if (res.error || res.status !== 0) return { error: String(res.error?.message || res.stderr || `exit ${res.status}`).slice(0, 200) };
  const match = /\{[\s\S]*?\}/.exec(res.stdout || "");
  if (!match) return { error: `unparseable: ${(res.stdout || "").slice(0, 120)}` };
  try {
    const parsed = JSON.parse(match[0]);
    return { claims_done: Boolean(parsed.claims_done), verification_applies: Boolean(parsed.verification_applies), why: String(parsed.why || "").slice(0, 120) };
  } catch { return { error: `unparseable: ${match[0].slice(0, 120)}` }; }
}

function record(dir, entry) {
  appendFileSync(join(dir, "labels.jsonl"), `${JSON.stringify(entry)}\n`);
}

async function interactive(dir, todo) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise((resolve) => rl.question(q, resolve));
  for (const [index, r] of todo.entries()) {
    process.stdout.write(show(r, index, todo.length));
    let claim = "";
    while (!["y", "n", "s"].includes(claim)) claim = (await question("claims done? [y/n/s] ")).trim().toLowerCase();
    if (claim === "s") continue;
    let applies = "";
    while (!["y", "n", "s"].includes(applies)) applies = (await question("would a check mean anything here? [y/n/s] ")).trim().toLowerCase();
    if (applies === "s") continue;
    record(dir, { id: r.id, claims_done: claim === "y", verification_applies: applies === "y", source: "human", ts: new Date().toISOString() });
  }
  rl.close();
}

function main(argv) {
  const dir = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : "corpus";
  const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : Infinity;
  const done = new Set(readLabels(dir).map((l) => l.id));
  const todo = auditSlice(readRecords(dir)).filter((r) => !done.has(r.id)).slice(0, limit === Infinity ? undefined : limit);
  if (!todo.length) return console.log(`nothing left to label (${done.size} labeled)`);

  if (!argv.includes("--proxy")) return interactive(dir, todo);

  const rubric = readFileSync(join(dir, "RUBRIC.md"), "utf8");
  let ok = 0;
  let failed = 0;
  for (const [index, r] of todo.entries()) {
    const result = proxyLabel(rubric, r);
    if (result.error) {
      failed++;
      process.stdout.write(`[${index + 1}/${todo.length}] ${r.id} error: ${result.error}\n`);
      // ponytail: one failure retries never; re-run the command, it resumes from labels.jsonl.
      continue;
    }
    ok++;
    record(dir, { id: r.id, claims_done: result.claims_done, verification_applies: result.verification_applies, why: result.why, source: "claude-sonnet-proxy", ts: new Date().toISOString() });
    process.stdout.write(`[${index + 1}/${todo.length}] ${r.id} done=${result.claims_done ? "y" : "n"} applies=${result.verification_applies ? "y" : "n"}  ${result.why}\n`);
  }
  console.log(`labeled ${ok}, failed ${failed}, source claude-sonnet-proxy`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
