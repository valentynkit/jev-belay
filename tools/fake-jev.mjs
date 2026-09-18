#!/usr/bin/env node
// Fake Jev: answers whatever it is asked with fixed fixtures. No key, no network.
// Usage: node tools/fake-jev.mjs [fixtures.json] [--port 4321]
// Fixtures are question name -> answer object in the real response shape.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { isEntryPoint } from "../belay.mjs";

export const DEFAULT_FIXTURES = {
  claims_done: { type: "noul", noul: 0.94 },
  claims_verified: { type: "noul", noul: 0.88 },
  verification_applies: { type: "noul", noul: 0.91 },
  outcome: { type: "choice", choice: "complete", confidence: 0.87, probabilities: { complete: 0.87, partial: 0.08, blocked: 0.03, other: 0.02 } },
};

// ponytail: --synthetic is a keyword model, not a decision model. It exists so the
// measure/ablation math runs end to end with a signal in it before a Jev key exists.
// Every number it produces is synthetic and measure says so on the line it prints.
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const clamp = (x) => Math.max(0.02, Math.min(0.98, x));

export function syntheticAnswers(state = {}) {
  const message = String(state.final_message || "").toLowerCase();
  const tail = message.slice(-600);
  const task = String(state.task || "").toLowerCase();
  const jitter = ((hash(message + task) % 100) / 100 - 0.5) * 0.12;
  const strong = /\b(done|fixed|implemented|complete|completed|working|works now|ready|in place|sorted)\b/.test(tail);
  const hedge = /\b(still|remaining|todo|next step|blocked|let me know|not yet|want me to|could not|failed|i have not)\b/.test(tail);
  const claimsDone = clamp(0.45 + (strong ? 0.42 : -0.3) + (hedge ? -0.3 : 0.08) + jitter);
  const claimsVerified = clamp(0.15 + (/\b(tests? pass|suite is green|all green|checks? pass|build succeed|passing)\b/.test(message) ? 0.7 : 0) + jitter);
  const applies = clamp(0.5 + (/\b(doc|docs|readme|prose|note|rename|move|delete|question|explain)\b/.test(task) ? -0.32 : 0.35) + jitter);
  const outcome = hedge ? (/\b(blocked|could not|want me to|let me know)\b/.test(tail) ? "blocked" : "partial") : strong ? "complete" : "other";
  const probabilities = { complete: 0.1, partial: 0.1, blocked: 0.1, other: 0.1 };
  probabilities[outcome] = 0.7;
  return {
    claims_done: { type: "noul", noul: Number(claimsDone.toFixed(3)) },
    claims_verified: { type: "noul", noul: Number(claimsVerified.toFixed(3)) },
    verification_applies: { type: "noul", noul: Number(applies.toFixed(3)) },
    outcome: { type: "choice", choice: outcome, confidence: 0.7, probabilities },
  };
}

/** Start the fake on `port` (0 picks a free one). Resolves with the listening server. */
export function startFake(fixtures = DEFAULT_FIXTURES, port = 0) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let request = {};
      try { request = JSON.parse(body || "{}"); } catch { /* answer the questions we know */ }
      const table = fixtures === "synthetic" ? syntheticAnswers(request.state) : fixtures;
      const answers = {};
      for (const name of Object.keys(request.questions || {})) if (table[name]) answers[name] = table[name];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        // Never echo the requested model back: a fixture answer that reports itself as
        // jev-1.13.0 puts a real model's name under a made-up number, on camera included.
        model: fixtures === "synthetic" ? "fake-jev-synthetic" : "fake-jev-fixtures",
        answers,
        usage: { input_tokens: Math.ceil(JSON.stringify(request.state || "").length / 4), output_tokens: 0 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export const baseUrlOf = (server) => `http://127.0.0.1:${server.address().port}`;

if (isEntryPoint(import.meta.url)) {
  const args = process.argv.slice(2);
  const fixtureArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  const portAt = args.indexOf("--port");
  const fixtures = args.includes("--synthetic") ? "synthetic" : fixtureArg ? JSON.parse(readFileSync(fixtureArg, "utf8")) : DEFAULT_FIXTURES;
  const server = await startFake(fixtures, Number(portAt >= 0 ? args[portAt + 1] : process.env.PORT || 4321));
  console.log(`fake jev on ${baseUrlOf(server)}`);
}
