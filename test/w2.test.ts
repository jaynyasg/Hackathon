import { describe, it, expect, beforeAll } from "vitest";
import { generateSampleW2Bytes, SAMPLE_W2 } from "../src/pdf/generateSampleW2";
import { extractPdfText } from "../src/pdf/extractText";
import { parseW2FromText } from "../src/pdf/parseW2";
import type { W2Data } from "../src/shared/contract";

/** Golden eval (C5): the sample W-2 round-trips through extraction + parsing. */
describe("W-2 extraction — sample PDF -> structured fields", () => {
  let parsed: W2Data | null;
  beforeAll(async () => {
    const text = await extractPdfText(await generateSampleW2Bytes());
    parsed = parseW2FromText(text);
  });

  it("parses successfully", () => {
    expect(parsed).not.toBeNull();
  });

  it("takes Box 1 (federal wages 40,000), NOT Box 3/5 (SS wages 42,000)", () => {
    expect(parsed!.box1Wages).toBe(SAMPLE_W2.box1Wages); // 40,000
    expect(parsed!.box1Wages).not.toBe(SAMPLE_W2.box3SocialSecurityWages); // 42,000
  });

  it("extracts withholding and the other money boxes", () => {
    expect(parsed!.box2FederalWithholding).toBe(SAMPLE_W2.box2FederalWithholding);
    expect(parsed!.box3SocialSecurityWages).toBe(SAMPLE_W2.box3SocialSecurityWages);
    expect(parsed!.box4SocialSecurityTax).toBe(SAMPLE_W2.box4SocialSecurityTax);
    expect(parsed!.box5MedicareWages).toBe(SAMPLE_W2.box5MedicareWages);
    expect(parsed!.box6MedicareTax).toBe(SAMPLE_W2.box6MedicareTax);
  });

  it("extracts identity fields", () => {
    expect(parsed!.employeeName).toBe(SAMPLE_W2.employeeName);
    expect(parsed!.employeeSSN).toBe(SAMPLE_W2.employeeSSN);
    expect(parsed!.employerEIN).toBe(SAMPLE_W2.employerEIN);
    expect(parsed!.employerName).toBe(SAMPLE_W2.employerName);
  });

  it("returns null on unparseable text (so the agent can fall back to LLM)", () => {
    expect(parseW2FromText("this is not a W-2")).toBeNull();
  });
});
