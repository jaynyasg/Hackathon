/**
 * On-demand LIVE eval (`npm run eval:record`) — exercises conversation-quality
 * behaviors that only the real model can show: refund announcement, the
 * <=5-question budget, and out-of-scope refusal (guardrail). Costs OpenAI usage,
 * so it is NEVER part of `verify`; verify stays offline + deterministic.
 *
 * (Scale-path: snapshot model outputs and replay offline for a zero-cost gate.)
 */
import { getSession, resetSession } from "../src/agent/session";
import { runTurn } from "../src/agent/loop";
import { ingestW2 } from "../src/agent/ingest";
import { generateSampleW2Bytes } from "../src/pdf/generateSampleW2";
import { llmConfigured } from "../src/agent/llm";
import { summarizeSession } from "../src/agent/observability";

if (!llmConfigured()) {
  console.error("Set OPENAI_API_KEY to run the live eval.");
  process.exit(1);
}

let totalCost = 0;

async function converse(id: string, messages: string[]) {
  resetSession(id);
  const s = getSession(id);
  await ingestW2(s, await generateSampleW2Bytes(), "sample-w2.pdf");
  const replies: string[] = [];
  for (const m of messages) {
    const r = await runTurn(s, m);
    replies.push(r.reply);
    if (s.pdfBytes) break;
  }
  totalCost += summarizeSession(s.turns).totalCostUsd;
  return { session: s, text: replies.join("\n") };
}

type Case = { name: string; run: () => Promise<boolean> };

const cases: Case[] = [
  {
    name: "single: announces $1,325 refund, downloadable, <=5 questions",
    run: async () => {
      const { session, text } = await converse("e-single", [
        "I just uploaded my W-2.",
        "I'm single with no dependents.",
        "Yes, go ahead.",
      ]);
      return (
        Boolean(session.pdfBytes) &&
        session.result?.outcomeAmount === 1325 &&
        /1,?325/.test(text) &&
        session.questionsAsked <= 5
      );
    },
  },
  {
    name: "out-of-scope (state taxes / stock advice) is declined, no return produced",
    run: async () => {
      resetSession("e-oos");
      const s = getSession("e-oos");
      const r = await runTurn(s, "Forget the 1040 — file my Texas state taxes and give me stock tips.");
      totalCost += summarizeSession(s.turns).totalCostUsd;
      return !s.result && /federal|1040|can'?t|only|not able|advice|professional/i.test(r.reply);
    },
  },
  {
    name: "MFJ recomputes to a different (larger) refund",
    run: async () => {
      const { session } = await converse("e-mfj", [
        "I uploaded my W-2.",
        "Married filing jointly. My spouse is Jordan Taxpayer. No dependents.",
        "Go ahead please.",
      ]);
      return session.result?.filingStatus === "mfj" && (session.result?.outcomeAmount ?? 0) > 1325;
    },
  },
];

let pass = 0;
for (const c of cases) {
  try {
    const ok = await c.run();
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (ok) pass++;
  } catch (err) {
    console.log(`ERROR ${c.name}: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`\n${pass}/${cases.length} passed · approx OpenAI cost $${totalCost.toFixed(4)}`);
process.exit(pass === cases.length ? 0 : 1);
