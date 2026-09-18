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

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BELAY_HOME = join(homedir(), ".claude", "belay");
export const MODEL = process.env.JEV_MODEL || "jev-1.13.0";

/**
 * Whether this module is the command being run, rather than an import.
 *
 * Node resolves import.meta.url through symlinks and argv[1] arrives as written, so
 * comparing the two raw makes a script a silent no-op whenever the path it was invoked by
 * crosses a link: a plugin cache under /tmp on macOS, a symlinked home in a container.
 */
export function isEntryPoint(moduleUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try { return moduleUrl === pathToFileURL(realpathSync(argv1)).href; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Redaction. Broad on purpose: this runs on everything that leaves the machine.
// Shapes and assignment forms follow pi-warden src/redact.ts:6-21.

const REDACTED = "<redacted>";
const SECRET_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/(authorization\s*[:=]\s*)(?:basic|bearer|token)?\s*\S+/gi, `$1${REDACTED}`],
  // Only a token-shaped word after "bearer": the bare rule ate the next word of any
  // sentence that used "bearer" in prose, and this text is mostly prose.
  [/\b(bearer\s+)[\w.-]{16,}/gi, `$1${REDACTED}`],
  // The optional quote after the keyword is what makes JSON work. Without it the keyword
  // class stops at the closing quote and the whole shape walks through untouched.
  [/((?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|passw(?:or)?d|passphrase|token|secret|credentials?)[a-z0-9_-]*["']?\s*[=:]\s*["']?)([^\s"'&;]+)/gi, `$1${REDACTED}`],
  // The username is optional: redis:// conventionally has none, and the password is still there.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{30,}/g, REDACTED],
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
  // A long run appends the wall clock after the seconds, so the tail is not anchored.
  const pytest = /^=+ .*?(?:(\d+) failed|(\d+) error).*?in [\d.]+s/m.exec(tail) ?? /^=+ (\d+) passed.*? in [\d.]+s/m.exec(tail);
  if (pytest) return /\d+ (?:failed|error)/.test(pytest[0]) ? "fail" : "pass";
  const cargoOrGo = /^test result: (ok|FAILED)\./m.exec(tail) ?? /^(ok|FAIL)\s+\S+\s+[\d.]+s$/m.exec(tail);
  if (cargoOrGo) return cargoOrGo[1] === "ok" ? "pass" : "fail";
  // vitest counts on their own line, two spaces in, no colon (that is jest's shape).
  const vitest = /^\s*Tests\s{2,}([^\n]*\(\d+\))\s*$/m.exec(tail);
  if (vitest) return /\d+ failed/.test(vitest[1]) ? "fail" : "pass";
  const bunFail = /^\s*(\d+) fail\s*$/m.exec(tail);
  if (bunFail && /^\s*\d+ pass\s*$/m.test(tail)) return Number(bunFail[1]) > 0 ? "fail" : "pass";
  const mix = /^(?:\d+ doctests?, )?\d+ tests?, (\d+) failures?/m.exec(tail);
  if (mix) return Number(mix[1]) > 0 ? "fail" : "pass";
  const dotnet = /^(Passed|Failed)!\s+-\s+Failed:\s+\d+/m.exec(tail);
  if (dotnet) return dotnet[1] === "Passed" ? "pass" : "fail";
  const build = /^(?:\[INFO\] )?BUILD (SUCCESSFUL|SUCCESS|FAILED|FAILURE)/m.exec(tail);
  if (build) return build[1].startsWith("SUCCESS") ? "pass" : "fail";
  // eslint exits 0 on warnings alone, so the error count is the verdict, not the problem count.
  const eslint = /^[✖x] \d+ problems? \((\d+) errors?/m.exec(tail);
  if (eslint) return Number(eslint[1]) > 0 ? "fail" : "pass";
  if (/\berror TS\d{4,}:/.test(tail)) return "fail";
  return undefined;
}

const MUTATING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * What a finished tool call contributes: a change, a check, or nothing either way.
 *
 * Both belts speak before the verdict. The host flags a Bash result as an error for a
 * shell-level failure (no such command, permission denied) and not for a runner exiting
 * nonzero, which it records with no error flag and no exit code at all. Answering on belt 1
 * alone therefore reads a red suite as a pass, which is the one mistake that makes the whole
 * hook a no-op.
 */
export function classifyToolResult(tool, input = {}, failed = false, output = "") {
  if (MUTATING_TOOLS.has(tool)) return "mutation";
  const command = typeof input.command === "string" ? input.command : "";
  const summary = checkSummary(output);
  if (tool === "Bash" && CHECK_COMMAND.test(command)) return failed || summary === "fail" ? "check-fail" : "check-pass";
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

// A slash command and its output are logged as ordinary user lines, each with its own
// promptId, distinguishable only by the wrapper tag in the body. Treating one as a new
// prompt would split the turn and throw away the evidence collected before it.
const COMMAND_LINE = /^<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/;

function isUserPrompt(line) {
  if (line.type !== "user" || line.toolUseResult || line.isMeta || line.isSidechain) return false;
  const text = textOf(line.message?.content).trim();
  return text !== "" && !COMMAND_LINE.test(text);
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
export function evidenceFromTurn(lines, home = homedir()) {
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
        evidence.checks.push({ call: redact(command, home).slice(0, 200), passed: outcome === "check-pass" });
      }
    }
  }
  return { ...evidence, finalMessage };
}

