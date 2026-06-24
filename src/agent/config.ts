/** Runtime config + LLM pricing. Reads env once (dotenv) at import. */
import "dotenv/config";

export const CONFIG = {
  model: process.env.CHAT_MODEL ?? "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  port: Number(process.env.PORT ?? 3000),
} as const;

/** USD per 1M tokens, by model. Used for the $/run observability metric. */
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
};

export function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? PRICING["gpt-4o-mini"]!;
  return (promptTokens / 1e6) * p.inputPerM + (completionTokens / 1e6) * p.outputPerM;
}
