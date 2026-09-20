import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSummary } from "../belay.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "runners");
const fixtures = readdirSync(dir).filter((name) => name.endsWith(".txt")).sort();
const read = (name) => readFileSync(join(dir, name), "utf8");

test("belt 2 decides every runner in the zoo", () => {
  assert.ok(fixtures.length > 40, "the zoo is there");
  for (const name of fixtures) {
    const expected = /-pass(\.doc)?\.txt$/.test(name) ? "pass" : "fail";
    assert.equal(checkSummary(read(name)), expected, name);
  }
});

// A clean compile prints nothing a summary rule could read, so only the failing shape is
// captured; belt 1 reads the command for the passing one.
test("a compile error with no runner summary is a failed check", () => {
  for (const name of ["cargo-check-fail.txt", "cargo-clippy-fail.txt", "go-build-fail.txt", "go-vet-fail.txt"]) {
    assert.equal(checkSummary(read(name)), "fail", name);
  }
});

// The compiler rules are last on purpose: a runner that prints the word error inside a
// traceback is still decided by its own summary line.
test("a traceback that says error does not reach the compiler rule", () => {
  assert.equal(checkSummary(read("pytest-fail.txt")), "fail");
  const passingRunWithErrorText = [
    "test_parse (tests.test_x.ParseTest) ... ok",
    "error: connection reset, retrying",
    "============================== 5 passed in 0.31s ===============================",
  ].join("\n");
  assert.equal(checkSummary(passingRunWithErrorText), "pass");
});

test("prose about a runner is still not a summary", () => {
  assert.equal(checkSummary("I will run cargo nextest next, then report back."), undefined);
  assert.equal(checkSummary("5 examples of the pattern are in the docs"), undefined);
});
