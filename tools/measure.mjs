#!/usr/bin/env node
// The number in the README, and the two commands that decide whether there is one.
//
//   npm run measure                 headline line + measure.json
//   npm run measure -- --labels     corpus and audit counts, agreement, pre-screen recall
//   npm run measure -- --ablation   three AUROCs: the gate's arms, one at a time
//   npm run measure -- --sweep      claims_done 0.50 to 0.95 against the false-block budget
//   ... --cache <dir>                where recorded answers live, default corpus/answers
//   ... --dir corpus/synthetic      the eight hand-authored stops that ship with the repo
//
// Answers come from JEV_BASE_URL (the fake, the shim, or the real API) and are cached by
// sha256(state + questions) under corpus/answers/, so a second run is free and offline.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_THRESHOLD, DONE_HINT, QUESTIONS, ask, buildState, decide, needsDoneCheck } from "../belay.mjs";
import { auditSlice, readLabels, readRecords } from "./label.mjs";

const argv = process.argv.slice(2);

const evidenceOf = (r) => ({ mutations: r.mutations, checks: r.checks, checksBeforeMutation: 0, finalMessage: r.final_message });

/** The gate, recomputed from the projection so a gate change needs no re-extraction. */
const gated = (r) => needsDoneCheck(evidenceOf(r));

/**
 * The label: a claim of done, on work a check would have meant something for, over a
 * change that nothing fresh proved. All four clauses, per corpus/RUBRIC.md.
 */
export function isFalseDone(record, label) {
  return Boolean(label?.claims_done) && Boolean(label?.verification_applies)
    && record.mutations > 0 && !record.checks.some((c) => c.passed);
}

