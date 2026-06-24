/**
 * Live smoke: drive the real agent (real LLM) through a full conversation in
 * process — upload -> filing status -> compute -> generate — and report the
 * tools it called, the question count, the result, and the observability
 * metrics. Costs a few cents of OpenAI usage.
 */
import { getSession } from "../src/agent/session";
import { runTurn } from "../src/agent/loop";
import { ingestW2 } from "../src/agent/ingest";
import { generateSampleW2Bytes } from "../src/pdf/generateSampleW2";
import { llmConfigured } from "../src/agent/llm";
import { summarizeSession } from "../src/agent/observability";

if (!llmConfigured()) {
  console.error("No OPENAI_API_KEY in env — cannot run the live smoke.");
  process.exit(1);
}

const session = getSession("smoke");
await ingestW2(session, await generateSampleW2Bytes(), "sample-w2.pdf");

const script = [
  "I just uploaded my W-2 (file: sample-w2.pdf).",
  "I'm single and I don't have any dependents.",
  "Yes, that all looks right — please go ahead.",
  "Thank you!",
];

for (const msg of script) {
  const r = await runTurn(session, msg);
  const tools = r.observation.toolCalls.map((t) => `${t.name}${t.ok ? "" : "✗"}`).join(",") || "-";
  console.log(`\n[USER] ${msg}`);
  console.log(`[ADA]  ${r.reply}`);
  console.log(
    `   q=${r.questionsAsked}/5  tools=[${tools}]  ` +
      `result=${r.result ? r.result.outcome + " $" + r.result.outcomeAmount : "none"}  ` +
      `download=${r.downloadReady}`,
  );
  if (session.pdfBytes && session.result) break;
}

console.log("\n=== OUTCOME ===");
console.log("result:", session.result ? `${session.result.outcome} $${session.result.outcomeAmount}` : "NONE");
console.log("taxableIncome:", session.result?.line15_taxableIncome, " tax:", session.result?.line16_tax);
console.log("downloadReady:", Boolean(session.pdfBytes), "pdfBytes:", session.pdfBytes?.length ?? 0);
console.log("questionsAsked:", session.questionsAsked);
console.log("metrics:", summarizeSession(session.turns));