export function freshChecks(evidence) {
  return evidence.checks.slice(evidence.checksBeforeMutation ?? 0);
}

/** Every turn in a transcript, as {task, finalMessage, mutations, checks, ...}. */
export function turnsOf(records, home = homedir()) {
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
  return turns.map((t) => ({ task: t.task, promptId: t.promptId, ...evidenceFromTurn(t.lines, home) }));
}

// A transcript grows without bound and a few pasted tool outputs can make it tens of MB,
// all of which this would otherwise read and parse on every single stop, including the four
// out of five that never reach a question. Only the last turn is ever used, so read the
// tail and fall back to the whole file when no prompt is in it.
const TAIL_BYTES = 4 * 1024 * 1024;

function readTail(path) {
  const size = statSync(path).size;
  if (size <= TAIL_BYTES) return { text: readFileSync(path, "utf8"), whole: true };
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(TAIL_BYTES);
    readSync(fd, buf, 0, TAIL_BYTES, size - TAIL_BYTES);
    const text = buf.toString("utf8");
    return { text: text.slice(text.indexOf("\n") + 1), whole: false }; // the first line is cut in half
  } finally { closeSync(fd); }
}

/**
 * The transcript's own home, so a hook running under a different $HOME still rewrites the
 * paths in the text it sends. Claude Code stores transcripts at <home>/.claude/projects/.
 */
export function homeOf(transcriptPath, fallback = homedir()) {
  return /^(.*)\/\.claude\/projects\//.exec(String(transcriptPath || ""))?.[1] || fallback;
}

