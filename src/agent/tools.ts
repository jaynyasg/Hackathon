/**
 * The agent's tools (pillar 2). Each is a real action executed server-side by
 * deterministic code; the LLM only chooses to call them and reads back results.
 * Every tool validates its arguments against the contract at the seam (pillar 3:
 * action guardrail) and the math tool is the ONLY source of dollar figures.
 */
import { z } from "zod";
import {
  Address,
  Dependent,
  FilingStatus,
  FILING_STATUS_LABEL,
  type TaxpayerProfile,
  type W2Data,
} from "../shared/contract";
import { computeForm1040 } from "../tax/engine";
import { fillForm1040 } from "../pdf/fill";
import { extractW2WithLLM } from "./extractW2Llm";
import type { LlmToolDef } from "./llm";
import type { SessionState } from "./session";

export type ToolOutcome = { ok: boolean; result: unknown; summary: string };

// ─── Tool schemas (JSON Schema for the model; Zod for validation) ───────────--
export const TOOL_DEFS: LlmToolDef[] = [
  {
    name: "extract_w2",
    description:
      "Read the W-2 the user uploaded and return its key fields (wages, federal withholding, names). Call this once after the user uploads their W-2.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "enter_w2_manually",
    description:
      "Record W-2 values the user typed when their upload couldn't be read automatically. At minimum you need Box 1 (wages) and Box 2 (federal income tax withheld).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["box1Wages", "box2FederalWithholding"],
      properties: {
        box1Wages: { type: "number", description: "Box 1 — wages, tips, other compensation" },
        box2FederalWithholding: { type: "number", description: "Box 2 — federal income tax withheld" },
        employeeName: { type: "string" },
        employerName: { type: "string" },
      },
    },
  },
  {
    name: "record_taxpayer_info",
    description:
      "Save what you've learned about the taxpayer (filing status, dependents, corrected name/address/spouse). Merge-updates; call whenever you learn something new.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filingStatus: { type: "string", enum: ["single", "mfj", "mfs", "hoh", "qss"] },
        firstName: { type: "string" },
        lastName: { type: "string" },
        ssn: { type: "string" },
        address: {
          type: "object",
          additionalProperties: false,
          properties: {
            line1: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
        },
        dependents: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              qualifiesForCTC: {
                type: "boolean",
                description: "true for a qualifying child under 17 (Child Tax Credit)",
              },
            },
            required: ["firstName", "lastName"],
          },
        },
        spouseFirstName: { type: "string" },
        spouseLastName: { type: "string" },
        spouseSSN: { type: "string" },
      },
    },
  },
  {
    name: "compute_tax_return",
    description:
      "Compute the 2025 Form 1040 from the W-2 and recorded info. The ONLY way to get any tax/refund number. Requires a W-2 and a filing status.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "generate_1040_pdf",
    description:
      "Fill the official 2025 Form 1040 PDF from the computed result and make it available to download. Call after compute_tax_return succeeds.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

const RecordArgs = z.object({
  filingStatus: FilingStatus.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  ssn: z.string().optional(),
  address: Address.partial().optional(),
  dependents: z.array(Dependent).optional(),
  spouseFirstName: z.string().optional(),
  spouseLastName: z.string().optional(),
  spouseSSN: z.string().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function splitName(full?: string): { firstName?: string; lastName?: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

// Be liberal in what we accept from the model: map natural phrasings/casing to
// the canonical filing-status code before the (strict) contract validates it.
const FILING_STATUS_ALIASES: Record<string, string> = {
  single: "single",
  s: "single",
  mfj: "mfj",
  "married filing jointly": "mfj",
  "married filing joint": "mfj",
  married: "mfj",
  joint: "mfj",
  jointly: "mfj",
  mfs: "mfs",
  "married filing separately": "mfs",
  "married filing separate": "mfs",
  separately: "mfs",
  hoh: "hoh",
  "head of household": "hoh",
  qss: "qss",
  "qualifying surviving spouse": "qss",
  "qualifying widow": "qss",
  "qualifying widower": "qss",
  widow: "qss",
  widower: "qss",
};
function normalizeFilingStatus(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  return FILING_STATUS_ALIASES[s] ?? s; // unknown -> lowercased; enum will reject if invalid
}

function parseAddress(s?: string) {
  if (!s) return undefined;
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const m = parts[2]!.match(/([A-Za-z]{2})\s+(\d{5})/);
    return { line1: parts[0], city: parts[1], state: m?.[1], zip: m?.[2] };
  }
  return { line1: s };
}

function missingForCompute(p: TaxpayerProfile, w2: W2Data | null): string[] {
  const missing: string[] = [];
  if (!w2) missing.push("w2 (ask the user to upload their W-2)");
  if (!p.filingStatus) missing.push("filingStatus");
  return missing;
}

// ─── Executor ──────────────────────────────────────────────────────────────--
export async function executeTool(
  session: SessionState,
  name: string,
  argsJson: string,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "extract_w2":
        return await extractW2(session);
      case "enter_w2_manually":
        return enterW2Manually(session, argsJson);
      case "record_taxpayer_info":
        return recordInfo(session, argsJson);
      case "compute_tax_return":
        return computeReturn(session);
      case "generate_1040_pdf":
        return await generatePdf(session);
      default:
        return { ok: false, result: { error: `unknown tool ${name}` }, summary: "unknown" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, result: { ok: false, error: msg }, summary: `error: ${msg}` };
  }
}

async function extractW2(session: SessionState): Promise<ToolOutcome> {
  if (!session.w2Bytes) {
    return {
      ok: false,
      result: { found: false, message: "No W-2 uploaded yet. Ask the user to upload their W-2 PDF." },
      summary: "no upload",
    };
  }
  // Deterministic parse runs at ingest; if it failed, try the LLM fallback on
  // the extracted text (stretch: messy/unknown W-2 layouts).
  if (!session.w2 && session.w2RawText) {
    session.w2 = await extractW2WithLLM(session.w2RawText);
  }
  const w2 = session.w2;
  if (!w2) {
    return {
      ok: false,
      result: {
        found: false,
        message:
          "Couldn't read that W-2 automatically. Ask the user for Box 1 (wages) and Box 2 (federal tax withheld), then call enter_w2_manually.",
      },
      summary: "parse failed",
    };
  }
  // Pre-fill identity from the W-2 so we don't have to ask for it.
  const { firstName, lastName } = splitName(w2.employeeName);
  if (firstName && !session.profile.firstName) session.profile.firstName = firstName;
  if (lastName && !session.profile.lastName) session.profile.lastName = lastName;
  if (w2.employeeSSN && !session.profile.ssn) session.profile.ssn = w2.employeeSSN;
  const addr = parseAddress(w2.employeeAddress);
  if (addr && !session.profile.address?.line1) session.profile.address = addr;

  return {
    ok: true,
    result: {
      found: true,
      wages: w2.box1Wages,
      federalWithholding: w2.box2FederalWithholding,
      employeeName: w2.employeeName,
      employerName: w2.employerName,
      ssnOnFile: Boolean(w2.employeeSSN), // don't echo the SSN itself
      addressOnFile: Boolean(w2.employeeAddress),
      next: "Name, SSN, and address are now captured from the W-2 — do NOT ask for them. Ask only for filing status (and any dependents), then call compute_tax_return.",
    },
    summary: `wages=${w2.box1Wages} wh=${w2.box2FederalWithholding}`,
  };
}

const ManualW2Args = z.object({
  box1Wages: z.number().finite().nonnegative(),
  box2FederalWithholding: z.number().finite().nonnegative(),
  employeeName: z.string().optional(),
  employerName: z.string().optional(),
});

function enterW2Manually(session: SessionState, argsJson: string): ToolOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson || "{}");
  } catch {
    return { ok: false, result: { ok: false, error: "arguments were not valid JSON" }, summary: "bad json" };
  }
  const parsed = ManualW2Args.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      result: { ok: false, error: "need numeric box1Wages and box2FederalWithholding" },
      summary: "validation failed",
    };
  }
  const a = parsed.data;
  session.w2 = {
    box1Wages: a.box1Wages,
    box2FederalWithholding: a.box2FederalWithholding,
    employeeName: a.employeeName,
    employerName: a.employerName,
  };
  if (a.employeeName) {
    const { firstName, lastName } = splitName(a.employeeName);
    if (firstName && !session.profile.firstName) session.profile.firstName = firstName;
    if (lastName && !session.profile.lastName) session.profile.lastName = lastName;
  }
  return {
    ok: true,
    result: { ok: true, wages: a.box1Wages, federalWithholding: a.box2FederalWithholding },
    summary: `manual wages=${a.box1Wages}`,
  };
}