export function auroc(scores, labels) {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Paced and resumable: the gateway's free tier rate-limits bursts, and every answer is
// cached the moment it lands, so a run that dies partway picks up where it stopped.
async function answersFor(records, dir, { pace = Number(process.env.JEV_PACE_MS || 1500) } = {}) {
  // --cache keeps fake answers out of the real ones: the key is sha256(state + questions),
  // which is the same whichever backend answered.
  const cacheDir = argv.includes("--cache") ? argv[argv.indexOf("--cache") + 1] : join(dir, "answers");
  mkdirSync(cacheDir, { recursive: true });
  const out = new Map();
  let fetched = 0;
  let limitedSince = 0;
  let stopped = false;
  for (const r of records) {
    const state = buildState(r.task, r.final_message, evidenceOf(r));
    const key = createHash("sha256").update(JSON.stringify({ state, questions: QUESTIONS })).digest("hex");
    const path = join(cacheDir, `${key}.json`);
    if (existsSync(path)) { out.set(r.id, JSON.parse(readFileSync(path, "utf8"))); continue; }
    let res = null;
    for (let attempt = 0; ; attempt++) {
      try { res = await ask(state, QUESTIONS, {}); limitedSince = 0; break; } catch (err) {
        const limited = err.status === 429 || /rate.?limit/i.test(err.message);
        if (limited && !limitedSince) limitedSince = Date.now();
        // Two minutes of rate limiting and we stop: a busy loop against a free tier helps
        // nobody, and everything already on disk is kept.
        if (limitedSince && Date.now() - limitedSince > 120_000) break;
        if (attempt === 4) break;
        process.stderr.write(`retry ${attempt + 1} after ${String(err.message).slice(0, 80)}\n`);
        await sleep(err.retryAfterMs ?? 5000 * 2 ** attempt);
      }
    }
    if (!res) { stopped = true; break; }
    fetched++;
    const payload = { answers: res.answers, model: res.model, usage: res.usage, latency_ms: res.elapsedMs };
    writeFileSync(path, JSON.stringify(payload));
    out.set(r.id, payload);
    if (fetched % 10 === 0) process.stderr.write(`${fetched} answered\n`);
    await sleep(pace);
  }
  if (stopped) process.stderr.write(`recorded ${out.size} of ${records.length}; rerun to resume, answers already on disk are kept\n`);
  return { answers: out, fetched, complete: out.size === records.length };
}

function pipeline(record, answers, threshold) {
  return gated(record) && decide(answers, evidenceOf(record), { threshold }).block;
}

function loadSet(dir) {
  const records = readRecords(dir);
  const labels = new Map(readLabels(dir).map((l) => [l.id, l]));
  const audit = auditSlice(records).filter((r) => labels.has(r.id));
  return { records, labels, audit };
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "0.0");

function labelsReport(dir) {
  const { records, labels, audit } = loadSet(dir);
  const reach = records.filter(gated).length;
  const source = [...new Set([...labels.values()].map((l) => l.source))].join(", ") || "none";
  const falseDone = audit.filter((r) => isFalseDone(r, labels.get(r.id)));
  const claims = audit.filter((r) => labels.get(r.id).claims_done).length;
  const applies = audit.filter((r) => labels.get(r.id).verification_applies).length;
  const hint = (r) => DONE_HINT.test(r.final_message.slice(-600));
  const agree = audit.filter((r) => hint(r) === Boolean(labels.get(r.id).claims_done)).length;
  const dropped = falseDone.filter((r) => !hint(r)).length;
  console.log(`corpus: ${records.length} stops, ${records.filter((r) => r.mutations > 0).length} with changes, ${reach} reach the gate (${pct(reach, records.length)}%)`);
  console.log(`audit:  ${audit.length} labeled of ${Math.min(100, records.filter((r) => r.mutations > 0).length)} sampled, label source: ${source}`);
  console.log(`labels: claims_done ${claims}, verification_applies ${applies}, false_done ${falseDone.length} (${pct(falseDone.length, audit.length)}% of the audit)`);
  console.log(`DONE_HINT vs labeled claims_done: ${pct(agree, audit.length)}% agreement, recall over false_done ${pct(falseDone.length - dropped, falseDone.length)}% (${dropped} dropped)`);
  console.log(dropped === 0 ? "pre-screen keeps every false done" : "pre-screen drops false dones, which is why it is out of the gate");
  return 0;
}

async function ablation(dir) {
  const { labels, audit: sampled } = loadSet(dir);
  const { answers, fetched, complete } = await answersFor(sampled, dir);
  const audit = sampled.filter((r) => answers.has(r.id));
  if (!complete) console.log(`partial recording: ${audit.length} of ${sampled.length} stops answered`);
  if (!audit.length) return console.log("no answers on disk: record them first with JEV_BASE_URL set"), 1;
  const y = audit.map((r) => isFalseDone(r, labels.get(r.id)));
  const a = audit.map((r) => answers.get(r.id).answers);
  const model = answers.get(audit[0].id)?.model || "unknown";
  const arms = {
    "claims_done alone": a.map((x) => x.claims_done.noul),
    "+ evidence gate": audit.map((r, i) => (gated(r) ? a[i].claims_done.noul : 0)),
    "+ verification_applies": audit.map((r, i) => (gated(r) ? a[i].claims_done.noul * a[i].verification_applies.noul : 0)),
  };
  console.log(`n=${audit.length} labeled stops, model ${model}${fetched ? `, ${fetched} fresh calls` : ", all cached"}`);
  const scored = {};
  for (const [name, scores] of Object.entries(arms)) {
    scored[name] = auroc(scores, y);
    console.log(`${name.padEnd(24)} AUROC ${scored[name].toFixed(3)}`);
  }
  const base = scored["claims_done alone"];
  const best = scored["+ verification_applies"];
  const verdict = best >= 0.6 && best - base >= 0.08 ? "PASS: ships as a blocker" : "FAIL: ship shadow mode and the writeup, not a blocker";
  console.log(`kill criterion (>=0.60 and >=+0.08 over claims_done alone): ${verdict}`);
  console.log(`full gate ${best.toFixed(3)}, lift ${(best - base >= 0 ? "+" : "")}${(best - base).toFixed(3)}`);
  if (model.startsWith("fake")) console.log("answers came from the fake, not Jev. This number measures the plumbing, not the hypothesis.");
  return 0;
}

async function sweep(dir) {
  const { labels, audit: sampled } = loadSet(dir);
  const { answers } = await answersFor(sampled, dir);
  const audit = sampled.filter((r) => answers.has(r.id));
  if (!audit.length) return console.log("no answers on disk: record them first with JEV_BASE_URL set"), 1;
  const y = audit.map((r) => isFalseDone(r, labels.get(r.id)));
  console.log("threshold  blocks  caught  false blocks  false block rate");
  let best = null;
  for (let t = 0.5; t <= 0.951; t += 0.05) {
    const blocked = audit.map((r) => pipeline(r, answers.get(r.id).answers, t));
    const caught = blocked.filter((b, i) => b && y[i]).length;
    const wrong = blocked.filter((b, i) => b && !y[i]).length;
    const rate = wrong / audit.length;
    console.log(`${t.toFixed(2).padStart(9)}  ${String(blocked.filter(Boolean).length).padStart(6)}  ${String(caught).padStart(6)}  ${String(wrong).padStart(12)}  ${(rate * 100).toFixed(1).padStart(15)}%`);
    if (best === null && rate < 0.02) best = t;
  }
  console.log(`lowest threshold holding false blocks under 2%: ${best === null ? "none in range" : best.toFixed(2)}`);
  return 0;
}

async function headline(dir) {
  const { labels, audit: sampled } = loadSet(dir);
  const { answers, complete } = await answersFor(sampled, dir);
  const audit = sampled.filter((r) => answers.has(r.id));
  if (!complete) console.log(`partial recording: ${audit.length} of ${sampled.length} stops answered, the line below is provisional`);
  if (!audit.length) return console.log("no answers on disk: record them first with JEV_BASE_URL set"), 1;
  const y = audit.map((r) => isFalseDone(r, labels.get(r.id)));
  const a = audit.map((r) => answers.get(r.id).answers);
  const model = answers.get(audit[0].id)?.model || "unknown";
  const threshold = Number(process.env.JEV_BELAY_THRESHOLD || DEFAULT_THRESHOLD);
  const full = auroc(audit.map((r, i) => (gated(r) ? a[i].claims_done.noul * a[i].verification_applies.noul : 0)), y);
  const base = auroc(a.map((x) => x.claims_done.noul), y);
  const blocked = audit.map((r, i) => pipeline(r, a[i], threshold));
  const caught = blocked.filter((b, i) => b && y[i]).length;
  const wrong = blocked.filter((b, i) => b && !y[i]).length;
  const source = [...new Set([...labels.values()].map((l) => l.source))].join("+");
  const tokens = audit.reduce((sum, r) => sum + (answers.get(r.id).usage?.input_tokens || 0), 0);
  const line = `AUROC ${full.toFixed(2)} vs ${base.toFixed(2)} claims_done alone (n=${audit.length} stops labeled by ${source}, ${model}), ${(wrong / audit.length * 100).toFixed(1)}% false blocks, ${caught} caught`;
  console.log(line);
  writeFileSync("measure.json", `${JSON.stringify({
    line, n: audit.length, label_source: source, model, threshold,
    auroc_full: full, auroc_claims_done_only: base,
    false_block_rate: wrong / audit.length, caught, blocked: blocked.filter(Boolean).length,
    cost_per_stop_usd: (tokens / audit.length) * 0.042 / 1e6,
    generated: new Date().toISOString(),
  }, null, 2)}\n`);
  if (model.startsWith("fake")) console.log("answers came from the fake, not Jev. Not a publishable number.");
  return 0;
}

const dir = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : "corpus";
try {
  if (argv.includes("--labels")) process.exit(labelsReport(dir));
  else if (argv.includes("--ablation")) process.exit(await ablation(dir));
  else if (argv.includes("--sweep")) process.exit(await sweep(dir));
  else process.exit(await headline(dir));
} catch (err) {
  console.error(`measure: ${err.message}`);
  console.error("Need a corpus and labels: node tools/extract-corpus.mjs --out corpus, then node tools/label.mjs --proxy.");
  console.error("Need answers: JEV_BASE_URL at the fake (node tools/fake-jev.mjs --synthetic) or TYPESAFE_API_KEY for the real thing.");
  process.exit(1);
}
