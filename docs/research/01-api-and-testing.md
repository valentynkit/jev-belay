# Jev / TypeSafe System One: wire format, gateway path, and test infrastructure

Sources linked inline. Unconfirmed claims are flagged rather than guessed.

## 1. Direct API wire format

Endpoint: `POST https://api.typesafe.ai/v1/systemone` ([api.md](https://docs.typesafe.ai/api.md); path and default base URL also hardcoded in the Python SDK as `SYSTEM_ONE_PATH = "/v1/systemone"` and `DEFAULT_BASE_URL = "https://api.typesafe.ai"` in [`_core/constants.py`](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-python/main/src/typesafe_sdk/_core/constants.py) / [`constants.py`](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-python/main/src/typesafe_sdk/constants.py)).

Auth: `Authorization: Bearer <api_key>` plus `Accept: application/json`, confirmed in the Python transport source ([`_core/transport.py`](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-python/main/src/typesafe_sdk/_core/transport.py)).

**Request** (fields per the JS SDK's `SystemOneRequest`/`SystemOneRequestPayload` in [`src/types.ts`](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/types.ts), matching the Python `question_types.py`):

```json
{
  "model": "jev-latest",
  "state": "The support agent issued a full refund to the customer.",
  "questions": {
    "refunded": { "type": "noul", "instructions": "Was a refund issued?" },
    "route": {
      "type": "choice",
      "instructions": "Route this ticket.",
      "criteria": { "billing": "payment problems", "shipping": "delivery problems", "other": null }
    },
    "quality": {
      "type": "score",
      "instructions": "Rate the response quality.",
      "criteria": ["poor", "fair", "good", "excellent"]
    }
  }
}
```

`state` and `questions` are required; `model` is optional at the SDK level (falls back to `defaultModel`/`jev-latest`) but required in the resolved wire payload. `state`/`instructions`/`criteria` all take the same `EntryType`: string, JSON object, array, or `null` ([types.ts](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/types.ts)). Discrepancy: [primitives/noul.md](https://docs.typesafe.ai/primitives/noul.md) calls `instructions` required, but both SDKs' types mark it optional (defaults to `null`) — trust the SDK types.

Choice: `criteria` is a map of label → description (or `null`), **up to 255 options** ([primitives/choice.md](https://docs.typesafe.ai/primitives/choice.md)); "other"/abstain is a convention, not a field — add an `"other"` key yourself. Score: `criteria` is an **ordered array, 2–10 levels**, indexed from zero (2-minimum enforced in `validateQuestions`, [questions.ts](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/questions.ts); the 10-max is documented in [primitives/score.md](https://docs.typesafe.ai/primitives/score.md) but not something I found enforced in source).

**Response** (per [api.md](https://docs.typesafe.ai/api.md) and the Python `response_types.py`):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "refunded": { "type": "noul", "noul": 0.99 },
    "route": { "type": "choice", "choice": "billing", "confidence": 0.97, "probabilities": {"billing": 0.97, "shipping": 0.02, "other": 0.01} },
    "quality": { "type": "score", "score": 2.4, "confidence": 0.61, "legend": {"0": "poor", "1": "fair", "2": "good", "3": "excellent"}, "probabilities": {"0": 0.0, "1": 0.1, "2": 0.6, "3": 0.3} }
  },
  "usage": { "input_tokens": 142, "output_tokens": 0 }
}
```

Noul answers have no `confidence` field — the `noul` probability itself carries that ([confidence.md](https://docs.typesafe.ai/confidence.md)). `usage` fields can be `None` when the API doesn't report them ([response_types.py](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-python/main/src/typesafe_sdk/_core/response_types.py)).

**Errors**: [api.md](https://docs.typesafe.ai/api.md) documents 401, 422, 429, 529. The SDK's hierarchy is broader — [`errors.ts`](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/errors.ts) maps 400/401/403/404/422/429 to named errors and ≥500 (529 included) to `InternalServerError`. `RateLimitError` carries `retryAfterMs`/`retry_after_ms` from `retry-after`/`retry-after-ms` headers. Error bodies use `{error}`, `{message}`, or `{detail}` (FastAPI-style `{loc, msg}` list for validation).

**Limits** ([models.md](https://docs.typesafe.ai/models.md)): 64k tokens total context, 32k reserved for `state` plus the longest question; 250,000 tokens/sec and 1,200 req/min rate limit (adjusts dynamically); text only. **Aliases**: `jev-latest`/`jev-preview` both point at `jev-1.13.0`; pin the versioned ID if tuning thresholds, since aliases move. **Pricing**: $0.042/1M input tokens, output free.

```bash
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"jev-latest","state":"The build failed with exit code 1.",
       "questions":{"passed":{"type":"noul","instructions":"Did the build succeed?"}}}'
```

## 2. Vercel AI Gateway path

Model id: `typesafe-ai/jev` ([changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), [model page](https://vercel.com/ai-gateway/models/jev)). Pricing: $0.042/1M input tokens, output free ("Maximum output tokens: 0") — same as direct.

Critically, the [Evaluation modality doc](https://vercel.com/docs/ai-gateway/modalities/evaluation) states outright: **"Evaluation is available through the AI SDK only. It is not supported through the OpenAI-compatible, Anthropic-compatible, or Cohere-compatible endpoints."** The REST reference ([sdks-and-apis/rest-api](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api)) lists only `/v1/models`, `/v1/models/{creator}/{model}/endpoints`, `/v1/credits`, `/v1/generation`, `/v1/report` — no evaluation endpoint. (A web search surfaced a claimed `/v4/ai/evaluation-model` path with gateway-protocol headers; I could not verify it against any Vercel-owned source and it conflicts with the "AI SDK only" statement, so treat it as unconfirmed.)

The only confirmed way to call Jev via the gateway is `experimental_evaluate` (AI SDK ≥7.0.105, `ai` npm package) — no curl:

```typescript
import { experimental_evaluate as evaluate } from 'ai';

const result = await evaluate({
  model: 'typesafe-ai/jev', // or gateway.evaluationModel('typesafe-ai/jev')
  state: 'The build failed with exit code 1.',
  questions: { passed: { type: 'boolean', instructions: 'Did the build succeed?' } },
});
// { passed: { type: 'boolean', probability: 0.01 } }
```

Auth: `AI_GATEWAY_API_KEY` env var / `Authorization: Bearer <key>` header ([sdks-and-apis/ai-sdk](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk)). Differences from direct API: question `type` is `"boolean"` not `"noul"`, the boolean answer field is `probability` not `noul`, and `usage` is camelCase. Given no TypeSafe key yet, plugins needing the direct wire shape (Neovim/git-hook/emulator) should target the direct API once a key exists; only Node-based tools can use the gateway path at all, and only through the SDK function, never a bare HTTP call.

## 3. Fake Jev for offline tests

Fixture format — flat JSON, question name → answer object matching the real shape, so a fake server just echoes it:

```json
{ "refunded": {"type": "noul", "noul": 0.99},
  "route": {"type": "choice", "choice": "billing", "confidence": 0.9, "probabilities": {"billing": 0.9, "shipping": 0.1}} }
```

Node (`fake-jev.js`, 15 lines):
```js
const http = require('http');
const fixtures = require('./fixtures.json'); // { questionName: answer }
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const { model = 'jev-latest', questions = {} } = JSON.parse(body || '{}');
    const answers = {};
    for (const name of Object.keys(questions)) answers[name] = fixtures[name];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model, answers, usage: { input_tokens: 0, output_tokens: 0 } }));
  });
}).listen(process.env.PORT || 4321);
```

Python (`fake_jev.py`, 15 lines):
```python
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer
fixtures = json.load(open("fixtures.json"))

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"] or 0)))
        answers = {n: fixtures[n] for n in body.get("questions", {})}
        out = json.dumps({"model": body.get("model", "jev-latest"), "answers": answers,
                           "usage": {"input_tokens": 0, "output_tokens": 0}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.end_headers(); self.wfile.write(out)

HTTPServer(("", int(os.environ.get("PORT", 4321))), Handler).serve_forever()
```

Point a plugin's base URL (`TYPESAFE_BASE_URL`, a real env override per [constants.py](https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-python/main/src/typesafe_sdk/constants.py)) at `http://localhost:4321`.

## 4. Record and replay

Key each fixture by a hash of the exact request body that matters for the answer (`state` + `questions`, excluding `model` if you want cross-model reuse):

```python
import hashlib, json
def cache_key(state, questions):
    blob = json.dumps({"state": state, "questions": questions}, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()
```

A thin recording proxy: on a cache miss, forward to the real endpoint, write `answers` to `fixtures/<hash>.json`, and return it; on a hit, skip the network call. Run it once against your fixed corpus with a real key, commit `fixtures/`, and tests run free and deterministic after — the VCR/cassette pattern, applied to this one endpoint.

## 5. Calibration and thresholds

[confidence.md](https://docs.typesafe.ai/confidence.md) says thresholds are domain-specific ("start with conservative thresholds, test with your own data, and adjust") and gives a three-tier framework: high confidence → act automatically, medium → confirm/flag, low → route to a human. No numeric cutoffs prescribed.

Existing tools: **[jevcal](https://github.com/abhixhek/jevcal)** is the most directly reusable — computes ECE, accepted-accuracy, and coverage-vs-accuracy curves, with `jevcal run --target 0.98` / `jevcal check --lock` to lock and CI-guard thresholds; reuse rather than rebuild. **[jev-benchmarks](https://github.com/AbdelStark/jev-benchmarks)** does multiclass Brier score, NLL, and coverage-under-error-budget — good reference for the math, less so as a dependency. **[jev-harness](https://github.com/AntonioCoppe/jev-harness)** is policy/gating infra (shadow mode, fixtures asserting on the *action*) — useful for the git-hook/Claude-hook decision layer, not calibration. **[system-one-adapter-python](https://github.com/typesafe-ai/system-one-adapter-python)** is an LLM-backed drop-in comparator; no calibration tooling in its README.

Minimal from-scratch recipe if you don't want the jevcal dependency:

```python
def brier(probs, labels):  # both 0/1 floats, same length
    return sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(probs)

def reliability_bins(probs, labels, n=10):
    bins = [[] for _ in range(n)]
    for p, y in zip(probs, labels):
        bins[min(int(p * n), n - 1)].append((p, y))
    return [(sum(p for p, _ in b) / len(b), sum(y for _, y in b) / len(b), len(b))
            for b in bins if b]  # (mean predicted, mean actual, count) per bin

def threshold_sweep(probs, labels, thresholds=(0.5, 0.7, 0.8, 0.9, 0.95, 0.99)):
    for t in thresholds:
        kept = [(p, y) for p, y in zip(probs, labels) if p >= t or p <= 1 - t]
        if not kept:
            continue
        tp = sum(1 for p, y in kept if (p >= 0.5) == bool(y))
        precision = tp / len(kept)
        recall = len(kept) / len(probs)
        print(f"t={t:.2f}  n={len(kept):4d}  precision={precision:.3f}  recall={recall:.3f}")
```

## 6. Known failure modes as test cases

Per [jev-1.13.md](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md) and [state.md](https://docs.typesafe.ai/concepts/state.md):

- **Padded/irrelevant state** — "accuracy falls as the state grows with content unrelated to the decision." Test: same question with/without unrelated padding, assert stability.
- **Adversarial content in state** — steering text can move the answer since state isn't treated as untrusted. Test: inject an instruction-like string, check it doesn't flip a `noul`/`choice` answer.
- **Literal reading** — struggles with negation, scoping words, implied conditions. Test: negated phrasing should (or shouldn't) invert the probability.
- **Counting/numeric/date comparisons** — unreliable; dates read as text, not ordered quantities. Test: any question needing occurrence counts or date comparison.
- **Indirection** — "a property of a property" loses precision. Test: multi-hop vs. single-hop equivalents.
- **Contradictory instructions vs. criteria** — degrades performance. Test with deliberately mismatched fields.
- **No cross-question consistency guarantee** — `noul("X")` and `noul("not X")` aren't guaranteed complementary. Don't assert `p + p_negated == 1`.
- **Non-English state** — CJK and others "currently have lower accuracy" ([state.md](https://docs.typesafe.ai/concepts/state.md)); no size limit beyond the 64k/32k token caps.
