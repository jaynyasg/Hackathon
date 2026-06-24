/** Output guardrails + small safety helpers applied at the reply seam. */
import { LIMITS } from "../shared/contract";

const FALLBACK_REPLY =
  "Sorry — I hit a snag on my end. Could you say that once more? I'm right here to help you finish your 2025 Form 1040.";

export type Guarded = { reply: string; fallback: boolean; hits: string[] };

/** Empty -> safe fallback; over-long -> truncated. Never throws. */
export function guardReply(raw: string | null | undefined): Guarded {
  const hits: string[] = [];
  let text = (raw ?? "").trim();
  if (!text) return { reply: FALLBACK_REPLY, fallback: true, hits: ["empty_reply"] };
  if (text.length > LIMITS.maxReplyChars) {
    text = text.slice(0, LIMITS.maxReplyChars).trimEnd() + "…";
    hits.push("reply_truncated");
  }
  return { reply: text, fallback: false, hits };
}

/** Heuristic: did this turn pose a question to the user? */
export function isUserQuestion(text: string): boolean {
  return text.includes("?");
}

/** Redact SSN-like patterns before logging (no real-looking PII in logs). */
export function redactPII(s: string): string {
  return s.replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "***-**-****");
}
