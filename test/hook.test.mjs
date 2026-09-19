// The hook end to end. Every assertion that a turn blocks has a sibling asserting the
// same turn fails open when something goes wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway HOME before belay.mjs is imported: the session guard writes under it.
process.env.HOME = mkdtempSync(join(tmpdir(), "belay-home-"));
const { decide, runHook } = await import("../belay.mjs");
const { CARGO_PASS, JEST_FAIL, transcript, transcriptFile } = await import("./fixtures.mjs");
const { startFake, baseUrlOf, DEFAULT_FIXTURES } = await import("../tools/fake-jev.mjs");

const BLOCKING = [
  { prompt: "add a retry to the fetch helper" },
  { tool: "Edit", input: { file_path: "/tmp/a.js" } },
  { tool: "Bash", input: { command: "npm test" }, stdout: JEST_FAIL, isError: true },
  { tool: "Edit", input: { file_path: "/tmp/a.js" } },
  { text: "Done. The retry is implemented and the tests pass." },
];
const VERIFIED = [
  { prompt: "add a retry to the fetch helper" },
  { tool: "Edit", input: { file_path: "/tmp/a.js" } },
  { tool: "Bash", input: { command: "cargo test" }, stdout: CARGO_PASS },
  { text: "Done. The suite is green." },
];

const payload = (extra) => JSON.stringify({ session_id: `s${Math.random()}`, hook_event_name: "Stop", ...extra });

async function withFake(fixtures, fn) {
  const server = await startFake(fixtures);
  try { return await fn({ JEV_BASE_URL: baseUrlOf(server) }); } finally { server.close(); }
}

