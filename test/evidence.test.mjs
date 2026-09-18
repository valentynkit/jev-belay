import { test } from "node:test";
import assert from "node:assert/strict";
import { DONE_HINT, checkSummary, evidenceFromTurn, freshChecks, needsDoneCheck, readEvidence } from "../belay.mjs";
import { CARGO_FAIL, CARGO_PASS, GO_PASS, JEST_FAIL, JEST_PASS, PYTEST_FAIL, PYTEST_PASS, TSC_FAIL, transcript, transcriptFile } from "./fixtures.mjs";

const turn = (steps) => evidenceFromTurn(transcript(steps).slice(1));

test("belt 2 reads each runner's own summary", () => {
  assert.equal(checkSummary(JEST_PASS), "pass");
  assert.equal(checkSummary(JEST_FAIL), "fail");
  assert.equal(checkSummary(PYTEST_PASS), "pass");
  assert.equal(checkSummary(PYTEST_FAIL), "fail");
  assert.equal(checkSummary(CARGO_PASS), "pass");
  assert.equal(checkSummary(CARGO_FAIL), "fail");
  assert.equal(checkSummary(GO_PASS), "pass");
  assert.equal(checkSummary(TSC_FAIL), "fail");
  assert.equal(checkSummary("hello world"), undefined);
});

test("belt 1 catches the runner in the command text", () => {
  const e = turn([
    { prompt: "add a retry" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { tool: "Bash", input: { command: "npm test" }, stdout: "" },
    { text: "Done, tests pass." },
  ]);
  assert.equal(e.mutations, 1);
  assert.deepEqual(freshChecks(e), [{ call: "npm test", passed: true }]);
});

test("a runner launched inside a script is still a check", () => {
  const e = turn([
    { prompt: "fix the parser" },
    { tool: "Edit", input: { file_path: "/tmp/a.py" } },
    { tool: "Bash", input: { command: "./scripts/ci.sh" }, stdout: PYTEST_PASS },
    { text: "Fixed." },
  ]);
  assert.equal(freshChecks(e).length, 1);
  assert.equal(freshChecks(e)[0].passed, true);
});

test("a failing suite is not verification", () => {
  const e = turn([
    { prompt: "fix the parser" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { tool: "Bash", input: { command: "npm test" }, stdout: JEST_FAIL, isError: true },
    { text: "Done, everything works." },
  ]);
  assert.equal(freshChecks(e)[0].passed, false);
  assert.equal(needsDoneCheck(e), true);
});

test("a check that ran before the last change is stale, not fresh", () => {
  const e = turn([
    { prompt: "tidy up" },
    { tool: "Bash", input: { command: "cargo test" }, stdout: CARGO_PASS },
    { tool: "Write", input: { file_path: "/tmp/b.rs" } },
    { text: "All done." },
  ]);
  assert.equal(e.checks.length, 1);
  assert.deepEqual(freshChecks(e), []);
  assert.equal(needsDoneCheck(e), true);
});

test("a passing check after the last change never reaches the question", () => {
  const e = turn([
    { prompt: "add a test" },
    { tool: "Write", input: { file_path: "/tmp/b.rs" } },
    { tool: "Bash", input: { command: "cargo test" }, stdout: CARGO_PASS },
    { text: "Done, the suite is green." },
  ]);
  assert.equal(needsDoneCheck(e), false);
});

test("an edit with nothing run reaches the question, and claims_done decides", () => {
  // The keyword pre-screen used to drop this turn for free. It also dropped two thirds of
  // the labeled false dones, so the judgment now belongs to Jev, not to a word list.
  const e = turn([
    { prompt: "rename the field" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { text: "I renamed it. I have not run anything yet, want me to?" },
  ]);
  assert.equal(e.mutations, 1);
  assert.equal(needsDoneCheck(e), true);
  assert.equal(DONE_HINT.test(e.finalMessage), false);
});

test("a turn with no file changes never reaches the question", () => {
  const e = turn([
    { prompt: "what does this do?" },
    { tool: "Read", input: { file_path: "/tmp/a.js" } },
    { text: "It parses the header. Confirmed, all good." },
  ]);
  assert.equal(needsDoneCheck(e), false);
});

test("DONE_HINT is loose on the wordings a done claim actually uses", () => {
  for (const s of ["Done.", "Fixed the bug.", "Implemented and working", "all tests passing", "ready for review", "That should work now."]) {
    assert.equal(DONE_HINT.test(s), true, s);
  }
  assert.equal(DONE_HINT.test("Still looking into the timeout."), false);
});

test("readEvidence picks the last turn of a file", () => {
  const path = transcriptFile([
    { prompt: "first task" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { text: "Done." },
    { prompt: "second task" },
    { tool: "Write", input: { file_path: "/tmp/c.js" } },
    { tool: "Bash", input: { command: "npm test" }, stdout: JEST_FAIL, isError: true },
    { text: "Done, tests pass." },
  ]);
  const e = readEvidence(path);
  assert.equal(e.task, "second task");
  assert.equal(e.mutations, 1);
  assert.equal(e.finalMessage, "Done, tests pass.");
  assert.equal(needsDoneCheck(e), true);
});
