// jev-belay tui: the live view, its replay, the stats, the last decision, the doctor.
// Loaded by belay.mjs only for those commands, so the hook path never parses this file.

import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  ask, BELAY_HOME, buildState, DEFAULT_THRESHOLD, isOn, MODEL, option, parseJsonl, QUESTIONS, runHook, sessionFile, wait,
} from "./belay.mjs";

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
// Shadow is neither verdict: the band has to read as a block that did not land, so it is
// the same shape in the one colour that is not on the red/green axis.
const onYellow = (s) => c("43;30;1", s);

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

// $0.042 per million input tokens, the price the README quotes.
const costOf = (d) => ((d.usage?.input_tokens || 0) * 0.042) / 1e6;

const NO_LOG = "no decision log yet. Set JEV_BELAY_LOG=1 in the environment Claude Code runs in, then end a turn.";

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
  // A replayed file is whatever the user points at, so every field is optional here.
  const checks = Array.isArray(d.evidence?.checks) ? d.evidence.checks.filter((k) => k && typeof k === "object") : [];
  const passedFresh = checks.some((k) => k.passed);
  const head = [dim("─".repeat(width)), `${dim("task ")} ${oneLine(d.task, width - 7)}`];
  // A stop the gate let through is logged before the closing message reaches the
  // transcript, so that card carries evidence and no quote. One less line, not a blank one.
  // Head, not tail: the claim that triggers a block is almost always the first sentence of
  // the summary. The judged text is still the capped tail, this line is a preview of it.
  if (d.final_message) head.push(`${dim("said ")} ${oneLine(d.final_message, width - 7)}`);
  head.push(`${dim("ran  ")} ${ranLine(checks, d.evidence?.mutations ?? 0)}`, "");
  const bars = Object.entries(d.answers || {}).map(([name, answer]) => {
    const p = Number(answer?.noul ?? answer?.confidence) || 0;
    const base = LABEL[name] || name;
    return {
      label: answer?.choice ? `${base}: ${answer.choice}` : base,
      p,
      style: answer?.choice ? (answer.choice === "blocked" ? "green" : "red") : paint(name, p, passedFresh),
    };
  });
  const cost = costOf(d);
  const foot = [""];
  if (d.verdict === "blocked") {
    foot.push(onRed(` BLOCKED `.padEnd(width)));
    for (const l of wrap(d.reason, width, 3)) foot.push(red(l));
  } else if (d.verdict === "shadow") {
    foot.push(onYellow(` SHADOW `.padEnd(width)));
    for (const l of wrap(d.reason, width, 3)) foot.push(dim(l));
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
    console.log(dim(NO_LOG));
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
// stats and last. Both read the log the hook writes, and neither is worth a crash when it
// is half written, so parseJsonl drops what it cannot read and the rest still counts.

/** Both halves of the log, oldest first: rotation renames the live file to .1. */
function readLog() {
  const out = [];
  for (const path of [join(BELAY_HOME, "decisions.jsonl.1"), join(BELAY_HOME, "decisions.jsonl")]) {
    try { out.push(...parseJsonl(readFileSync(path, "utf8")).filter((r) => r && typeof r === "object")); } catch { /* one half, or neither, is normal */ }
  }
  return out;
}

// Local days, not UTC ones: the row is read against the day the person had, and a stop at
// 9pm belongs to that evening.
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

function table(columns) {
  const widths = columns.map(([head, value]) => Math.max(head.length, value.length) + 3);
  console.log(dim(columns.map(([head], i) => head.padStart(widths[i])).join("")));
  console.log(columns.map(([, value], i) => value.padStart(widths[i])).join(""));
}

// Fourteen cells, oldest left, today right. A day the machine was off should look like
// nothing happened rather than like a clean run, so an empty cell is dim.
function calendar(records) {
  const byDay = new Map();
  for (const d of records) {
    const day = byDay.get(dayKey(d.ts)) || { total: 0, blocked: 0 };
    day.total++;
    if (d.verdict === "blocked") day.blocked++;
    byDay.set(dayKey(d.ts), day);
  }
  const labels = [];
  const cells = [];
  const today = new Date();
  for (let back = 13; back >= 0; back--) {
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const day = byDay.get(dayKey(at)) || { total: 0, blocked: 0 };
    labels.push(String(at.getDate()));
    cells.push(day);
  }
  const width = Math.max(...cells.map((d) => `${d.blocked}/${d.total}`.length), 2) + 2;
  console.log(dim("last 14 days, blocked/total"));
  console.log(dim(labels.map((l) => l.padStart(width)).join("")));
  console.log(cells.map((d) => {
    const cell = `${d.blocked}/${d.total}`.padStart(width);
    return d.total === 0 ? dim(cell) : d.blocked > 0 ? red(cell) : cell;
  }).join(""));
}

function stats(argv) {
  const at = argv.indexOf("--days");
  const days = at >= 0 ? Math.max(1, Number(argv[at + 1]) || 30) : 30;
  const all = readLog();
  const since = Date.now() - days * 86_400_000;
  const records = all.filter((d) => Date.parse(d.ts) >= since);
  if (!records.length) {
    console.log(dim(all.length ? `no decisions in the last ${days} days. Try stats --days ${days * 4}.` : NO_LOG));
    return;
  }
  const count = (verdict) => records.filter((d) => d.verdict === verdict).length;
  // A free pass never reaches the model, so the call count is the answers, not the stops.
  const calls = records.filter((d) => Object.keys(d.answers || {}).length > 0);
  const latencies = records.filter((d) => typeof d.latency_ms === "number").map((d) => d.latency_ms).sort((a, b) => a - b);
  console.log(`${bold("jev-belay stats")} ${dim(`last ${days} days`)}`);
  console.log(`${dim("stops   ")} ${records.length}`);
  console.log([
    `${dim("verdict ")} ${green(`${count("passed")} passed`)}`,
    green(`${count("allowed")} allowed`),
    red(`${count("blocked")} blocked`),
    `${count("shadow")} shadow`,
  ].join("   "));
  console.log("");
  table([
    ["calls", String(calls.length)],
    ["cost", `$${calls.reduce((sum, d) => sum + costOf(d), 0).toFixed(6)}`],
    ["p50", `${quantile(latencies, 0.5)} ms`],
    ["p90", `${quantile(latencies, 0.9)} ms`],
  ]);
  console.log("");
  calendar(records);
}

function last(argv) {
  const records = readLog();
  if (!records.length) {
    console.log(dim(NO_LOG));
    return;
  }
  console.log(renderDecision(records.at(-1), argv.includes("--wide") ? 120 : COLS()));
}

// ---------------------------------------------------------------------------
// doctor. Everything an install can get wrong, in the order it gets wrong, each line short
// enough to paste into an issue. No check may throw: a doctor that dies on its third line
// hides the seven answers underneath it.

const MIN_CLAUDE = "2.1.196";
const KEY_VARS = ["CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY", "TYPESAFE_API_KEY", "JEV_API_KEY", "JEV_BASE_URL"];
const DOCTOR_SESSION = "jev-belay-doctor";

/** Numeric head only, so a prerelease suffix never decides the comparison. */
function versionAtLeast(have, want) {
  const parts = (v) => (String(v).match(/\d+/g) || []).slice(0, 3).map(Number);
  const [a, b] = [parts(have), parts(want)];
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}

function nodeCheck() {
  const version = process.versions.node;
  return Number(version.split(".")[0]) >= 20
    ? ["ok", `node ${version}`]
    : ["FAIL", `node ${version}`, "jev-belay needs node 20 or newer, install it and restart Claude Code"];
}

function keyCheck(env) {
  if (!option(env, "TYPESAFE_API_KEY", "TYPESAFE_API_KEY", "JEV_API_KEY", "JEV_BASE_URL")) {
    return ["FAIL", "key", "answer the plugin's TypeSafe API key prompt, or set TYPESAFE_API_KEY in the env block of ~/.claude/settings.json"];
  }
  // The name, never the value: this output is written to be pasted into an issue.
  return ["ok", `key from ${KEY_VARS.find((name) => env[name])}`];
}

function claudeCheck() {
  let printed;
  try {
    printed = execFileSync("claude", ["--version"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ["skip", "claude code version", "claude is not on PATH here, so the version could not be read"];
  }
  // A wrapper may print its own lines first, so read the version off the line that names
  // Claude Code, and only fall back to the last version-shaped token.
  const version = /(\d+\.\d+\.\d+)\s*\(Claude Code\)/.exec(printed)?.[1] ?? printed.match(/\d+\.\d+\.\d+/g)?.at(-1);
  if (!version) return ["skip", "claude code version", "claude --version printed no version"];
  return versionAtLeast(version, MIN_CLAUDE)
    ? ["ok", `claude code ${version}`]
    : ["FAIL", `claude code ${version}`, `run claude update, the plugin options and skills need ${MIN_CLAUDE} or newer`];
}

// Every settings file Claude Code merges, user and project, since a hook or an enabled
// plugin in any one of them is a working install.
const SETTINGS_FILES = () => [
  join(homedir(), ".claude", "settings.json"),
  join(homedir(), ".claude", "settings.local.json"),
  join(process.cwd(), ".claude", "settings.json"),
  join(process.cwd(), ".claude", "settings.local.json"),
];

function hookCheck() {
  let read = 0;
  for (const path of SETTINGS_FILES()) {
    let settings;
    try { settings = JSON.parse(readFileSync(path, "utf8")); read++; } catch { continue; }
    if (!settings || typeof settings !== "object") continue;
    const short = path.replace(homedir(), "~").replace(process.cwd(), ".");
    if (Object.keys(settings.enabledPlugins || {}).some((name) => name.startsWith("jev-belay@"))) return ["ok", `hook registered (plugin enabled in ${short})`];
    const stop = (Array.isArray(settings.hooks?.Stop) ? settings.hooks.Stop : [])
      .some((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []).some((h) => String(h?.command || "").includes("belay.mjs")));
    if (stop) return ["ok", `hook registered (Stop hook in ${short})`];
  }
  if (!read) return ["skip", "hook registered", "no settings file could be read"];
  return ["FAIL", "hook registered", "enable the plugin with /plugin, or add a Stop hook running belay.mjs to ~/.claude/settings.json"];
}

function transcriptsCheck() {
  const dir = join(homedir(), ".claude", "projects");
  let projects;
  try { projects = readdirSync(dir).length; } catch {
    return ["FAIL", "transcripts", `${dir} is missing or unreadable, so the hook has no evidence to read`];
  }
  return ["ok", `transcripts readable (${projects} project${projects === 1 ? "" : "s"})`];
}

function optionsCheck(env) {
  const threshold = option(env, "THRESHOLD", "JEV_BELAY_THRESHOLD") || String(DEFAULT_THRESHOLD);
  const on = (name, envName) => (isOn(option(env, name, envName)) ? "on" : "off");
  return ["ok", `options: threshold ${threshold}, log ${on("LOG", "JEV_BELAY_LOG")}, shadow ${on("SHADOW", "JEV_BELAY_SHADOW")}, model ${env.JEV_MODEL || MODEL}`];
}

// One turn that has to block: a change, no check, and a closing message that says done.
const DOCTOR_TURN = [
  { type: "user", promptId: "doctor", message: { role: "user", content: [{ type: "text", text: "add a retry to the fetch helper" }] } },
  { type: "assistant", message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "d1", name: "Edit", input: { file_path: "/tmp/fetch.js" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "d1" }] }, toolUseResult: { stdout: "", stderr: "", interrupted: false } },
  { type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done. The retry is in place." }] } },
];

async function roundTripCheck() {
  // ponytail: the round trip borrows the test double, so an install that trimmed tools/
  // reports a FAIL on a healthy hook. The ceiling is a three line stub inside this file.
  const { startFake, baseUrlOf, DEFAULT_FIXTURES } = await import("./tools/fake-jev.mjs");
  const dir = mkdtempSync(join(tmpdir(), "belay-doctor-"));
  const transcript = join(dir, "session.jsonl");
  writeFileSync(transcript, `${DOCTOR_TURN.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const server = await startFake(DEFAULT_FIXTURES);
  // The block counts against the session cap like any other, so the file it leaves has to
  // go: otherwise the second doctor run of the minute is inside the cooldown and reports a
  // broken install.
  const forget = () => { try { unlinkSync(sessionFile(DOCTOR_SESSION)); } catch { /* never written */ } };
  forget();
  try {
    const stdin = JSON.stringify({ session_id: DOCTOR_SESSION, hook_event_name: "Stop", transcript_path: transcript });
    const result = await runHook({ env: { JEV_BASE_URL: baseUrlOf(server) }, stdin });
    return result.exit === 2
      ? ["ok", "round trip: a claimed done with nothing run was blocked"]
      : ["FAIL", "round trip", `the hook answered "${result.why}" where it should have blocked`];
  } finally {
    server.close();
    forget();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function liveCheck(env) {
  const state = buildState("confirm jev answers", "Done, everything works.", { mutations: 1, checks: [], checksBeforeMutation: 0 });
  const answer = await ask(state, QUESTIONS, { env });
  return ["ok", `live call: ${answer.model || MODEL} in ${answer.elapsedMs} ms`];
}

const tag = (status) => (status === "FAIL" ? red("FAIL".padEnd(6)) : status === "ok" ? green("ok".padEnd(6)) : dim("skip".padEnd(6)));

async function doctor(argv, env = process.env) {
  const checks = [
    ["node", () => nodeCheck()],
    ["key", () => keyCheck(env)],
    ["claude code version", () => claudeCheck()],
    ["hook registered", () => hookCheck()],
    ["transcripts", () => transcriptsCheck()],
    ["options", () => optionsCheck(env)],
    ["round trip", () => roundTripCheck()],
  ];
  // The only path in this file that touches the network, and only when it is asked for.
  if (argv.includes("--live")) checks.push(["live call", () => liveCheck(env)]);
  let failed = 0;
  for (const [label, check] of checks) {
    let line;
    try { line = await check(); } catch (err) { line = ["FAIL", label, String(err?.message || err).slice(0, 160)]; }
    const [status, what, detail] = line;
    if (status === "FAIL") failed++;
    console.log(`${tag(status)}${what}${detail ? dim(`: ${detail}`) : ""}`);
  }
  process.exitCode = failed ? 1 : 0;
}

export async function run(argv) {
  if (argv.includes("doctor")) await doctor(argv);
  else if (argv.includes("stats")) stats(argv);
  else if (argv.includes("last")) last(argv);
  else await watch(argv);
}
