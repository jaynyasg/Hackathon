# DECISIONS

The open design choices and why I made them. (Pillars + "does it work" were the bar;
UI polish was explicitly not.)

**Language / stack — TypeScript + Node, one Express service.** Mirrors the reference
harness pattern (typed boundary contract → agent loop → seam validation → guards →
evals) and let me reuse a 2025 tax repo's field map + constants almost verbatim. One
service serves the static chat UI + the API, which is the simplest thing that deploys to
Render.

**LLM — OpenAI `gpt-4o-mini`, behind a one-file abstraction (`src/agent/llm.ts`).**
Cheap (~$0.001 per full return), strong tool-use, and the key was already available.
Swapping provider/model is a one-line change; the harness doesn't otherwise depend on it.

**Tools, not talk (pillar 2).** The agent takes real actions only through validated
function tools: `extract_w2`, `record_taxpayer_info`, `compute_tax_return`,
`generate_1040_pdf`, and `enter_w2_manually`. The model never does arithmetic — the
**only** path to a tax number is the pure `computeForm1040` engine, which makes "never
invent numbers" an architectural guarantee, not a prompt plea.

**Tax computation — a pure, unit-tested engine.** 2025 brackets/standard deductions
(Rev. Proc. 2024-40 + OBBBA); for taxable income under $100k it uses the IRS **Tax
Table** method (tax on the midpoint of the $50 row), which is what the government
actually requires — not the raw bracket formula (they differ by a few dollars).

**Filling the 1040 — `pdf-lib` over the official 2025 form, by AcroForm field name.**
I ported a field map from a maintained 2025 tax repo and *verified it* against the real
`f1040.pdf` (every mapped name must exist) plus a round-trip read-back, so a wrong/stale
field fails a test loudly rather than silently misplacing a number.

**W-2 input — PDF upload, parsed deterministically with an LLM fallback.** Text is
extracted with `pdfjs`, parsed by anchored labels (free + exact for clean W-2s), and if
that fails, an LLM extraction step recovers messy layouts; if even that fails, the agent
asks for Box 1/Box 2 and uses `enter_w2_manually`. I ship a realistic fake W-2
(`assets/sample-w2.pdf`) whose Box 1 (40,000) differs from Box 3/5 (42,000) to prove the
extractor takes federal wages, not Social-Security wages.

**Guardrails (pillar 3) — code + schema + prompt.** Zod validates every inbound request
and every LLM tool-call at the seam; the frozen system prompt bounds scope (2025 federal
1040 only — declines other years/forms/state/advice); the question budget (≤5) is counted,
shown in the UI, and enforced; replies are guarded (fallback/truncation) and SSNs are
never logged or returned to the client.

**Observability (pillar 4) — visible, not just logged.** Every turn records latency,
tokens, $ cost, the exact tool calls, guardrail hits, and the question count; `/api/trace`
exposes p95 latency, $/run, and error rate, and the UI renders a live observation trail so
a judge can *watch* the agent work.

**State — in-memory sessions.** Fine for a demo; the scale-path is Redis/db.

**Hosting — Render free Node web service via `render.yaml` Blueprint.**

**Testing — 31 offline deterministic tests gate `npm run verify` (bound to a Stop hook);
live conversation behavior is checked on demand via `npm run eval:record`** (kept out of
`verify` because it costs tokens and isn't deterministic).

**Explicitly out of scope (noted, not built):** other income (1099/interest), itemizing,
most credits beyond CTC/ODC, multiple W-2s, state returns, and e-filing.