test("an unverified done blocks with a reason", async () => {
  const stdin = payload({ transcript_path: transcriptFile(BLOCKING) });
  const result = await withFake(DEFAULT_FIXTURES, (env) => runHook({ env, stdin }));
  assert.equal(result.exit, 2);
  assert.match(result.reason, /jev-belay: reports completion/);
  assert.match(result.reason, /Run the project's tests/);
});

test("a check that failed after the last change is quoted back", async () => {
  const stdin = payload({
    transcript_path: transcriptFile([
      { prompt: "fix the parser" },
      { tool: "Edit", input: { file_path: "/tmp/a.js" } },
      { tool: "Bash", input: { command: "npm test" }, stdout: JEST_FAIL, isError: true },
      { text: "Done, the parser is fixed." },
    ]),
  });
  const result = await withFake(DEFAULT_FIXTURES, (env) => runHook({ env, stdin }));
  assert.equal(result.exit, 2);
  assert.match(result.reason, /The last check that ran failed: npm test/);
});

test("the same stop blocks once, not twice", async () => {
  const stdin = payload({ session_id: "dedup", transcript_path: transcriptFile(BLOCKING) });
  await withFake(DEFAULT_FIXTURES, async (env) => {
    assert.equal((await runHook({ env, stdin })).exit, 2);
    assert.equal((await runHook({ env, stdin })).exit, 0);
  });
});

test("a fresh passing check exits 0 even when Jev is sure the work is done", async () => {
  const stdin = payload({ transcript_path: transcriptFile(VERIFIED) });
  const sure = { ...DEFAULT_FIXTURES, claims_done: { type: "noul", noul: 0.99 } };
  const result = await withFake(sure, (env) => runHook({ env, stdin }));
  assert.equal(result.exit, 0);
  assert.match(result.why, /gate/);
});

test("decide() keeps the veto even when the gate is bypassed", () => {
  const answers = { claims_done: { noul: 0.99 }, claims_verified: { noul: 0.99 }, verification_applies: { noul: 0.99 }, outcome: { choice: "complete" } };
  const verified = { mutations: 2, checks: [{ call: "npm test", passed: true }], checksBeforeMutation: 0 };
  assert.equal(decide(answers, verified).block, false);
  const unverified = { mutations: 2, checks: [], checksBeforeMutation: 0 };
  assert.equal(decide(answers, unverified).block, true);
  assert.equal(decide(answers, unverified).falseClaim, true);
});

test("a blocked outcome is never a block", () => {
  const answers = { claims_done: { noul: 0.99 }, claims_verified: { noul: 0.1 }, verification_applies: { noul: 0.9 }, outcome: { choice: "blocked" } };
  assert.equal(decide(answers, { mutations: 1, checks: [], checksBeforeMutation: 0 }).block, false);
});

// The veto is strong enough that a four-way pick barely above chance must not carry it.
test("a coin-toss outcome does not veto the rest of the answers", () => {
  const unverified = { mutations: 3, checks: [], checksBeforeMutation: 0 };
  const base = { claims_done: { noul: 0.99 }, claims_verified: { noul: 0.95 }, verification_applies: { noul: 0.95 } };
  const noise = { choice: "blocked", confidence: 0.26, probabilities: { complete: 0.25, partial: 0.25, blocked: 0.26, other: 0.24 } };
  assert.equal(decide({ ...base, outcome: noise }, unverified).block, true);
  const sure = { choice: "blocked", confidence: 0.82, probabilities: { complete: 0.1, partial: 0.05, blocked: 0.82, other: 0.03 } };
  assert.equal(decide({ ...base, outcome: sure }, unverified).block, false);
});

test("a stale check does not soften the false claim", () => {
  const answers = { claims_done: { noul: 0.99 }, claims_verified: { noul: 0.95 }, verification_applies: { noul: 0.9 }, outcome: { choice: "complete" } };
  const stale = { mutations: 1, checks: [{ call: "npm test", passed: false }], checksBeforeMutation: 1 };
  const verdict = decide(answers, stale);
  assert.equal(verdict.block, true);
  assert.equal(verdict.falseClaim, true, "nothing ran since the change, so the claim is still false");
});

test("an answer set with nothing in it never blocks", () => {
  const unverified = { mutations: 2, checks: [], checksBeforeMutation: 0 };
  assert.equal(decide({}, unverified).block, false);
  assert.equal(decide(undefined, unverified).block, false);
  assert.equal(decide({ claims_done: {}, outcome: {} }, unverified).block, false);
});

test("a doc-only task is never a block", () => {
  const answers = { claims_done: { noul: 0.99 }, claims_verified: { noul: 0.1 }, verification_applies: { noul: 0.2 }, outcome: { choice: "complete" } };
  assert.equal(decide(answers, { mutations: 1, checks: [], checksBeforeMutation: 0 }).block, false);
});

test("missing prompt_id still dedups, on the session key", async () => {
  const path = transcriptFile(BLOCKING);
  const stdin = payload({ session_id: "no-prompt-id", transcript_path: path });
  await withFake(DEFAULT_FIXTURES, async (env) => {
    const first = await runHook({ env, stdin });
    assert.equal(first.exit, 2);
    assert.equal((await runHook({ env, stdin })).exit, 0);
  });
});

// --- fail open -------------------------------------------------------------

const failsOpen = {
  "unparseable stdin": { stdin: "not json" },
  "empty stdin": { stdin: "" },
  "missing transcript_path": { stdin: payload({}) },
  "unreadable transcript": { stdin: payload({ transcript_path: "/nope/does/not/exist.jsonl" }) },
  "stop_hook_active": { stdin: payload({ stop_hook_active: true, transcript_path: "x" }) },
};

for (const [name, { stdin }] of Object.entries(failsOpen)) {
  test(`fails open: ${name}`, async () => {
    const result = await withFake(DEFAULT_FIXTURES, (env) => runHook({ env, stdin }));
    assert.equal(result.exit, 0);
  });
}

test("fails open: no key and no base url", async () => {
  const result = await runHook({ env: {}, stdin: payload({ transcript_path: transcriptFile(BLOCKING) }) });
  assert.equal(result.exit, 0);
  assert.equal(result.why, "no key");
});

test("fails open: a 500 from Jev", async () => {
  const fetchImpl = async () => new Response("boom", { status: 500 });
  const result = await runHook({ env: { JEV_BASE_URL: "http://x", JEV_BELAY_TIMEOUT_MS: "300" }, stdin: payload({ transcript_path: transcriptFile(BLOCKING) }), fetchImpl });
  assert.equal(result.exit, 0);
  assert.match(result.why, /jev unreachable/);
});

test("fails open: a hanging Jev", async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  const result = await runHook({ env: { JEV_BASE_URL: "http://x", JEV_BELAY_TIMEOUT_MS: "80" }, stdin: payload({ transcript_path: transcriptFile(BLOCKING) }), fetchImpl });
  assert.equal(result.exit, 0);
});

