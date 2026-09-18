import { test } from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, ask, buildState } from "../belay.mjs";
import { DEFAULT_FIXTURES, baseUrlOf, startFake } from "../tools/fake-jev.mjs";

const evidence = { mutations: 3, checks: [{ call: "npm test", passed: false }], checksBeforeMutation: 0 };

test("round trip against the fake returns four answers", async () => {
  const server = await startFake();
  try {
    const state = buildState("add a retry", "Done, tests pass.", evidence);
    const res = await ask(state, QUESTIONS, { env: { JEV_BASE_URL: baseUrlOf(server) } });
    assert.deepEqual(Object.keys(res.answers).sort(), ["claims_done", "claims_verified", "outcome", "verification_applies"]);
    assert.equal(res.answers.claims_done.noul, DEFAULT_FIXTURES.claims_done.noul);
    assert.equal(res.answers.outcome.choice, "complete");
    assert.equal(res.model, "jev-1.13.0");
    assert.ok(res.usage.input_tokens > 0);
    assert.ok(res.elapsedMs >= 0);
  } finally { server.close(); }
});

test("the request body is the pinned model, the projected state, and the four questions", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: {}, usage: {} }), { status: 200 });
  };
  await ask(buildState("t", "m", evidence), QUESTIONS, { env: { JEV_BASE_URL: "http://x", TYPESAFE_API_KEY: "k" }, fetchImpl });
  assert.equal(seen.url, "http://x/v1/systemone");
  assert.equal(seen.auth, "Bearer k");
  assert.equal(seen.body.model, "jev-1.13.0");
  assert.deepEqual(Object.keys(seen.body.state), ["task", "final_message", "run"]);
  assert.equal(Object.keys(seen.body.questions).length, 4);
  assert.equal(seen.body.questions.claims_done.type, "noul");
  assert.equal(seen.body.questions.outcome.type, "choice");
  assert.deepEqual(Object.keys(seen.body.questions.outcome.criteria), ["complete", "partial", "blocked", "other"]);
});

test("a 500 is retried, a 400 is not", async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ answers: {}, usage: {} }), { status: 200 });
  };
  await ask({}, QUESTIONS, { env: { JEV_BASE_URL: "http://x" }, fetchImpl: flaky, timeoutMs: 5000 });
  assert.equal(calls, 3);

  calls = 0;
  const bad = async () => { calls++; return new Response("nope", { status: 400 }); };
  await assert.rejects(() => ask({}, QUESTIONS, { env: { JEV_BASE_URL: "http://x" }, fetchImpl: bad }), /HTTP 400/);
  assert.equal(calls, 1);
});

test("the whole call shares one timeout budget", async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  await assert.rejects(() => ask({}, QUESTIONS, { env: { JEV_BASE_URL: "http://x" }, fetchImpl: hang, timeoutMs: 60 }));
});
