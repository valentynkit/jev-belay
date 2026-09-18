#!/usr/bin/env node
// jev-belay: a Claude Code Stop hook that refuses "done" when nothing ran.
//
// Order of business: read the turn's evidence out of the transcript (free, local), and
// only when something changed and nothing proved it works, spend one Jev call on four
// questions. Every error path exits 0. A hook that blocks by accident costs more trust
// than one that misses a case.
//
// The transcript never leaves the machine: state is the user's task, the final assistant
// message, and counts derived from tool calls. No tool inputs, no diffs, no file contents.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BELAY_HOME = join(homedir(), ".claude", "belay");
export const MODEL = process.env.JEV_MODEL || "jev-1.13.0";

// ---------------------------------------------------------------------------
// Redaction. Broad on purpose: this runs on everything that leaves the machine.
// Shapes and assignment forms follow pi-warden src/redact.ts:6-21.

const REDACTED = "<redacted>";
const SECRET_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/(authorization\s*[:=]\s*)(?:basic|bearer|token)?\s*\S+/gi, `$1${REDACTED}`],
  [/\b(bearer\s+)\S+/gi, `$1${REDACTED}`],
  [/((?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|passw(?:or)?d|passphrase|token|secret|credentials?)[a-z0-9_-]*\s*[=:]\s*["']?)([^\s"'&;]+)/gi, `$1${REDACTED}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REDACTED],
];

/** Scrub credentials and rewrite the home directory to `~`. */
export function redact(text, home = homedir()) {
  if (typeof text !== "string") return "";
  let out = text;
  for (const [pattern, replacement] of SECRET_RULES) out = out.replace(pattern, replacement);
  if (home) out = out.split(home).join("~");
  return out;
}

// ---------------------------------------------------------------------------
// Belt 1: does the command text name a test, build, or lint runner?
// Verbatim from pi-warden src/done.ts:12.

export const CHECK_COMMAND = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify|ci)\b|(?:npx|pnpm|bunx)\s+(?:tsc|jest|vitest|mocha|eslint|biome|prettier\s+--check)\b|pytest|jest|vitest|mocha|tsc|eslint|biome\s+check|ruff|mypy|flake8|pylint|black\s+--check|cargo\s+(?:test|check|build|clippy)|go\s+(?:test|vet|build)|make\s+(?:test|check|lint|build)|mvn\s+(?:test|verify)|gradle\w*\s+(?:test|check|build)|dotnet\s+(?:test|build)|node\s+--test|deno\s+(?:test|check|lint)|rspec|rake\s+test|mix\s+test|phpunit|swift\s+(?:test|build)|xcodebuild\s+test|ctest|zig\s+(?:test|build))\b/;

/**
 * Belt 2: a runner launched from inside a script leaves no runner name in the command,
 * but its output still carries its own summary. Adapted from pi-warden src/done.ts:35-47.
 * Returns what the summary reports, or undefined when there is no summary.
 */
export function checkSummary(output) {
  if (typeof output !== "string" || !output) return undefined;
  const tail = output.slice(-6000);
  const nodeTest = /[ℹi] (?:tests|pass|fail) \d+/.test(tail) && /[ℹi] fail (\d+)/.exec(tail);
  if (nodeTest) return Number(nodeTest[1]) > 0 ? "fail" : "pass";
  const jest = /^Tests:\s+(?:(\d+) failed, )?.*?\d+ total/m.exec(tail);
  if (jest) return jest[1] && Number(jest[1]) > 0 ? "fail" : "pass";
  const pytest = /^=+ .*?(?:(\d+) failed|(\d+) error).*?in [\d.]+s/m.exec(tail) ?? /^=+ (\d+) passed.*? in [\d.]+s =+$/m.exec(tail);
  if (pytest) return /\d+ (?:failed|error)/.test(pytest[0]) ? "fail" : "pass";
  const cargoOrGo = /^test result: (ok|FAILED)\./m.exec(tail) ?? /^(ok|FAIL)\s+\S+\s+[\d.]+s$/m.exec(tail);
  if (cargoOrGo) return cargoOrGo[1] === "ok" ? "pass" : "fail";
  if (/\berror TS\d{4}:/.test(tail)) return "fail";
  return undefined;
}

