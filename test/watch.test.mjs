// The live view is the demo surface, so it gets the same treatment as the hook: it must
// fit an 80-column pane and it must not throw on a half-written record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.NO_COLOR = "1";
const { renderDecision, decisionParts, barLine, parseJsonl } = await import("../belay.mjs");

const samples = parseJsonl(readFileSync(new URL("../demo/sample-decisions.jsonl", import.meta.url), "utf8"));

// 60 is the square crop the X clip is shot at, 120 the wide one; both are recorded, so
// both are what the layout has to survive.
for (const width of [60, 80, 120]) {
  test(`every sample decision fits a ${width} column pane`, () => {
    assert.equal(samples.length, 5);
    for (const d of samples) {
      for (const line of renderDecision(d, width).split("\n")) {
        assert.ok([...line].length <= width, `${[...line].length} columns at ${width}: ${line}`);
      }
    }
  });
}

test("the verdict, the four bars, and the cost are all on screen", () => {
  const blocked = renderDecision(samples[0], 80);
  assert.match(blocked, /BLOCKED/);
  assert.match(blocked, /\$0\.0000\d+/);
  assert.match(blocked, /104 ms/);
  for (const label of ["reports it is done", "claims checks passed", "checks would apply", "outcome: complete"]) {
    assert.ok(blocked.includes(label), label);
  }
  assert.match(renderDecision(samples[2], 80), /ALLOWED/);
  assert.match(renderDecision(samples[1], 80), /PASSED/);
});

test("the claim and what actually ran are adjacent lines", () => {
  const lines = renderDecision(samples[0], 80).split("\n");
  const said = lines.findIndex((l) => l.startsWith("said"));
  assert.equal(lines[said + 1].startsWith("ran   nothing, after 2 file changes"), true);
  assert.match(renderDecision(samples[4], 80), /ran {3}pytest -q fail, after 4 file changes/);
});

test("the bar length tracks the probability", () => {
  const line = renderDecision(samples[0], 80).split("\n").find((l) => l.startsWith("reports it is done"));
  const filled = [...line].filter((ch) => ch === "█").length;
  const empty = [...line].filter((ch) => ch === "░").length;
  assert.equal(filled + empty, 46);
  assert.equal(filled, Math.round(0.96 * 46));
});

test("a wide pane spends its extra columns on text, not on a longer bar", () => {
  assert.equal(decisionParts(samples[0], 120).barWidth, 46);
  assert.ok(renderDecision(samples[0], 120).includes("make sure the suite passes."));
});

test("a partly filled bar is the same line with fewer blocks", () => {
  const { bars, barWidth } = decisionParts(samples[0], 80);
  const half = barLine(bars[0], barWidth, bars[0].p / 2);
  assert.equal([...half].filter((ch) => ch === "█").length, Math.round(0.48 * 46));
  assert.ok(half.startsWith("reports it is done"));
  assert.ok(half.endsWith("0.48"));
});

test("a long block reason wraps instead of truncating to one line", () => {
  const reason = renderDecision(samples[0], 60).split("\n").filter((l) => l.includes("jev-belay:") || l.startsWith("with") || l.startsWith("the project"));
  assert.ok(reason.length >= 2, "reason should occupy more than one line at 60 columns");
  assert.ok(reason.join(" ").includes("Run the project tests on what you changed."));
});

test("a stop the gate let through renders as a free pass, with no bars", () => {
  const out = renderDecision({
    task: "Fix the CRLF split",
    final_message: "Fixed and the suite is green.",
    evidence: { mutations: 2, checks: [{ call: "npm test", passed: true }] },
    verdict: "passed",
  }, 80);
  assert.match(out, /PASSED/);
  assert.match(out, /no call {3}\$0\.000000/);
  assert.equal(out.includes("█"), false);
});

test("a record missing everything still renders", () => {
  assert.doesNotThrow(() => renderDecision({}, 80));
  assert.doesNotThrow(() => renderDecision({ answers: { claims_done: {} }, evidence: {} }, 80));
});
