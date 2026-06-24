# Agentic 2025 Form 1040 Assistant

A warm, web-based chat agent that takes a W-2, has a short (≤5-question) conversation,
fills an **official IRS 2025 Form 1040**, and returns a downloadable PDF — built on a
harness that makes the four pillars (chat loop, tools, guardrails, observability) real
and visible.

**Live demo:** _set after deploying to Render — see "Deploy" below._

> Educational hackathon demo. Fake test data only — not tax advice, not e-filing.

## Run locally (after install)

```powershell
npm install
$env:OPENAI_API_KEY = "sk-..."   # PowerShell;  bash: export OPENAI_API_KEY=sk-...
npm start                         # -> http://localhost:3000  (set $env:PORT to override)
```

Open the URL, upload `assets/sample-w2.pdf` (a realistic fake W-2), answer the
filing-status question, and download your completed 1040.

### Scripts
| command | what it does |
|---|---|
| `npm start` / `npm run dev` | run the server (dev = hot reload) |
| `npm run verify` | the gate: typecheck + 31 offline tests (deterministic, no network) |
| `npm run eval:record` | live conversation eval (refund, scope refusal, MFJ) — uses OpenAI |
| `npm run gen:w2` | regenerate `assets/sample-w2.pdf` |

## The four pillars (where to point)

- **Chat loop** — `src/agent/loop.ts`, `src/agent/session.ts`: full multi-turn state.
- **Tools** — `src/agent/tools.ts`: 5 validated function tools; the only way numbers or
  PDFs are produced. The math tool calls a pure engine — the LLM never computes.
- **Guardrails** — Zod boundary contract (`src/shared/contract.ts`) validates every
  request and every tool call; frozen scope prompt (`src/agent/prompt.ts`); ≤5-question
  budget (enforced + shown); reply guard (`src/agent/guard.ts`); SSNs never logged/returned.
- **Observability** — `src/agent/observability.ts` + `/api/trace` + the live trail panel
  in the UI: per-turn latency, tokens, $/run, tool calls, guardrail hits, p95, error %.

## Correctness

- `src/tax/engine.ts` — pure 2025 tax engine (IRS Tax-Table method under $100k).
- `src/pdf/fieldMap2025.ts` + `fill.ts` — official-form fill; the field map is verified
  against the real `f1040.pdf` and round-trip-checked.
- `test/` — 31 tests pin the tax math, the field map, W-2 extraction, and the agent tools.

## Deploy (Render, free) — `render.yaml` Blueprint included

1. Push this repo to a Git remote (this project's origin is GitLab:
   `labs.gauntletai.com/jaygodfrey/hackathon`). Render also supports GitHub/GitLab.
2. Render Dashboard → **New + → Blueprint** → pick the repo (or **New Web Service** with
   build `npm install`, start `npm start`).
3. Set **`OPENAI_API_KEY`** as a secret env var (it's `sync:false` in the Blueprint, so it
   never lives in the repo). `CHAT_MODEL` defaults to `gpt-4o-mini`.
4. Render builds and serves it; health check is `GET /api/health`. Paste the resulting
   public URL at the top of this README.

### Fully-automated deploy (optional)
With a `RENDER_API_KEY` and the repo pushed to a remote, deployment can be driven from the
Render API/CLI instead of the dashboard. Provide the key and I can wire that path.
