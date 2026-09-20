import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMAND, classifyToolResult, resetExtraCheck } from "../belay.mjs";

const runners = join(dirname(fileURLToPath(import.meta.url)), "runners");
const output = (name) => readFileSync(join(runners, name), "utf8");

/** Run the belts with one CHECK setting in effect, then put the process back. */
function withCheck(variable, value, body) {
  process.env[variable] = value;
  resetExtraCheck();
  try { body(); } finally {
    delete process.env[variable];
    resetExtraCheck();
  }
}

test("belt 1 knows nextest", () => {
  assert.equal(CHECK_COMMAND.test("cargo nextest run"), true);
  assert.equal(classifyToolResult("Bash", { command: "cargo nextest run" }, false, output("cargo-nextest-pass.txt")), "check-pass");
  assert.equal(classifyToolResult("Bash", { command: "cargo nextest run" }, false, output("cargo-nextest-fail.txt")), "check-fail");
});

test("the CHECK option names the project's own check script", () => {
  withCheck("JEV_BELAY_CHECK", "^\\./check\\.sh", () => {
    assert.equal(classifyToolResult("Bash", { command: "./check.sh" }, false, ""), "check-pass");
    assert.equal(classifyToolResult("Bash", { command: "./check.sh" }, false, output("pytest-fail.txt")), "check-fail");
  });
});

test("the CHECK option arrives from the plugin's user config too", () => {
  withCheck("CLAUDE_PLUGIN_OPTION_CHECK", "^\\./check\\.sh", () => {
    assert.equal(classifyToolResult("Bash", { command: "./check.sh" }, false, ""), "check-pass");
  });
});

// Fail open: a setting nobody can compile leaves the hook where it was, silently.
test("a CHECK option that is not a regex is ignored, not thrown", () => {
  withCheck("JEV_BELAY_CHECK", "(", () => {
    assert.equal(classifyToolResult("Bash", { command: "./check.sh" }, false, ""), "unknown");
  });
});

test("a compile error is a failed check, whoever ran the compiler", () => {
  assert.equal(classifyToolResult("Bash", { command: "cargo check" }, false, output("cargo-check-fail.txt")), "check-fail");
  // Belt 2 alone, exactly as it answers for a runner launched inside a script.
  assert.equal(classifyToolResult("Bash", { command: "./build-all" }, false, output("cargo-check-fail.txt")), "check-fail");
});
