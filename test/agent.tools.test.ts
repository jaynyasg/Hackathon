import { describe, it, expect } from "vitest";
import { getSession, resetSession } from "../src/agent/session";
import { executeTool } from "../src/agent/tools";
import { ingestW2 } from "../src/agent/ingest";
import { generateSampleW2Bytes } from "../src/pdf/generateSampleW2";

// Drives the agent's TOOLS directly (no LLM) — deterministic offline eval of
// the action layer + guardrails. The LLM's choice to call them is exercised
// separately by the live smoke / eval:record.

async function freshWithW2(id: string) {
  resetSession(id);
  const s = getSession(id);
  await ingestW2(s, await generateSampleW2Bytes(), "sample-w2.pdf");
  return s;
}
const field = (out: { result: unknown }, k: string) =>
  (out.result as Record<string, unknown>)[k];

describe("agent tools — deterministic", () => {
  it("extract_w2 reports cleanly when nothing is uploaded", async () => {
    resetSession("t-none");
    const out = await executeTool(getSession("t-none"), "extract_w2", "{}");
    expect(out.ok).toBe(false);
    expect(field(out, "found")).toBe(false);
  });

  it("record_taxpayer_info rejects an invalid filing status (action guardrail)", async () => {
    resetSession("t-bad");
    const s = getSession("t-bad");
    const out = await executeTool(s, "record_taxpayer_info", JSON.stringify({ filingStatus: "wizard" }));
    expect(out.ok).toBe(false);
    expect(s.profile.filingStatus).toBeUndefined();
  });

  it("record_taxpayer_info accepts natural filing-status phrasings (liberal seam)", async () => {
    resetSession("t-norm");
    const s = getSession("t-norm");
    // The model often sends label casing or full phrases rather than the code.
    for (const [input, code] of [
      ["Single", "single"],
      ["Married Filing Jointly", "mfj"],
      ["MFJ", "mfj"],
      ["head of household", "hoh"],
    ] as const) {
      const out = await executeTool(s, "record_taxpayer_info", JSON.stringify({ filingStatus: input }));
      expect(out.ok, `input=${input}`).toBe(true);
      expect(s.profile.filingStatus, `input=${input}`).toBe(code);
    }
  });

  it("happy path: extract -> record single -> compute -> generate ($1,325 refund)", async () => {
    const s = await freshWithW2("t-happy");
    const ex = await executeTool(s, "extract_w2", "{}");
    expect(ex.ok).toBe(true);
    expect(field(ex, "wages")).toBe(40_000);
    expect(s.profile.firstName).toBeTruthy(); // prefilled from the W-2

    await executeTool(s, "record_taxpayer_info", JSON.stringify({ filingStatus: "single" }));
    const comp = await executeTool(s, "compute_tax_return", "{}");
    expect(comp.ok).toBe(true);
    expect(s.result?.outcome).toBe("refund");
    expect(s.result?.outcomeAmount).toBe(1_325);

    const gen = await executeTool(s, "generate_1040_pdf", "{}");
    expect(gen.ok).toBe(true);
    expect(s.pdfBytes?.length ?? 0).toBeGreaterThan(1000);
  });

  it("compute refuses without a filing status (action guardrail)", async () => {
    const s = await freshWithW2("t-nofs");
    const comp = await executeTool(s, "compute_tax_return", "{}");
    expect(comp.ok).toBe(false);
    expect(s.result).toBeNull();
  });

  it("stretch: a qualifying child adds the Child Tax Credit", async () => {
    const s = await freshWithW2("t-ctc");
    await executeTool(s, "extract_w2", "{}");
    await executeTool(
      s,
      "record_taxpayer_info",
      JSON.stringify({
        filingStatus: "single",
        dependents: [{ firstName: "Sam", lastName: "Rivera", qualifiesForCTC: true }],
      }),
    );
    await executeTool(s, "compute_tax_return", "{}");
    expect(s.result?.line19_childTaxCredit).toBe(2_200);
    expect(s.result?.outcomeAmount).toBe(3_525); // 4000 - (2675 - 2200)
  });

  it("stretch: correcting filing status mid-conversation recomputes", async () => {
    const s = await freshWithW2("t-correct");
    await executeTool(s, "extract_w2", "{}");
    await executeTool(s, "record_taxpayer_info", JSON.stringify({ filingStatus: "single" }));
    await executeTool(s, "compute_tax_return", "{}");
    expect(s.result?.outcomeAmount).toBe(1_325);

    await executeTool(s, "record_taxpayer_info", JSON.stringify({ filingStatus: "mfj" }));
    await executeTool(s, "compute_tax_return", "{}");
    expect(s.result?.filingStatus).toBe("mfj");
    expect(s.result?.outcomeAmount).toBe(3_147); // 4000 - 853 (MFJ tax on $8,500)
  });

  it("stretch: manual W-2 entry recovers when an upload can't be parsed", async () => {
    resetSession("t-manual");
    const s = getSession("t-manual");
    const out = await executeTool(
      s,
      "enter_w2_manually",
      JSON.stringify({ box1Wages: 50_000, box2FederalWithholding: 5_000 }),
    );
    expect(out.ok).toBe(true);
    await executeTool(s, "record_taxpayer_info", JSON.stringify({ filingStatus: "single" }));
    const comp = await executeTool(s, "compute_tax_return", "{}");
    expect(comp.ok).toBe(true);
    expect(s.result?.line1a_wages).toBe(50_000);
  });
});
