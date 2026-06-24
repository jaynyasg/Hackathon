/**
 * LLM fallback for messy/unknown W-2 layouts (stretch: recover from imperfect
 * input). Used only when the deterministic parser can't read the extracted text.
 * Output is validated against the W2Data contract before use (boundary guard).
 */
import OpenAI from "openai";
import { CONFIG } from "./config";
import { W2Data } from "../shared/contract";

const INSTRUCTION =
  "You extract fields from W-2 text. Return ONLY JSON with numeric fields (no $ or commas): " +
  "box1Wages (Box 1, federal taxable wages), box2FederalWithholding (Box 2), and when present " +
  "box3SocialSecurityWages, box4SocialSecurityTax, box5MedicareWages, box6MedicareTax, plus " +
  "strings employeeName, employeeSSN, employeeAddress, employerName, employerEIN, box15State. " +
  "Box 1 is federal taxable wages — do NOT substitute Box 3/5. Omit any field you can't find.";

export async function extractW2WithLLM(rawText: string): Promise<W2Data | null> {
  if (!CONFIG.apiKey || !rawText.trim()) return null;
  const client = new OpenAI({ apiKey: CONFIG.apiKey });
  try {
    const res = await client.chat.completions.create({
      model: CONFIG.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSTRUCTION },
        { role: "user", content: rawText.slice(0, 6000) },
      ],
    });
    const content = res.choices[0]?.message?.content ?? "{}";
    const parsed = W2Data.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    console.error("[extractW2Llm] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