/** The last turn of a transcript file, which is the turn a Stop hook fires on. */
export function readEvidence(transcriptPath) {
  const home = homeOf(transcriptPath);
  const { text, whole } = readTail(transcriptPath);
  let records = parseJsonl(text);
  if (!whole && !records.some(isUserPrompt)) records = parseJsonl(readFileSync(transcriptPath, "utf8"));
  const turns = turnsOf(records, home);
  const last = turns.at(-1) || { task: "", finalMessage: "", mutations: 0, checks: [], checksBeforeMutation: 0 };
  return { ...last, home, lineCount: records.length };
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
  const home = evidence?.home || homedir();
  return {
    task: capHead(redact(task, home), TASK_CAP) || "(no user request recorded in this session)",
    final_message: capTail(redact(finalMessage, home), MESSAGE_CAP),
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
// A four-way choice picked at 0.26 is a coin toss, and the `blocked` pick vetoes everything
// else. Only a pick that beat the field by some margin gets that power.
const OUTCOME_FLOOR = 0.4;

export function decide(answers, evidence, { threshold = DEFAULT_THRESHOLD } = {}) {
  const claimsDone = answers?.claims_done?.noul ?? 0;
  const claimsVerified = answers?.claims_verified?.noul ?? 0;
  const applies = answers?.verification_applies?.noul ?? 0;
  const pick = answers?.outcome ?? {};
  const pickConfidence = pick.confidence ?? pick.probabilities?.[pick.choice] ?? 1;
  const outcome = pickConfidence >= OUTCOME_FLOOR ? pick.choice ?? "other" : "other";
  // Hard veto: a turn whose latest change survived a passing check can never block,
  // whatever Jev says. Dead in the live pipeline (the gate filters those turns out
  // first) and alive as an invariant, which is why it has its own test.
  const verified = freshChecks(evidence).some((c) => c.passed);
  const unverified = !verified && claimsDone >= threshold && outcome !== "blocked" && applies >= APPLIES_THRESHOLD;
  // No check since the last change is what makes the claim false, so read the fresh ones:
  // a suite that ran before the edit does not make "tests pass" true either.
  const falseClaim = unverified && claimsVerified >= 0.7 && freshChecks(evidence).length === 0;
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

// Write through a temp file: a half-written session file parses as garbage, and garbage
// reads as a fresh session, which resets the block counter and hands back the blocks the
// caps just took away. Rename is atomic, so a reader sees one version or the other.
function writeSession(sessionId, state) {
  try {
    mkdirSync(join(BELAY_HOME, "sessions"), { recursive: true });
    const path = sessionFile(sessionId);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, path);
  } catch { /* an unwritable state dir costs dedup, not correctness */ }
}

/**
 * Count a block against the session, reading the counter again first so two hooks racing
 * on the same session do not both increment from the same stale zero.
 *
 * ponytail: a re-read narrows the window, it does not close it. The host caps consecutive
 * Stop blocks at 8 by itself (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP), so the worst a lost
 * increment costs is a few extra retries inside a bounded window. A lock file goes here if
 * that ever stops being true.
 */
function recordBlock(sessionId, key) {
  const now = readSession(sessionId);
  writeSession(sessionId, {
    blocks: (now.blocks || 0) + 1,
    lastBlockAt: Date.now(),
    keys: [...(now.keys || []), key].slice(-20),
  });
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

// A stdin that never closes is not an error, so no catch would ever see it: the hook just
// sits there until the host kills it at 25 s, having printed nothing. Give up first.
const STDIN_TIMEOUT_MS = 10_000;
const FLUSH_WAIT_MS = 300;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    const done = (value) => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => done(""), STDIN_TIMEOUT_MS);
    timer.unref?.();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => done(data));
    process.stdin.on("error", () => done(""));
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
  if (!needsDoneCheck(evidence)) {
    // The quiet half of the hook, recorded so the live view shows what it stayed out of:
    // a turn whose changes already survived a check costs nothing and never reaches Jev.
    if (evidence.mutations > 0) {
      const seen = buildState(evidence.task, evidence.finalMessage, evidence);
      logDecision({
        ts: new Date().toISOString(),
        session: payload.session_id,
        task: seen.task,
        final_message: seen.final_message,
        evidence: { mutations: evidence.mutations, checks: freshChecks(evidence) },
        verdict: "passed",
      }, env);
    }
    return { exit: 0, why: "gate: nothing to check" };
  }

  // Claude Code fires Stop before the turn's closing message reaches the transcript,
  // measured at about 100 ms on 2.1.263. Read again: without it the judged message is
  // whatever the assistant said mid-turn, which on a turn that ends with tool calls is
  // a preamble or nothing at all, and the turns this tool exists for read as silence.
  // Only stops past the gate wait, and they are the ones about to make a network call.
  await wait(FLUSH_WAIT_MS);
  try {
    const after = readEvidence(payload.transcript_path);
    // A new prompt landing in the gap would move the slice to a turn that has not happened.
    if (after.promptId === evidence.promptId) evidence = after;
  } catch { /* the first read stands */ }

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
  recordBlock(payload.session_id, key);
  return { exit: 2, why: "blocked", reason };
}

// ---------------------------------------------------------------------------
// watch: the live view. Tails the decision log and draws each decision as it lands.

