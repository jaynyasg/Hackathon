/**
 * The chat loop (pillar 1): carries full conversation state across turns and
 * runs the agentic tool cycle (model -> tool calls -> model -> ... -> reply),
 * enforcing the question budget and recording one observation per turn.
 */
import { LIMITS, type ChatTurnResponse, type TurnObservation } from "../shared/contract";
import { CONFIG, costUsd } from "./config";
import { chatComplete } from "./llm";
import { TOOL_DEFS, executeTool } from "./tools";
import { guardReply, isUserQuestion } from "./guard";
import { logTurn } from "./observability";
import type { SessionState } from "./session";

const MAX_TOOL_STEPS = 6; // safety bound on tool cycles per turn

const BUDGET_NUDGE =
  "[system] The user has used all 5 of their questions. Do NOT ask anything else. " +
  "Proceed with the information you have, stating any reasonable assumptions, and finish " +
  "the return now: call compute_tax_return, then generate_1040_pdf, then share the result.";

export async function runTurn(session: SessionState, userText: string): Promise<ChatTurnResponse> {
  const start = Date.now();
  session.messages.push({ role: "user", content: userText });

  // Question budget (enforced + visible): once used up, inject a one-time
  // instruction that forces completion instead of a 6th question.
  if (session.questionsAsked >= LIMITS.maxQuestions && !session.budgetNudged) {
    session.messages.push({ role: "system", content: BUDGET_NUDGE });
    session.budgetNudged = true;
  }

  let promptTokens = 0;
  let completionTokens = 0;
  const toolCalls: TurnObservation["toolCalls"] = [];
  const guardHits: string[] = [];
  let assistantText = "";
  let error: string | undefined;

  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const res = await chatComplete(session.messages, TOOL_DEFS);
      promptTokens += res.usage.promptTokens;
      completionTokens += res.usage.completionTokens;
      session.messages.push(res.assistantMessage);

      if (res.toolCalls.length === 0) {
        assistantText = res.content;
        // Keep stored history consistent with the (guarded) text the user sees.
        const guardedPreview = guardReply(assistantText);
        if (res.assistantMessage.role === "assistant" && !res.assistantMessage.tool_calls) {
          res.assistantMessage.content = guardedPreview.reply;
        }
        break;
      }

      // Execute every requested tool and feed results back (tool results are
      // always pushed, even on tool error, so history stays valid).
      for (const call of res.toolCalls) {
        const t0 = Date.now();
        const outcome = await executeTool(session, call.name, call.argsJson);
        toolCalls.push({ name: call.name, ok: outcome.ok, ms: Date.now() - t0, summary: outcome.summary });
        session.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(outcome.result),
        });
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const guarded = guardReply(error ? null : assistantText);
  guardHits.push(...guarded.hits);
  if (error) guardHits.push("turn_error");

  // Count an info-gathering question only after a W-2 exists and before the
  // return is computed (greeting/upload-invite and wrap-up don't count).
  if (!error && session.w2 && !session.result && isUserQuestion(guarded.reply)) {
    session.questionsAsked++;
  }

  const obs: TurnObservation = {
    turn: session.turns.length + 1,
    at: new Date().toISOString(),
    latencyMs: Date.now() - start,
    model: CONFIG.model,
    promptTokens,
    completionTokens,
    costUsd: costUsd(CONFIG.model, promptTokens, completionTokens),
    toolCalls,
    questionsAsked: session.questionsAsked,
    guardrailHits: guardHits,
    error,
  };
  session.turns.push(obs);
  logTurn(session.id, obs);

  // Don't ship SSNs back to the client (defense-in-depth; the UI doesn't need them).
  const safeProfile = { ...session.profile, ssn: undefined, spouseSSN: undefined };

  return {
    sessionId: session.id,
    reply: guarded.reply,
    questionsAsked: session.questionsAsked,
    questionsRemaining: Math.max(0, LIMITS.maxQuestions - session.questionsAsked),
    profile: safeProfile,
    hasW2: Boolean(session.w2),
    result: session.result,
    downloadReady: Boolean(session.pdfBytes),
    observation: obs,
    fallback: error ? true : guarded.fallback,
  };
}
