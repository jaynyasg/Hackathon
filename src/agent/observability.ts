/**
 * Observability (pillar 4): turn the per-turn trace into the metrics the PRD
 * calls out — p95 latency, $/run, error %, plus token + tool-call totals.
 */
import type { TurnObservation } from "../shared/contract";
import { redactPII } from "./guard";

export type SessionMetrics = {
  turns: number;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  toolCalls: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

export function summarizeSession(turns: TurnObservation[]): SessionMetrics {
  const latencies = turns.map((t) => t.latencyMs).sort((a, b) => a - b);
  const errors = turns.filter((t) => t.error).length;
  return {
    turns: turns.length,
    totalCostUsd: turns.reduce((s, t) => s + t.costUsd, 0),
    totalTokens: turns.reduce((s, t) => s + t.promptTokens + t.completionTokens, 0),
    avgLatencyMs: latencies.length ? latencies.reduce((s, n) => s + n, 0) / latencies.length : 0,
    p95LatencyMs: percentile(latencies, 95),
    errorRate: turns.length ? errors / turns.length : 0,
    toolCalls: turns.reduce((s, t) => s + t.toolCalls.length, 0),
  };
}

/** One structured, PII-redacted log line per turn (console = the log sink). */
export function logTurn(sessionId: string, obs: TurnObservation): void {
  const tools = obs.toolCalls.map((t) => `${t.name}${t.ok ? "" : "!"}`).join(",") || "-";
  console.log(
    `[turn] sid=${sessionId} #${obs.turn} ${obs.latencyMs}ms ` +
      `tok=${obs.promptTokens}+${obs.completionTokens} $${obs.costUsd.toFixed(5)} ` +
      `q=${obs.questionsAsked} tools=[${tools}]` +
      (obs.guardrailHits.length ? ` guards=[${obs.guardrailHits.join(",")}]` : "") +
      (obs.error ? ` ERROR=${redactPII(obs.error)}` : ""),
  );
}