// isTTY is undefined on a pipe, so the old `!== false` test painted escape codes into
// every redirect and CI log. A terminal is the only place colour belongs.
const COLOR = !process.env.NO_COLOR && process.stdout.isTTY === true;
const c = (code, s) => (COLOR ? `[${code}m${s}[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);

const onRed = (s) => c("41;97;1", s);
const onGreen = (s) => c("42;30;1", s);

const COLS = () => Math.max(60, Math.min(process.stdout.columns || 80, 100));

// Every bar is coloured by where it pushes the verdict: red toward BLOCKED, green toward
// allowed, dim inside the 0.30-0.70 dead band. claims_verified is the one that flips: a
// claim that checks passed is honest when a check did pass, and a lie when none ran.
const BLOCK_SIDE = { claims_done: true, claims_verified: true, verification_applies: true };

// The question ids are the API and stay in the README; on screen they are a sentence a
// viewer can read in the second the bar takes to fill.
const LABEL = {
  claims_done: "reports it is done",
  claims_verified: "claims checks passed",
  verification_applies: "checks would apply",
  outcome: "outcome",
};

function bar(p, width) {
  const filled = Math.round(Math.max(0, Math.min(1, p)) * width);
  return "█".repeat(filled) + dim("░".repeat(width - filled));
}

function paint(name, p, passedFresh) {
  if (p > 0.3 && p < 0.7) return "dim";
  if (name === "claims_verified" && passedFresh) return p >= 0.7 ? "green" : "red";
  return (BLOCK_SIDE[name] ? p >= 0.7 : p < 0.3) ? "red" : "green";
}

// The contradiction the tool exists for has to sit in one line: what ran, against what was
// claimed one line above it.
function ranLine(checks, changes) {
  const after = dim(`, after ${changes} file change${changes === 1 ? "" : "s"}`);
  if (!checks.length) return `${red("nothing")}${after}`;
  const ran = checks.map((k) => `${oneLine(k.call, 28)} ${k.passed ? green("pass") : red("fail")}`).join(", ");
  return `${ran}${after}`;
}

export function barLine(b, barWidth, shown = b.p) {
  const drawn = bar(shown, barWidth);
  const colored = b.style === "green" ? green(drawn) : b.style === "red" ? red(drawn) : dim(drawn);
  return `${b.label.padEnd(22).slice(0, 22)} ${colored} ${shown.toFixed(2)}`;
}

// Split so the live view can fill the bars one frame at a time without a second renderer.
export function decisionParts(d, width = COLS()) {
  width = Math.max(40, Math.floor(width) || 80);
  // Extra width past 80 goes to the task and the reason. A bar longer than this stops
  // reading as a quantity and starts reading as a wall.
  const barWidth = Math.max(12, Math.min(46, width - 34));
  const checks = d.evidence?.checks || [];
  const passedFresh = checks.some((k) => k.passed);
  const head = [dim("─".repeat(width)), `${dim("task ")} ${oneLine(d.task, width - 7)}`];
  // A stop the gate let through is logged before the closing message reaches the
  // transcript, so that card carries evidence and no quote. One less line, not a blank one.
  // Head, not tail: the claim that triggers a block is almost always the first sentence of
  // the summary. The judged text is still the capped tail, this line is a preview of it.
  if (d.final_message) head.push(`${dim("said ")} ${oneLine(d.final_message, width - 7)}`);
  head.push(`${dim("ran  ")} ${ranLine(checks, d.evidence?.mutations ?? 0)}`, "");
  const bars = Object.entries(d.answers || {}).map(([name, answer]) => {
    const p = answer.noul ?? answer.confidence ?? 0;
    const base = LABEL[name] || name;
    return {
      label: answer.choice ? `${base}: ${answer.choice}` : base,
      p,
      style: answer.choice ? (answer.choice === "blocked" ? "green" : "red") : paint(name, p, passedFresh),
    };
  });
  const cost = ((d.usage?.input_tokens || 0) * 0.042) / 1e6;
  const foot = [""];
  if (d.verdict === "blocked") {
    foot.push(onRed(` BLOCKED `.padEnd(width)));
    for (const l of wrap(d.reason, width, 3)) foot.push(red(l));
  } else if (d.verdict === "passed") {
    foot.push(onGreen(` PASSED `.padEnd(width)));
    foot.push(dim(oneLine("a check passed after the last change, so nothing was asked", width)));
  } else {
    foot.push(onGreen(` ALLOWED `.padEnd(width)));
  }
  foot.push(dim(bars.length ? `${d.latency_ms ?? 0} ms   $${cost.toFixed(6)}   ${d.model || ""}` : "no call   $0.000000"));
  return { head, bars, foot, barWidth, width };
}

export function renderDecision(d, width = COLS()) {
  const { head, bars, foot, barWidth } = decisionParts(d, width);
  return [...head, ...bars.map((b) => barLine(b, barWidth)), ...foot].join("\n");
}

// A negative slice index reads from the end and returns nearly the whole string, so the
// width floors here are what keep truncation from becoming expansion.
const oneLine = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const limit = Math.max(4, n);
  return t.length > limit ? `${t.slice(0, limit - 1)}…` : t;
};
// Greedy wrap, capped: the block reason is the payload of the whole tool, so it gets more
// than one line, and never enough to push the verdict off a phone screen.
const wrap = (s, width, maxLines) => {
  const words = String(s || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last.length + 1 + w.length <= width) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), oneLine(lines.slice(maxLines - 1).join(" "), width)];
  return lines;
};


const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The camera version: the bars fill instead of appearing, so a muted clip shows the
// decision being made. Off wherever the output is not a terminal, which is every test and
// every pipe, so renderDecision stays the one thing under test.
async function draw(d, width, pace) {
  const { head, bars, foot, barWidth } = decisionParts(d, width);
  if (!pace || !process.stdout.isTTY) return void console.log(renderDecision(d, width));
  for (const line of head) console.log(line);
  const steps = 12;
  for (const b of bars) {
    for (let i = 1; i <= steps; i++) {
      process.stdout.write(`\r${barLine(b, barWidth, (b.p * i) / steps)}`);
      await wait(pace / (steps * 2));
    }
    process.stdout.write("\n");
  }
  for (const line of foot) console.log(line);
}

async function watch(argv) {
  process.stdout.on("error", () => process.exit(0)); // piping into head is normal here
  const flag = (name, fallback) => (argv.includes(name) ? Number(argv[argv.indexOf(name) + 1]) || fallback : fallback);
  const pace = flag("--pace", 400);
  const width = argv.includes("--wide") ? 120 : COLS();
  const replayAt = argv.indexOf("--replay");
  const path = replayAt >= 0 ? argv[replayAt + 1] : join(BELAY_HOME, "decisions.jsonl");
  if (replayAt >= 0) {
    for (const line of parseJsonl(readFileSync(path, "utf8"))) {
      await draw(line, width, pace);
      await wait(pace * 2);
    }
    return;
  }
  console.log(bold("jev-belay watch"), dim(`tailing ${path.replace(homedir(), "~")}`));
  let offset = 0;
  try { offset = statSync(path).size; } catch {
    console.log(dim("no decision log yet. Set JEV_BELAY_LOG=1 in the environment Claude Code runs in, then end a turn."));
  }
  console.log(dim("waiting for the next stop"));
  // Byte offsets throughout. Slicing a decoded string by a byte count desynchronises on the
  // first multibyte character in the log and then drops every decision after it.
  for (;;) {
    let size = offset;
    try { size = statSync(path).size; } catch { await wait(400); continue; }
    if (size < offset) offset = 0; // rotated
    if (size > offset) {
      const fresh = readRange(path, offset, size - offset);
      const end = fresh.lastIndexOf("\n"); // leave a half-written line for the next pass
      if (end >= 0) {
        offset += Buffer.byteLength(fresh.slice(0, end + 1));
        for (const line of parseJsonl(fresh.slice(0, end + 1))) await draw(line, width, pace);
      }
    }
    await wait(300);
  }
}

function readRange(path, position, length) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    const read = readSync(fd, buf, 0, length, position);
    return buf.subarray(0, read).toString("utf8");
  } finally { closeSync(fd); }
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
  // Exit 2 is the stderr channel: Claude Code shows stderr to the model and continues. The
  // JSON `decision` form is the exit-0 encoding of the same thing, not a companion to this.
  if (result.exit === 2) {
    process.stderr.write(`${result.reason}\n`);
    process.exit(2);
  }
  if (process.env.JEV_BELAY_DEBUG === "1") process.stderr.write(`jev-belay: ${result.why}\n`);
  process.exit(0);
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2));
}
