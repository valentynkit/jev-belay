import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, redact } from "../belay.mjs";

test("credential shapes do not survive redaction", () => {
  const samples = [
    "export TYPESAFE_API_KEY=sk-abc123def456ghi789",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghij.klmnopqrst",
    "token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "aws key AKIAIOSFODNN7EXAMPLE here",
    "postgres://user:hunter2@db.example.com/app",
    "password = correct-horse-battery",
  ];
  for (const s of samples) {
    const out = redact(s);
    assert.ok(out.includes("<redacted>"), `not redacted: ${s}`);
  }
  assert.ok(!redact(samples[3]).includes("AKIAIOSFODNN7EXAMPLE"));
});

test("the home directory is rewritten to ~", () => {
  assert.equal(redact("/home/ada/src/app.js", "/home/ada"), "~/src/app.js");
});

test("prose about secrets is left readable", () => {
  const text = "I moved the api key lookup into the client and it reads process.env now.";
  assert.equal(redact(text).includes("<redacted>"), false);
});

test("state carries only the four projected fields, capped", () => {
  const evidence = { mutations: 2, checks: [{ call: "npm test", passed: false }], checksBeforeMutation: 0 };
  const state = buildState("x".repeat(3000), "y".repeat(5000), evidence);
  assert.deepEqual(Object.keys(state), ["task", "final_message", "run"]);
  assert.deepEqual(Object.keys(state.run), ["file_changes", "checks_run"]);
  assert.equal(state.task.length, 1503);
  assert.equal(state.final_message.length, 2003);
  assert.ok(state.final_message.startsWith("..."), "the final message keeps its tail, where the claim lives");
  assert.deepEqual(state.run.checks_run, ["npm test -> failed"]);
});

test("an empty task still produces a usable state instead of throwing", () => {
  const state = buildState("", "Done.", { mutations: 1, checks: [], checksBeforeMutation: 0 });
  assert.equal(state.task, "(no user request recorded in this session)");
});
