/**
 * Provider-abstracted LLM client. The rest of the system depends only on
 * `chatComplete()` + the OpenAI message type, so switching providers means
 * reimplementing this one file (the prd-compile boundary for "model/provider").
 */
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { CONFIG } from "./config";

export type LlmMessage = ChatCompletionMessageParam;

export type LlmToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
};

export type LlmToolCall = { id: string; name: string; argsJson: string };

export type LlmResult = {
  assistantMessage: LlmMessage; // append verbatim to history (carries tool_calls)
  content: string;
  toolCalls: LlmToolCall[];
  usage: { promptTokens: number; completionTokens: number };
};

const client = CONFIG.apiKey ? new OpenAI({ apiKey: CONFIG.apiKey }) : null;

export function llmConfigured(): boolean {
  return client !== null;
}

export async function chatComplete(
  messages: LlmMessage[],
  tools: LlmToolDef[],
): Promise<LlmResult> {
  if (!client) throw new Error("LLM not configured (OPENAI_API_KEY missing)");

  const toolDefs: ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const res = await client.chat.completions.create({
    model: CONFIG.model,
    messages,
    tools: toolDefs,
    tool_choice: "auto",
    temperature: 0.6,
    max_tokens: 700,
  });

  const msg = res.choices[0]?.message;
  const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    argsJson: tc.function.arguments,
  }));

  const assistantMessage: LlmMessage = {
    role: "assistant",
    content: msg?.content ?? "",
    ...(msg?.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
  };

  return {
    assistantMessage,
    content: msg?.content ?? "",
    toolCalls,
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    },
  };
}