test("fails open: garbage answers", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ answers: { claims_done: {} }, usage: {} }), { status: 200 });
  const result = await runHook({ env: { JEV_BASE_URL: "http://x" }, stdin: payload({ transcript_path: transcriptFile(BLOCKING) }), fetchImpl });
  assert.equal(result.exit, 0);
});

test("an unwritable session directory still blocks and still exits cleanly", async () => {
  const home = mkdtempSync(join(tmpdir(), "belay-ro-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  chmodSync(join(home, ".claude"), 0o500);
  const stdin = payload({ transcript_path: transcriptFile(BLOCKING) });
  const previous = process.env.HOME;
  try {
    const result = await withFake(DEFAULT_FIXTURES, (env) => runHook({ env, stdin }));
    assert.equal(result.exit, 2);
  } finally {
    process.env.HOME = previous;
    chmodSync(join(home, ".claude"), 0o700);
  }
});

test("the decision log stays off unless JEV_BELAY_LOG=1", async () => {
  const home = mkdtempSync(join(tmpdir(), "belay-log-"));
  writeFileSync(join(home, "marker"), "");
  const stdin = payload({ transcript_path: transcriptFile(BLOCKING) });
  const result = await withFake(DEFAULT_FIXTURES, (env) => runHook({ env: { ...env, JEV_BELAY_LOG: "0" }, stdin }));
  assert.equal(result.exit, 2);
});

// Seen for real on 2026-09-19 while recording the demo: Claude Code fired Stop with the
// two Edits on disk and the "Done." text still buffered, so the hook judged an empty
// message and the turn sailed through. Both halves here: the re-read catches the late
// write, and a message that never arrives still fails open.
test("a final message that lands after the Stop fires is what gets judged", async () => {
  // A preamble before the tool calls is the shape that hid this: the slice is not empty,
  // it just ends on the wrong sentence, so the verdict alone cannot catch the bug. Assert
  // on the message that actually left the machine.
  const path = transcriptFile([{ prompt: "add a retry to the fetch helper" }, { text: "I will add the retry now." }, ...BLOCKING.slice(1, -1)]);
  setTimeout(() => appendFileSync(path, JSON.stringify(transcript([BLOCKING.at(-1)])[0]) + "\n"), 80);
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body).state;
    return new Response(JSON.stringify({ model: "fake", answers: DEFAULT_FIXTURES, usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runHook({ env: { TYPESAFE_API_KEY: "k" }, stdin: payload({ transcript_path: path }), fetchImpl });
  assert.equal(sent.final_message, "Done. The retry is implemented and the tests pass.");
  assert.equal(result.exit, 2);
});

test("a turn that edited and truly said nothing claims nothing, so it ends", async () => {
  const silent = { ...DEFAULT_FIXTURES, claims_done: { type: "noul", noul: 0.04 } };
  const result = await withFake(silent, (env) =>
    runHook({ env, stdin: payload({ transcript_path: transcriptFile(BLOCKING.slice(0, -1)) }) }));
  assert.equal(result.exit, 0);
});