function recordInfo(session: SessionState, argsJson: string): ToolOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson || "{}");
  } catch {
    return { ok: false, result: { ok: false, error: "arguments were not valid JSON" }, summary: "bad json" };
  }
  if (raw && typeof raw === "object" && "filingStatus" in raw) {
    const r = raw as Record<string, unknown>;
    r.filingStatus = normalizeFilingStatus(r.filingStatus);
  }
  const parsed = RecordArgs.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      result: { ok: false, error: "invalid info", details: parsed.error.flatten().fieldErrors },
      summary: "validation failed",
    };
  }
  const a = parsed.data;
  const p = session.profile;
  if (a.filingStatus) p.filingStatus = a.filingStatus;
  if (a.firstName) p.firstName = a.firstName;
  if (a.lastName) p.lastName = a.lastName;
  if (a.ssn) p.ssn = a.ssn;
  if (a.address) p.address = { ...p.address, ...a.address };
  if (a.dependents) p.dependents = a.dependents;
  if (a.spouseFirstName) p.spouseFirstName = a.spouseFirstName;
  if (a.spouseLastName) p.spouseLastName = a.spouseLastName;
  if (a.spouseSSN) p.spouseSSN = a.spouseSSN;

  const stillNeeded = missingForCompute(p, session.w2);
  const ready = stillNeeded.length === 0;
  return {
    ok: true,
    result: {
      ok: true,
      filingStatus: p.filingStatus ? FILING_STATUS_LABEL[p.filingStatus] : null,
      dependents: p.dependents.length,
      readyToCompute: ready,
      next: ready
        ? "All set — call compute_tax_return now. Do NOT ask for name, SSN, or address; they are already captured from the W-2."
        : `Still needed before computing: ${stillNeeded.join(", ")}`,
    },
    summary: `status=${p.filingStatus ?? "?"} deps=${p.dependents.length} ready=${ready}`,
  };
}