const MUTATING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** What a finished tool call contributes: a change, a check, or nothing either way. */
export function classifyToolResult(tool, input = {}, failed = false, output = "") {
  if (MUTATING_TOOLS.has(tool)) return "mutation";
  const command = typeof input.command === "string" ? input.command : "";
  if (tool === "Bash" && CHECK_COMMAND.test(command)) return failed ? "check-fail" : "check-pass";
  const summary = checkSummary(output);
  if (summary) return summary === "fail" || failed ? "check-fail" : "check-pass";
  return "unknown";
}

// ---------------------------------------------------------------------------
// The evidence pass over the transcript slice since the last user prompt.

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

function isUserPrompt(line) {
  return line.type === "user" && !line.toolUseResult && !line.isMeta && !line.isSidechain
    && textOf(line.message?.content).trim() !== "";
}

/** Parse a jsonl transcript into records, skipping anything unparseable. */
export function parseJsonl(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try { out.push(JSON.parse(raw)); } catch { /* a half-written last line is normal */ }
  }
  return out;
}

/**
 * Walk one turn (a user prompt and everything after it) and return the facts the
 * questions read. `checksBeforeMutation` marks where the fresh checks start: only the
 * checks that ran after the latest change say anything about the code as it stands.
 */
export function evidenceFromTurn(lines) {
  const evidence = { mutations: 0, checks: [], checksBeforeMutation: 0 };
  const pending = new Map();
  let finalMessage = "";
  for (const line of lines) {
    if (line.isSidechain) continue;
    if (line.type === "assistant" && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block?.type === "tool_use") pending.set(block.id, { name: block.name, input: block.input || {} });
      }
      const text = textOf(line.message.content).trim();
      if (text) finalMessage = text;
      continue;
    }
    if (line.type === "user" && line.toolUseResult) {
      const result = line.toolUseResult;
      const blocks = Array.isArray(line.message?.content) ? line.message.content : [];
      const ref = blocks.find((b) => b?.type === "tool_result");
      const call = pending.get(ref?.tool_use_id) || {};
      const failed = Boolean(ref?.is_error || result.interrupted);
      const stdout = typeof result === "string" ? result : `${result.stdout || ""}\n${result.stderr || ""}`;
      const outcome = classifyToolResult(call.name, call.input, failed, stdout);
      if (outcome === "mutation") {
        evidence.mutations++;
        evidence.checksBeforeMutation = evidence.checks.length;
      } else if (outcome === "check-pass" || outcome === "check-fail") {
        const command = typeof call.input?.command === "string" ? call.input.command : call.name || "check";
        evidence.checks.push({ call: redact(command.slice(0, 200)), passed: outcome === "check-pass" });
      }
    }
  }
  return { ...evidence, finalMessage };
}

export function freshChecks(evidence) {
  return evidence.checks.slice(evidence.checksBeforeMutation ?? 0);
}

