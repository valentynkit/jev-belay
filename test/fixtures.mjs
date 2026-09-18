// Transcript builder for the tests: the same jsonl shape Claude Code writes, minus the
// fields no code path reads.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;

/**
 * steps: {prompt} | {text} | {tool, input, stdout, isError}
 * A tool step writes both the assistant tool_use line and the user tool_result line.
 */
export function transcript(steps) {
  const lines = [];
  for (const step of steps) {
    if (step.prompt !== undefined) {
      lines.push({ type: "user", promptId: `p${++counter}`, message: { role: "user", content: [{ type: "text", text: step.prompt }] } });
      continue;
    }
    if (step.text !== undefined) {
      lines.push({ type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: step.text }] } });
      continue;
    }
    const id = `t${++counter}`;
    lines.push({ type: "assistant", message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id, name: step.tool, input: step.input || {} }] } });
    lines.push({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: Boolean(step.isError) }] },
      toolUseResult: { stdout: step.stdout || "", stderr: "", interrupted: false },
    });
  }
  return lines;
}

/** Write a transcript to a temp file and return its path. */
export function transcriptFile(steps) {
  const dir = mkdtempSync(join(tmpdir(), "belay-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, transcript(steps).map((l) => JSON.stringify(l)).join("\n") + "\n");
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
