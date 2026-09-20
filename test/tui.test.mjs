// stats, last and doctor as commands, because that is the only way they are ever used and
// the only way their exit codes are visible. Each runs against a temp HOME, so the log and
// the settings a check reads are the ones the test wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BELAY = fileURLToPath(new URL("../belay.mjs", import.meta.url));

function run(script, args, { env = {}, stdin = "", timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(stdin);
  });
}

// Every key variable is cleared by name: the machine running the suite has a real key in
// its environment and the no-key test has to see none.
const CLEAN = {
  NO_COLOR: "1",
  CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: "",
  TYPESAFE_API_KEY: "",
  JEV_API_KEY: "",
  JEV_BASE_URL: "",
  JEV_BELAY_LOG: "",
  JEV_BELAY_THRESHOLD: "",
  JEV_BELAY_SHADOW: "",
};

function tempHome(records = []) {
  const home = mkdtempSync(join(tmpdir(), "belay-tui-"));
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  if (records.length) {
    mkdirSync(join(home, ".claude", "belay"), { recursive: true });
    writeFileSync(join(home, ".claude", "belay", "decisions.jsonl"), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
  }
  return home;
}

const daysAgo = (n, hour = 12) => {
  const at = new Date();
  at.setDate(at.getDate() - n);
  at.setHours(hour, 0, 0, 0);
  return at.toISOString();
};

const decision = (verdict, ts, extra = {}) => ({
  ts,
  session: "t",
  task: `a task judged ${verdict}`,
  final_message: "Done.",
  evidence: { mutations: 1, checks: [] },
  verdict,
  ...extra,
});

const judged = { answers: { claims_done: { type: "noul", noul: 0.9 } }, latency_ms: 120, usage: { input_tokens: 400 }, model: "fake-jev-fixtures" };

test("stats counts the four verdicts and totals the cost", async () => {
  const home = tempHome([
    decision("passed", daysAgo(2)),
    decision("blocked", daysAgo(2), { ...judged, reason: "jev-belay: nothing ran." }),
    decision("allowed", daysAgo(1), judged),
    decision("allowed", daysAgo(1), judged),
    decision("shadow", daysAgo(0), { ...judged, reason: "jev-belay: nothing ran." }),
    decision("blocked", daysAgo(0), { ...judged, reason: "jev-belay: nothing ran." }),
  ]);
  const { code, stdout } = await run(BELAY, ["stats"], { env: { ...CLEAN, HOME: home } });
  assert.equal(code, 0);
  assert.match(stdout, /stops\s+6/);
  assert.match(stdout, /1 passed {3}2 allowed {3}2 blocked {3}1 shadow/);
  // Five judged records at 400 input tokens, and the free pass costs nothing.
  assert.match(stdout, /\$0\.000084/);
  assert.match(stdout, /calls/);
  assert.match(stdout, /120 ms/);
  assert.match(stdout, /last 14 days, blocked\/total/);
  assert.match(stdout, /1\/2/);
});

test("--days narrows the window, and a window with nothing in it says so", async () => {
  const home = tempHome([decision("blocked", daysAgo(20), judged), decision("allowed", daysAgo(1), judged)]);
  assert.match((await run(BELAY, ["stats", "--days", "5"], { env: { ...CLEAN, HOME: home } })).stdout, /stops\s+1/);
  const old = tempHome([decision("blocked", daysAgo(20), judged)]);
  const out = await run(BELAY, ["stats", "--days", "5"], { env: { ...CLEAN, HOME: old } });
  assert.equal(out.code, 0);
  assert.match(out.stdout, /no decisions in the last 5 days/);
});

test("stats with no log says how to turn it on and still exits 0", async () => {
  const { code, stdout } = await run(BELAY, ["stats"], { env: { ...CLEAN, HOME: tempHome() } });
  assert.equal(code, 0);
  assert.match(stdout, /no decision log yet\. Set JEV_BELAY_LOG=1/);
});

test("last renders the final record, and says nothing is logged when nothing is", async () => {
  const home = tempHome([
    decision("allowed", daysAgo(1), judged),
    decision("blocked", daysAgo(0), { ...judged, task: "the one that should print", reason: "jev-belay: reports completion (0.90) after 1 file change with no test run. Run the tests." }),
  ]);
  const { code, stdout } = await run(BELAY, ["last"], { env: { ...CLEAN, HOME: home } });
  assert.equal(code, 0);
  assert.match(stdout, /the one that should print/);
  assert.match(stdout, /BLOCKED/);
  assert.equal(stdout.includes("a task judged allowed"), false);

  const empty = await run(BELAY, ["last"], { env: { ...CLEAN, HOME: tempHome() } });
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /no decision log yet/);
});

// PATH is emptied so the claude check has to take its skip branch; node is spawned by
// absolute path, so nothing else in the run needs it.
test("doctor passes on a wired up install and never prints the key", async () => {
  const env = { ...CLEAN, HOME: tempHome(), TYPESAFE_API_KEY: "sk-not-a-real-key", PATH: "/nonexistent" };
  const { code, stdout } = await run(BELAY, ["doctor"], { env });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /ok {4}node \d+\.\d+/);
  assert.match(stdout, /ok {4}key from TYPESAFE_API_KEY/);
  assert.equal(stdout.includes("sk-not-a-real-key"), false);
  assert.match(stdout, /skip {2}claude code version/);
  assert.match(stdout, /skip {2}hook registered/);
  assert.match(stdout, /ok {4}transcripts readable/);
  assert.match(stdout, /ok {4}options: threshold 0\.65, log off, shadow off, model /);
  assert.match(stdout, /ok {4}round trip: a claimed done with nothing run was blocked/);
});

test("doctor fails on a missing key and names the two fixes", async () => {
  const { code, stdout } = await run(BELAY, ["doctor"], { env: { ...CLEAN, HOME: tempHome(), PATH: "/nonexistent" } });
  assert.equal(code, 1);
  assert.match(stdout, /FAIL {2}key: answer the plugin's TypeSafe API key prompt/);
  assert.match(stdout, /settings\.json/);
  // The fail-open sibling of the exit 1: every other check still ran and printed.
  assert.match(stdout, /ok {4}round trip/);
});

test("doctor sees the hook in settings.json and the plugin in enabledPlugins", async () => {
  const settings = (body) => {
    const home = tempHome();
    writeFileSync(join(home, ".claude", "settings.json"), typeof body === "string" ? body : JSON.stringify(body));
    return home;
  };
  const env = { ...CLEAN, TYPESAFE_API_KEY: "x", PATH: "/nonexistent" };
  const viaHook = settings({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node ~/src/belay.mjs" }] }] } });
  assert.match((await run(BELAY, ["doctor"], { env: { ...env, HOME: viaHook } })).stdout, /ok {4}hook registered \(Stop hook/);
  const viaPlugin = settings({ enabledPlugins: { "jev-belay@claude-plugins-official": true } });
  assert.match((await run(BELAY, ["doctor"], { env: { ...env, HOME: viaPlugin } })).stdout, /ok {4}hook registered \(plugin enabled\)/);
  const broken = settings("{ not json at all");
  assert.match((await run(BELAY, ["doctor"], { env: { ...env, HOME: broken } })).stdout, /skip {2}hook registered/);
});
