// The live view is the demo surface, so it gets the same treatment as the hook: it must
// fit an 80-column pane and it must not throw on a half-written record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.NO_COLOR = "1";
const { renderDecision, parseJsonl } = await import("../belay.mjs");

const samples = parseJsonl(readFileSync(new URL("../demo/sample-decisions.jsonl", import.meta.url), "utf8"));

test("every sample decision fits an 80 column pane", () => {
  assert.equal(samples.length, 5);
  for (const d of samples) {
    for (const line of renderDecision(d, 80).split("\n")) {
      assert.ok([...line].length <= 80, `${[...line].length} columns: ${line}`);
    }
  }
});

test("the verdict, the four bars, and the cost are all on screen", () => {
  const blocked = renderDecision(samples[0], 80);
  assert.match(blocked, /BLOCKED/);
  assert.match(blocked, /\$0\.0000\d+/);
  assert.match(blocked, /104 ms/);
  for (const name of ["claims_done", "claims_verified", "verification_applies", "outcome"]) {
    assert.ok(blocked.includes(name), name);
  }
  assert.match(renderDecision(samples[1], 80), /allowed/);
});

test("the bar length tracks the probability", () => {
  const line = renderDecision(samples[0], 80).split("\n").find((l) => l.startsWith("claims_done"));
  const filled = [...line].filter((ch) => ch === "█").length;
  const empty = [...line].filter((ch) => ch === "░").length;
  assert.equal(filled + empty, 46);
  assert.equal(filled, Math.round(0.96 * 46));
});

test("a record missing everything still renders", () => {
  assert.doesNotThrow(() => renderDecision({}, 80));
  assert.doesNotThrow(() => renderDecision({ answers: { claims_done: {} }, evidence: {} }, 80));
});