/** Every turn in a transcript, as {task, finalMessage, mutations, checks, ...}. */
export function turnsOf(records) {
  const turns = [];
  let current = null;
  for (const line of records) {
    if (isUserPrompt(line)) {
      if (current) turns.push(current);
      current = { task: textOf(line.message.content).trim(), promptId: line.promptId, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) turns.push(current);
  return turns.map((t) => ({ task: t.task, promptId: t.promptId, ...evidenceFromTurn(t.lines) }));
}

/** The last turn of a transcript file, which is the turn a Stop hook fires on. */
export function readEvidence(transcriptPath) {
  const records = parseJsonl(readFileSync(transcriptPath, "utf8"));
  const turns = turnsOf(records);
  const last = turns.at(-1) || { task: "", finalMessage: "", mutations: 0, checks: [], checksBeforeMutation: 0 };
  return { ...last, lineCount: records.length };
}

// ---------------------------------------------------------------------------
// The gate. Everything here is free; only a turn that passes it costs a Jev call.

// The keyword pre-screen, kept as a diagnostic and out of the gate. It was designed as a
// free cost filter that had to drop zero labeled false dones; measured on the corpus it
// dropped 68% of them, because "presents the work as finished" is a judgment and these
// are keywords. One Jev call costs $0.000017, so the filter was never worth a miss.
// `measure --labels` still prints its recall.
export const DONE_HINT = /\b(done|did it|finished|fixed|resolved|implemented|complete[ds]?|completed|working|works now|passing|passes|green|ready|all set|good to go|should work|in place|sorted)\b/i;

export function needsDoneCheck(evidence) {
  return evidence.mutations > 0 && !freshChecks(evidence).some((c) => c.passed);
}

// ---------------------------------------------------------------------------
// The one request: four questions, state capped hard. Wording from pi-warden
// src/done.ts:98-120, which is the only wording anyone has measured on real stops.

export const QUESTIONS = {
  claims_done: {
    type: "noul",
    instructions: "Does `final_message` present the requested work as finished or working?",
    criteria: {
      true: "Yes: it says the task is done, fixed, implemented, complete, or working, or summarises the result as final.",
      false: "No: it reports partial progress, names remaining work, reports a blocker, asks the user a question, or only describes a plan.",
    },
  },
  claims_verified: {
    type: "noul",
    instructions: "Does `final_message` claim that tests, a build, or other checks were run and passed?",
    criteria: {
      true: "Yes: it states that a test suite, build, type check, or lint was run and came back clean.",
      false: "No: it makes no claim about running checks, or says checks were not run.",
    },
  },
  verification_applies: {
    type: "noul",
    instructions: "Would running the project's tests, build, or lint be a meaningful way to check the work that `task` asks for?",
    criteria: {
      true: "Yes: `task` changes or adds code, configuration, or build logic that such checks exercise.",
      false: "No: `task` is about documentation, prose, file housekeeping, deleting or moving files, answering a question, or something the project's checks would not cover.",
    },
  },
  outcome: {
    type: "choice",
    instructions: "What does `final_message` report about `task`?",
    criteria: {
      complete: "The work is finished",
      partial: "Progress was made and remaining work is named",
      blocked: "A blocker is reported or the user is asked something",
      other: "None of these",
    },
  },
};

const TASK_CAP = 1500;
const MESSAGE_CAP = 2000;

// A slice, never a throw: a hook that dies on an oversized state never fails open.
// The task keeps its head (the request is stated up front), the final message keeps its
// tail (the completion claim lives in the last paragraph, which is also the window the
// DONE_HINT pre-screen reads).
function capHead(text, limit) {
  const t = (text || "").trim();
  return t.length > limit ? `${t.slice(0, limit)}...` : t;
}

function capTail(text, limit) {
  const t = (text || "").trim();
  return t.length > limit ? `...${t.slice(-limit)}` : t;
}

export function buildState(task, finalMessage, evidence) {
  return {
    task: capHead(redact(task), TASK_CAP) || "(no user request recorded in this session)",
    final_message: capTail(redact(finalMessage), MESSAGE_CAP),
    run: {
      file_changes: evidence.mutations,
      checks_run: freshChecks(evidence).map((c) => `${c.call} -> ${c.passed ? "passed" : "failed"}`),
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP client. One budget across retries (jev-guard src/jev.js:29-67): the host kills a
// hook near 30 s, and a killed hook never reaches its fail-open branch.

export async function ask(state, questions, { env = process.env, fetchImpl = fetch, timeoutMs } = {}) {
  const base = env.JEV_BASE_URL || "https://api.typesafe.ai";
  const key = env.TYPESAFE_API_KEY || env.JEV_API_KEY;
  const budget = AbortSignal.timeout(timeoutMs ?? Number(env.JEV_BELAY_TIMEOUT_MS || 20_000));
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const body = JSON.stringify({ model: env.JEV_MODEL || MODEL, state, questions });
  const started = Date.now();
  let res;
  for (let attempt = 0; ; attempt++) {
    let wait = 600 * 2 ** attempt;
    try {
      res = await fetchImpl(`${base}/v1/systemone`, { method: "POST", headers, body, signal: budget });
      if (res.ok || (res.status !== 429 && res.status < 500) || attempt === 2) break;
      wait = retryAfterMs(res) ?? wait;
      await res.text().catch(() => {});
    } catch (err) {
      if (budget.aborted || attempt === 2) throw err;
    }
    await sleep(wait, budget);
  }
  if (!res.ok) {
    const err = new Error(`jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    err.retryAfterMs = retryAfterMs(res);
    throw err;
  }
  const json = await res.json();
  return { ...json, elapsedMs: Date.now() - started };
}

/** `retry-after` is seconds or an HTTP date; the gateway sends seconds. */
function retryAfterMs(res) {
  const header = res.headers?.get?.("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.min(Math.max(at - Date.now(), 0), 30_000);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// The decision. Reads the evidence as well as the answers.

export const DEFAULT_THRESHOLD = 0.75;
const APPLIES_THRESHOLD = 0.5;

export function decide(answers, evidence, { threshold = DEFAULT_THRESHOLD } = {}) {
  const claimsDone = answers?.claims_done?.noul ?? 0;
  const claimsVerified = answers?.claims_verified?.noul ?? 0;
  const applies = answers?.verification_applies?.noul ?? 0;
  const outcome = answers?.outcome?.choice ?? "other";
  // Hard veto: a turn whose latest change survived a passing check can never block,
  // whatever Jev says. Dead in the live pipeline (the gate filters those turns out
  // first) and alive as an invariant, which is why it has its own test.
  const verified = freshChecks(evidence).some((c) => c.passed);
  const unverified = !verified && claimsDone >= threshold && outcome !== "blocked" && applies >= APPLIES_THRESHOLD;
  const falseClaim = unverified && claimsVerified >= 0.7 && evidence.checks.length === 0;
  const reasons = [];
  if (unverified) {
    const failed = freshChecks(evidence).filter((c) => !c.passed);
    const detail = failed.length
      ? `${failed.length} failed check${failed.length === 1 ? "" : "s"} and no passing one`
      : "no test, build, or lint run since the last change";
    reasons.push(`reports completion (${claimsDone.toFixed(2)}) after ${evidence.mutations} file change${evidence.mutations === 1 ? "" : "s"} with ${detail}`);
  }
  if (falseClaim) reasons.push(`claims checks passed (${claimsVerified.toFixed(2)}) but none ran`);
  return { block: unverified, falseClaim, verified, reasons, claimsDone, claimsVerified, applies, outcome };
}

/** What the agent is told when it is blocked. */
export function nudge(verdict, evidence) {
  const failed = freshChecks(evidence).filter((c) => !c.passed);
  const next = failed.length
    ? `The last check that ran failed: ${failed.at(-1).call}. Fix that first.`
    : "Run the project's tests, build, or lint (whatever exists) on what you changed.";
  return `jev-belay: ${verdict.reasons.join("; ")}. ${next} Then report the actual result. If no check exists or can run, say so plainly instead of presenting the work as done.`;
}

// ---------------------------------------------------------------------------
// Session guard and the decision log. Both are best effort: any failure means allow.

const BLOCK_COOLDOWN_MS = 60_000;
const MAX_BLOCKS_PER_SESSION = 3;

export function sessionFile(sessionId) {
  return join(BELAY_HOME, "sessions", `${String(sessionId || "unknown").replace(/[^\w.-]/g, "_")}.json`);
}

function readSession(sessionId) {
  try { return JSON.parse(readFileSync(sessionFile(sessionId), "utf8")); } catch { return { blocks: 0, lastBlockAt: 0, keys: [] }; }
}

function writeSession(sessionId, state) {
  try {
    mkdirSync(join(BELAY_HOME, "sessions"), { recursive: true });
    writeFileSync(sessionFile(sessionId), JSON.stringify(state));
  } catch { /* an unwritable state dir costs dedup, not correctness */ }
}

/** stop_hook_active is an optimisation, not the guard: it is missing on some versions. */
export function guardAllows(state, key, now = Date.now()) {
  if (state.keys?.includes(key)) return false;
  if (state.blocks >= MAX_BLOCKS_PER_SESSION) return false;
  if (now - (state.lastBlockAt || 0) < BLOCK_COOLDOWN_MS) return false;
  return true;
}

const LOG_CAP_BYTES = 5 * 1024 * 1024;

export function logDecision(record, env = process.env) {
  if (env.JEV_BELAY_LOG !== "1") return;
  try {
    mkdirSync(BELAY_HOME, { recursive: true });
    const path = join(BELAY_HOME, "decisions.jsonl");
    try {
      if (statSync(path).size > LOG_CAP_BYTES) renameSync(path, `${path}.1`);
    } catch { /* no log yet */ }
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch { /* logging never breaks the hook */ }
}

// ---------------------------------------------------------------------------
// The hook itself.

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

export async function runHook({ env = process.env, stdin, fetchImpl = fetch } = {}) {
  let payload;
  try { payload = JSON.parse(stdin); } catch { return { exit: 0, why: "unparseable payload" }; }
  if (!payload || typeof payload !== "object") return { exit: 0, why: "empty payload" };
  if (payload.stop_hook_active) return { exit: 0, why: "stop hook already active" };
  if (!env.TYPESAFE_API_KEY && !env.JEV_API_KEY && !env.JEV_BASE_URL) return { exit: 0, why: "no key" };

  let evidence;
  try { evidence = readEvidence(payload.transcript_path); } catch { return { exit: 0, why: "no readable transcript" }; }
  if (!needsDoneCheck(evidence)) return { exit: 0, why: "gate: nothing to check" };

  const key = payload.prompt_id || evidence.promptId || `${payload.session_id}:${evidence.lineCount}`;
  const session = readSession(payload.session_id);
  if (!guardAllows(session, key)) return { exit: 0, why: "guard: already blocked here" };

  const state = buildState(evidence.task, evidence.finalMessage, evidence);
  let answer;
  try {
    answer = await ask(state, QUESTIONS, { env, fetchImpl });
  } catch (err) {
    return { exit: 0, why: `jev unreachable: ${String(err.message).slice(0, 120)}` };
  }
  const verdict = decide(answer.answers, evidence, { threshold: Number(env.JEV_BELAY_THRESHOLD || DEFAULT_THRESHOLD) });
  const reason = verdict.block ? nudge(verdict, evidence) : "";

  logDecision({
    ts: new Date().toISOString(),
    session: payload.session_id,
    task: state.task,
    final_message: state.final_message,
    evidence: { mutations: evidence.mutations, checks: freshChecks(evidence) },
    answers: answer.answers,
    verdict: verdict.block ? "blocked" : "allowed",
    reason,
    latency_ms: answer.elapsedMs,
    usage: answer.usage || {},
    model: answer.model || MODEL,
  }, env);

  if (!verdict.block) return { exit: 0, why: "allowed" };
  writeSession(payload.session_id, {
    blocks: (session.blocks || 0) + 1,
    lastBlockAt: Date.now(),
    keys: [...(session.keys || []), key].slice(-20),
  });
  return { exit: 2, why: "blocked", reason };
}

// ---------------------------------------------------------------------------
// watch: the live view. Tails the decision log and draws each decision as it lands.

const COLOR = !process.env.NO_COLOR && process.stdout.isTTY !== false;
const c = (code, s) => (COLOR ? `[${code}m${s}[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);

const COLS = () => Math.max(60, Math.min(process.stdout.columns || 80, 100));

// Every bar is coloured by where it pushes the verdict: red toward BLOCKED, green toward
// allowed, dim inside the 0.30-0.70 dead band. claims_verified is the one that flips: a
// claim that checks passed is honest when a check did pass, and a lie when none ran.
const BLOCK_SIDE = { claims_done: true, claims_verified: true, verification_applies: true };

function bar(p, width) {
  const filled = Math.round(Math.max(0, Math.min(1, p)) * width);
  return "█".repeat(filled) + dim("░".repeat(width - filled));
}

function paint(name, p, passedFresh) {
  if (p > 0.3 && p < 0.7) return "dim";
  if (name === "claims_verified" && passedFresh) return p >= 0.7 ? "green" : "red";
  return (BLOCK_SIDE[name] ? p >= 0.7 : p < 0.3) ? "red" : "green";
}

export function renderDecision(d, width = COLS()) {
  const barWidth = Math.max(12, width - 34);
  const out = [];
  out.push(dim("─".repeat(width)));
  out.push(`${dim("task    ")} ${oneLine(d.task, width - 10)}`);
  out.push(`${dim("said    ")} ${oneLine(tail(d.final_message, 160), width - 10)}`);
  const checks = (d.evidence?.checks || []).map((k) => `${oneLine(k.call, 28)} ${k.passed ? green("pass") : red("fail")}`).join(", ");
  const changes = d.evidence?.mutations ?? 0;
  out.push(`${dim("evidence")} ${changes} file change${changes === 1 ? "" : "s"}, ${checks || dim("no checks run")}`);
  out.push("");
  for (const [name, answer] of Object.entries(d.answers || {})) {
    const p = answer.noul ?? answer.confidence ?? 0;
    const label = answer.choice ? `${name} (${answer.choice})` : name;
    const passedFresh = (d.evidence?.checks || []).some((k) => k.passed);
    const style = answer.choice ? (answer.choice === "blocked" ? "green" : "red") : paint(name, p, passedFresh);
    const drawn = bar(p, barWidth);
    const colored = style === "green" ? green(drawn) : style === "red" ? red(drawn) : dim(drawn);
    out.push(`${label.padEnd(22).slice(0, 22)} ${colored} ${p.toFixed(2)}`);
  }
  out.push("");
  const cost = ((d.usage?.input_tokens || 0) * 0.042) / 1e6;
  const meta = dim(`${d.latency_ms ?? 0} ms  $${cost.toFixed(6)}  ${d.model || ""}`);
  if (d.verdict === "blocked") {
    out.push(`${bold(red("BLOCKED"))} ${meta}`);
    out.push(red(oneLine(d.reason, width)));
  } else {
    out.push(`${bold(green("allowed"))} ${meta}`);
  }
  return out.join("\n");
}

const oneLine = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const tail = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function watch(argv) {
  process.stdout.on("error", () => process.exit(0)); // piping into head is normal here
  const replayAt = argv.indexOf("--replay");
  const path = replayAt >= 0 ? argv[replayAt + 1] : join(BELAY_HOME, "decisions.jsonl");
  if (replayAt >= 0) {
    for (const line of parseJsonl(readFileSync(path, "utf8"))) {
      console.log(renderDecision(line));
      await wait(400);
    }
    return;
  }
  console.log(bold("jev-belay watch"), dim(`tailing ${path.replace(homedir(), "~")}`));
  let offset = 0;
  try { offset = statSync(path).size; } catch {
    console.log(dim("no decision log yet. Set JEV_BELAY_LOG=1 in the environment Claude Code runs in, then end a turn."));
  }
  for (;;) {
    let size = offset;
    try { size = statSync(path).size; } catch { await wait(400); continue; }
    if (size < offset) offset = 0; // rotated
    if (size > offset) {
      const fd = readFileSync(path, "utf8");
      const fresh = fd.slice(offset);
      offset = Buffer.byteLength(fd);
      for (const line of parseJsonl(fresh)) console.log(renderDecision(line));
    }
    await wait(300);
  }
}

// ---------------------------------------------------------------------------

async function main(argv) {
  if (argv.includes("watch") || argv.includes("--watch") || argv.includes("--replay")) {
    await watch(argv);
    return;
  }
  let result;
  try {
    result = await runHook({ stdin: await readStdin() });
  } catch (err) {
    // The last net: anything unexpected at all still lets the turn end.
    process.stderr.write(`jev-belay internal error: ${String(err?.message).slice(0, 200)}\n`);
    process.exit(0);
  }
  if (result.exit === 2) {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason: result.reason })}\n`);
    process.stderr.write(`${result.reason}\n`);
    process.exit(2);
  }
  if (process.env.JEV_BELAY_DEBUG === "1") process.stderr.write(`jev-belay: ${result.why}\n`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2));
}
