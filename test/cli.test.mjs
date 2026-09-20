// The process, not the functions: the two places belay only misbehaves once it is a real
// command line. Both were silent failures, which is why they get their own file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { transcriptFile, JEST_FAIL } from "./fixtures.mjs";
import { startFake, baseUrlOf, DEFAULT_FIXTURES } from "../tools/fake-jev.mjs";

const BELAY = fileURLToPath(new URL("../belay.mjs", import.meta.url));

function run(script, args, { env = {}, stdin = "", timeoutMs = 8000 } = {}) {
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

// Node resolves import.meta.url through symlinks; argv[1] arrives as typed. A plugin
// installed behind one used to exit 0 without reading stdin, which looks exactly like a
// turn that had nothing to check.
test("the hook still runs when it is invoked through a symlink", async () => {
  const dir = mkdtempSync(join(tmpdir(), "belay-link-"));
  const link = join(dir, "belay.mjs");
  symlinkSync(BELAY, link);
  const server = await startFake(DEFAULT_FIXTURES);
  try {
    const stdin = JSON.stringify({
      session_id: `link-${Math.random()}`,
      hook_event_name: "Stop",
      transcript_path: transcriptFile([
        { prompt: "add a retry to the fetch helper" },
        { tool: "Edit", input: { file_path: "/tmp/a.js" } },
        { tool: "Bash", input: { command: "npm test" }, stdout: JEST_FAIL },
        { text: "Done. The retry is implemented and the tests pass." },
      ]),
    });
    const env = { HOME: dir, JEV_BASE_URL: baseUrlOf(server) };
    assert.deepEqual(
      await run(link, [], { env, stdin }).then((r) => [r.code, /jev-belay:/.test(r.stderr)]),
      [2, true],
    );
    // The fail-open sibling: the same path, garbage in.
    assert.equal((await run(link, [], { env, stdin: "not json" })).code, 0);
  } finally {
    server.close();
  }
});

// The log is utf8 and the render itself emits arrows and block glyphs, so a byte count and
// a character index diverge on the first non-ASCII decision and every later one is lost.
test("watch keeps tailing after a multibyte decision", async () => {
  const home = mkdtempSync(join(tmpdir(), "belay-watch-"));
  const logDir = join(home, ".claude", "belay");
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, "decisions.jsonl");
  const decision = (task) => `${JSON.stringify({ task, final_message: "Done.", evidence: { mutations: 1, checks: [] }, answers: { claims_done: { noul: 0.9 } }, verdict: "allowed", latency_ms: 10, usage: {}, model: "fake" })}\n`;
  writeFileSync(log, "");

  const child = spawn(process.execPath, [BELAY, "watch"], { env: { ...process.env, HOME: home, NO_COLOR: "1" } });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await settle(500);
    appendFileSync(log, decision("café → 日本語 accents"));
    await settle(700);
    appendFileSync(log, decision("plain ascii after"));
    await settle(700);
  } finally {
    child.kill("SIGKILL");
  }
  assert.match(out, /café/);
  assert.match(out, /plain ascii after/, "the line after a multibyte record still renders");
});

// Shadow mode speaks through the JSON channel: exit 0, one systemMessage line on stdout
// for the user, and nothing on stderr for the model. Its fail-open sibling: the same run
// with garbage on stdin prints no message at all.
test("shadow mode prints a systemMessage and exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "belay-shadow-"));
  const server = await startFake(DEFAULT_FIXTURES);
  try {
    const stdin = JSON.stringify({
      session_id: `shadow-${Math.random()}`,
      hook_event_name: "Stop",
      transcript_path: transcriptFile([
        { prompt: "add a retry to the fetch helper" },
        { tool: "Edit", input: { file_path: "/tmp/a.js" } },
        { text: "Done. The retry is implemented and the tests pass." },
      ]),
    });
    const env = { HOME: dir, JEV_BASE_URL: baseUrlOf(server), JEV_BELAY_SHADOW: "1" };
    const r = await run(BELAY, [], { env, stdin });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.match(JSON.parse(r.stdout).systemMessage, /^jev-belay would have blocked this turn: reports completion/);
    const bad = await run(BELAY, [], { env, stdin: "not json" });
    assert.deepEqual([bad.code, bad.stdout], [0, ""]);
  } finally {
    server.close();
  }
});
