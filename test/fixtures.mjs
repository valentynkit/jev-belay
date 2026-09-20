// Transcript builder for the tests: the same jsonl shape Claude Code writes, minus the
// fields no code path reads.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;

// One clock for the whole process, a second per line, so a subagent step written between
// two parent steps carries timestamps that fall between theirs.
let clock = 0;
const stamp = () => new Date(Date.parse("2026-09-20T12:00:00.000Z") + ++clock * 1000).toISOString();

/**
 * steps: {prompt} | {text} | {slash} | {tool, input, stdout, isError} | {agent, promptId}
 * A tool step writes both the assistant tool_use line and the user tool_result line. An
 * agent step writes its steps to a sibling subagent file instead of into the transcript,
 * which is where Claude Code puts a delegated turn; the file lands on `lines.agents` and
 * `transcriptFile` writes it out.
 *
 * `is_error` is written only when the step asks for it, because that is what Claude Code
 * does: a test runner exiting nonzero leaves no is_error and no exit code anywhere in the
 * record, so a fixture that always carries the flag tests a shape that never occurs.
 */
export function transcript(steps) {
  const lines = [];
  const agents = [];
  let prompt;
  for (const step of steps) {
    if (step.prompt !== undefined) {
      prompt = `p${++counter}`;
      lines.push({ type: "user", promptId: prompt, timestamp: stamp(), message: { role: "user", content: [{ type: "text", text: step.prompt }] } });
      continue;
    }
    // A slash command is logged as a real user line, with a promptId and a bare string body.
    if (step.slash !== undefined) {
      lines.push({ type: "user", promptId: `p${++counter}`, timestamp: stamp(), userType: "external", message: { role: "user", content: `<command-name>${step.slash}</command-name>\n<command-message>${step.slash}</command-message>` } });
      lines.push({ type: "user", promptId: `p${++counter}`, timestamp: stamp(), userType: "external", message: { role: "user", content: `<local-command-stdout>${step.stdout || ""}</local-command-stdout>` } });
      continue;
    }
    if (step.text !== undefined) {
      lines.push({ type: "assistant", timestamp: stamp(), message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: step.text }] } });
      continue;
    }
    if (step.agent !== undefined) {
      // The parent's whole record of a delegated turn: a Task call, and a result once the
      // agent is done. Everything in between is in the agent's own file.
      const task = `t${++counter}`;
      lines.push({ type: "assistant", timestamp: stamp(), message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: task, name: "Task", input: { description: "delegated" } }] } });
      // In an agent file the user lines carry the parent's promptId and the assistant lines
      // carry null, so the first user line is the only thing that names the owner.
      const owner = step.promptId ?? prompt;
      agents.push([
        { type: "user", promptId: owner, isSidechain: true, timestamp: stamp(), message: { role: "user", content: [{ type: "text", text: "delegated task" }] } },
        ...transcript(step.agent).map((l) => ({ ...l, isSidechain: true, promptId: l.type === "user" ? owner : null })),
      ]);
      lines.push({
        type: "user",
        timestamp: stamp(),
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: task }] },
        toolUseResult: { stdout: step.stdout || "delegated work finished", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
      });
      continue;
    }
    const id = `t${++counter}`;
    const result = { type: "tool_result", tool_use_id: id };
    if (step.isError) result.is_error = true;
    lines.push({ type: "assistant", timestamp: stamp(), message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id, name: step.tool, input: step.input || {} }] } });
    lines.push({
      type: "user",
      timestamp: stamp(),
      message: { role: "user", content: [result] },
      toolUseResult: { stdout: step.stdout || "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
    });
  }
  lines.agents = agents;
  return lines;
}

const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

/** Write a transcript, and any subagent files it declared, and return the transcript path. */
export function transcriptFile(steps) {
  const dir = mkdtempSync(join(tmpdir(), "belay-"));
  const path = join(dir, "session.jsonl");
  const lines = transcript(steps);
  writeFileSync(path, jsonl(lines));
  if (lines.agents.length) {
    const subagents = join(dir, "session", "subagents");
    mkdirSync(subagents, { recursive: true });
    lines.agents.forEach((agent, n) => writeFileSync(join(subagents, `agent-${n + 1}.jsonl`), jsonl(agent)));
  }
  return path;
}

export const JEST_PASS = "Tests:       12 passed, 12 total\nSnapshots:   0 total\nTime:        1.2s";
export const JEST_FAIL = "Tests:       2 failed, 10 passed, 12 total\nTime:        1.4s";
export const PYTEST_PASS = "==================== 5 passed in 0.42s ====================";
export const PYTEST_FAIL = "============ 1 failed, 4 passed in 0.51s ============";
export const CARGO_PASS = "running 3 tests\ntest result: ok. 3 passed; 0 failed; 0 ignored";
export const CARGO_FAIL = "test result: FAILED. 1 passed; 2 failed; 0 ignored";
export const GO_PASS = "ok  \tgithub.com/x/y\t0.012s";
export const TSC_FAIL = "src/a.ts(3,10): error TS2345: Argument of type 'string' is not assignable.";
export const TSC_FAIL_5DIGIT = "tsconfig.json(1,1): error TS18003: No inputs were found in config file.";
// A long pytest run appends the wall clock in parentheses, which the first cut of the
// passed-only pattern anchored itself out of.
export const PYTEST_PASS_LONG = "============ 5 passed in 65.43s (0:01:05) ============";
export const VITEST_PASS = " Test Files  2 passed (2)\n      Tests  12 passed (12)\n   Duration  1.20s";
export const VITEST_FAIL = " Test Files  1 failed | 1 passed (2)\n      Tests  2 failed | 10 passed (12)";
export const BUN_PASS = " 3 pass\n 0 fail\nRan 3 tests across 1 files. [12.00ms]";
export const BUN_FAIL = " 1 pass\n 2 fail\nRan 3 tests across 1 files. [14.00ms]";
export const MIX_PASS = "Finished in 0.1 seconds\n5 tests, 0 failures";
export const MIX_FAIL = "Finished in 0.1 seconds\n5 tests, 2 failures";
export const DOTNET_PASS = "Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 8 ms";
export const DOTNET_FAIL = "Failed!  - Failed:     2, Passed:     3, Skipped:     0, Total:     5, Duration: 9 ms";
export const GRADLE_PASS = "BUILD SUCCESSFUL in 3s\n4 actionable tasks: 4 executed";
export const GRADLE_FAIL = "BUILD FAILED in 3s\n2 actionable tasks: 2 executed";
export const MAVEN_PASS = "[INFO] BUILD SUCCESS\n[INFO] Total time:  4.201 s";
export const ESLINT_FAIL = "/tmp/a.js\n  3:1  error  'x' is not defined  no-undef\n\n✖ 3 problems (2 errors, 1 warning)";
export const ESLINT_WARN_ONLY = "/tmp/a.js\n  3:1  warning  unused  no-unused-vars\n\n✖ 1 problem (0 errors, 1 warning)";
