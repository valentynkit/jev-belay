// A delegated turn writes its own transcript next to the parent's. Without folding those
// files back in, the parent's record of six rewritten files is one Task result, and the
// gate reads the turn as "nothing changed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "belay-sub-home-"));
const { freshChecks, needsDoneCheck, readEvidence, runHook } = await import("../belay.mjs");
const { CARGO_PASS, transcriptFile } = await import("./fixtures.mjs");
const { projectFile } = await import("../tools/extract-corpus.mjs");
const { startFake, baseUrlOf, DEFAULT_FIXTURES } = await import("../tools/fake-jev.mjs");

const subagentsDir = (path) => join(dirname(path), "session", "subagents");
const payload = (extra) => JSON.stringify({ session_id: `s${Math.random()}`, hook_event_name: "Stop", ...extra });

test("an edit only a subagent made is still the parent's evidence", () => {
  const e = readEvidence(transcriptFile([
    { prompt: "rename the field everywhere" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.js" } }, { text: "Renamed it." }] },
    { text: "Done, the field is renamed." },
  ]));
  assert.equal(e.mutations, 1);
  assert.equal(needsDoneCheck(e), true);
  assert.equal(e.finalMessage, "Done, the field is renamed.");
});

// The whole reason the fold is by timestamp and not by concatenation.
test("a check after the subagent's edit is fresh, and before it is not", () => {
  const after = readEvidence(transcriptFile([
    { prompt: "rename the field" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.rs" } }] },
    { tool: "Bash", input: { command: "cargo test" }, stdout: CARGO_PASS },
    { text: "Done, the suite is green." },
  ]));
  assert.equal(after.mutations, 1);
  assert.deepEqual(freshChecks(after), [{ call: "cargo test", passed: true }]);
  assert.equal(needsDoneCheck(after), false);

  const before = readEvidence(transcriptFile([
    { prompt: "rename the field" },
    { tool: "Bash", input: { command: "cargo test" }, stdout: CARGO_PASS },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.rs" } }] },
    { text: "Done, the suite is green." },
  ]));
  assert.deepEqual(freshChecks(before), [], "the run says nothing about a change made after it");
  assert.equal(needsDoneCheck(before), true);
});

test("a session that delegated nothing reads exactly as before", () => {
  const e = readEvidence(transcriptFile([
    { prompt: "add a retry" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { text: "Done." },
  ]));
  assert.equal(e.mutations, 1);
  assert.equal(needsDoneCheck(e), true);
});

test("an agent file from another prompt belongs to that prompt, not this one", () => {
  const path = transcriptFile([
    { prompt: "first task" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.js" } }] },
    { text: "Done." },
    { prompt: "second task" },
    { tool: "Read", input: { file_path: "/tmp/a.js" } },
    { text: "It reads the header." },
  ]);
  const e = readEvidence(path);
  assert.equal(e.task, "second task");
  assert.equal(e.mutations, 0, "the earlier turn's agent is not this turn's evidence");
});

test("a half-written agent file costs its last line, not the turn", () => {
  const path = transcriptFile([
    { prompt: "rename the field" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.js" } }] },
    { text: "Done." },
  ]);
  appendFileSync(join(subagentsDir(path), "agent-1.jsonl"), '{"type":"user","promptId":"p');
  const e = readEvidence(path);
  assert.equal(e.mutations, 1);
});

test("an agent file no one can read leaves the turn as the parent recorded it", async () => {
  const path = transcriptFile([
    { prompt: "rename the field" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.js" } }] },
    { text: "Done, the field is renamed." },
  ]);
  const dir = subagentsDir(path);
  chmodSync(dir, 0o000);
  try {
    const e = readEvidence(path);
    assert.equal(e.mutations, 0, "unreadable is not a throw, it is no evidence");
    const server = await startFake(DEFAULT_FIXTURES);
    try {
      const result = await runHook({ env: { JEV_BASE_URL: baseUrlOf(server) }, stdin: payload({ transcript_path: path }) });
      assert.equal(result.exit, 0);
      assert.match(result.why, /gate/);
    } finally {
      server.close();
    }
  } finally {
    chmodSync(dir, 0o700);
  }
});

test("a subagent's edit blocks the parent's unverified done, and fails open on garbage", async () => {
  const stdin = payload({ transcript_path: transcriptFile([
    { prompt: "rename the field everywhere" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.js" } }] },
    { text: "Done. Everything is renamed and the tests pass." },
  ]) });
  const server = await startFake(DEFAULT_FIXTURES);
  try {
    const result = await runHook({ env: { JEV_BASE_URL: baseUrlOf(server) }, stdin });
    assert.equal(result.exit, 2);
    assert.match(result.reason, /1 file change/);
  } finally {
    server.close();
  }
  const fetchImpl = async () => new Response(JSON.stringify({ answers: { claims_done: {} }, usage: {} }), { status: 200 });
  const open = await runHook({ env: { JEV_BASE_URL: "http://x" }, stdin, fetchImpl });
  assert.equal(open.exit, 0);
});

test("the extractor folds the same files into its projection", () => {
  const path = transcriptFile([
    { prompt: "rename the field everywhere" },
    { agent: [{ tool: "Edit", input: { file_path: "/tmp/a.js" } }] },
    { text: "Done, the field is renamed." },
  ]);
  const [record] = projectFile(path);
  assert.equal(record.mutations, 1);
  assert.equal(record.needs_done_check, true);
});
