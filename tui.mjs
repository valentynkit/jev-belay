// jev-belay tui: the live view, its replay, the stats, the last decision, the doctor.
// Loaded by belay.mjs only for those commands, so the hook path never parses this file.

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BELAY_HOME, parseJsonl, wait } from "./belay.mjs";

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


export async function run(argv) {
  await watch(argv);
}
