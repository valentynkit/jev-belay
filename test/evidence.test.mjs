import { test } from "node:test";
import assert from "node:assert/strict";
import { DONE_HINT, checkSummary, evidenceFromTurn, freshChecks, needsDoneCheck, readEvidence } from "../belay.mjs";
import {
  BUN_FAIL, BUN_PASS, CARGO_FAIL, CARGO_PASS, DOTNET_FAIL, DOTNET_PASS, ESLINT_FAIL, ESLINT_WARN_ONLY,
  GO_PASS, GRADLE_FAIL, GRADLE_PASS, JEST_FAIL, JEST_PASS, MAVEN_PASS, MIX_FAIL, MIX_PASS,
  PYTEST_FAIL, PYTEST_PASS, PYTEST_PASS_LONG, TSC_FAIL, TSC_FAIL_5DIGIT, VITEST_FAIL, VITEST_PASS,
  transcript, transcriptFile,
} from "./fixtures.mjs";

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

test("belt 2 reads the runners belt 1 names but the first cut skipped", () => {
  assert.equal(checkSummary(VITEST_PASS), "pass");
  assert.equal(checkSummary(VITEST_FAIL), "fail");
  assert.equal(checkSummary(BUN_PASS), "pass");
  assert.equal(checkSummary(BUN_FAIL), "fail");
  assert.equal(checkSummary(MIX_PASS), "pass");
  assert.equal(checkSummary(MIX_FAIL), "fail");
  assert.equal(checkSummary(DOTNET_PASS), "pass");
  assert.equal(checkSummary(DOTNET_FAIL), "fail");
  assert.equal(checkSummary(GRADLE_PASS), "pass");
  assert.equal(checkSummary(GRADLE_FAIL), "fail");
  assert.equal(checkSummary(MAVEN_PASS), "pass");
  assert.equal(checkSummary(ESLINT_FAIL), "fail");
  assert.equal(checkSummary(ESLINT_WARN_ONLY), "pass");
  assert.equal(checkSummary(PYTEST_PASS_LONG), "pass");
  assert.equal(checkSummary(TSC_FAIL_5DIGIT), "fail");
});

test("prose that mentions a runner is not a summary", () => {
  for (const s of [
    "I will run the tests next.",
    "5 tests are still missing coverage",
    "the build failed last week, per the issue",
    "Tests: see the plan above",
  ]) assert.equal(checkSummary(s), undefined, s);
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

// The shape that matters most: Claude Code records a test runner's nonzero exit with no
// is_error and no exit code anywhere in the line. Only the runner's own summary says it
// failed, so belt 1 must not answer before belt 2 has read the output.
test("a failing suite that the host never flagged is still not verification", () => {
  const e = turn([
    { prompt: "fix the parser" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { tool: "Bash", input: { command: "npm test" }, stdout: JEST_FAIL },
    { text: "Done, everything works." },
  ]);
  assert.equal(freshChecks(e)[0].passed, false);
  assert.equal(needsDoneCheck(e), true);
});

test("an unflagged failure is caught for every runner belt 1 names", () => {
  for (const stdout of [JEST_FAIL, PYTEST_FAIL, CARGO_FAIL, VITEST_FAIL, BUN_FAIL, MIX_FAIL, DOTNET_FAIL, GRADLE_FAIL]) {
    const e = turn([
      { prompt: "fix it" },
      { tool: "Edit", input: { file_path: "/tmp/a.js" } },
      { tool: "Bash", input: { command: "npm test" }, stdout },
      { text: "Done." },
    ]);
    assert.equal(freshChecks(e)[0].passed, false, stdout.slice(0, 40));
    assert.equal(needsDoneCheck(e), true, stdout.slice(0, 40));
  }
});

test("a slash command mid-turn does not start a new turn", () => {
  const path = transcriptFile([
    { prompt: "add a retry" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { slash: "/model opus", stdout: "Set model to opus" },
    { tool: "Edit", input: { file_path: "/tmp/b.js" } },
    { text: "Done, both files updated." },
  ]);
  const e = readEvidence(path);
  assert.equal(e.task, "add a retry");
  assert.equal(e.mutations, 2);
  assert.equal(needsDoneCheck(e), true);
});

test("a check between two changes is stale for the later one", () => {
  const e = turn([
    { prompt: "two edits" },
    { tool: "Write", input: { file_path: "/tmp/a.rs" } },
    { tool: "Bash", input: { command: "cargo test" }, stdout: CARGO_PASS },
    { tool: "Write", input: { file_path: "/tmp/b.rs" } },
    { text: "Done." },
  ]);
  assert.equal(e.checks.length, 1);
  assert.deepEqual(freshChecks(e), []);
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

// Real transcripts reach tens of MB on a few pasted tool outputs, and this runs on every
// stop, so only the tail is read. The turn has to survive both sides of that boundary.
test("a turn at the end of a huge transcript is still read", () => {
  const filler = "x".repeat(200_000);
  const steps = [{ prompt: "old task" }];
  for (let i = 0; i < 30; i++) steps.push({ tool: "Bash", input: { command: "echo hi" }, stdout: filler });
  steps.push(
    { prompt: "the real task" },
    { tool: "Edit", input: { file_path: "/tmp/a.js" } },
    { text: "Done, all set." },
  );
  const e = readEvidence(transcriptFile(steps));
  assert.equal(e.task, "the real task");
  assert.equal(e.mutations, 1);
  assert.equal(needsDoneCheck(e), true);
});

test("a single turn longer than the tail window falls back to the whole file", () => {
  const filler = "y".repeat(200_000);
  const steps = [{ prompt: "one enormous turn" }, { tool: "Edit", input: { file_path: "/tmp/a.js" } }];
  for (let i = 0; i < 30; i++) steps.push({ tool: "Bash", input: { command: "echo hi" }, stdout: filler });
  steps.push({ text: "Done." });
  const e = readEvidence(transcriptFile(steps));
  assert.equal(e.task, "one enormous turn", "the prompt is outside the tail window");
  assert.equal(e.mutations, 1);
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