function computeReturn(session: SessionState): ToolOutcome {
  const missing = missingForCompute(session.profile, session.w2);
  if (missing.length > 0 || !session.w2) {
    return {
      ok: false,
      result: { ok: false, error: `missing: ${missing.join(", ")}` },
      summary: `missing ${missing.join("/")}`,
    };
  }
  const result = computeForm1040(session.profile, session.w2);
  session.result = result;
  return {
    ok: true,
    result: {
      ok: true,
      filingStatus: FILING_STATUS_LABEL[result.filingStatus],
      wages: result.line1a_wages,
      adjustedGrossIncome: result.line11_agi,
      standardDeduction: result.line12_standardDeduction,
      taxableIncome: result.line15_taxableIncome,
      tax: result.line16_tax,
      childTaxCredit: result.line19_childTaxCredit,
      totalTax: result.line24_totalTax,
      totalPayments: result.line33_totalPayments,
      outcome: result.outcome, // "refund" | "owe" | "even"
      amount: result.outcomeAmount,
    },
    summary: `${result.outcome} $${result.outcomeAmount}`,
  };
}

async function generatePdf(session: SessionState): Promise<ToolOutcome> {
  if (!session.result) {
    return {
      ok: false,
      result: { ok: false, error: "compute_tax_return must succeed first" },
      summary: "no result",
    };
  }
  session.pdfBytes = await fillForm1040(session.result, session.profile);
  return {
    ok: true,
    result: { ok: true, downloadReady: true, bytes: session.pdfBytes.length },
    summary: `pdf ${session.pdfBytes.length}b`,
  };
}
