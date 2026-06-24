/**
 * Boundary contract — the single typed source of truth at every seam.
 *
 * Everything that crosses a trust boundary is parsed against these Zod schemas:
 *   - inbound HTTP requests (chat, upload)            -> parse-or-400
 *   - LLM tool-call arguments                         -> parse-or-reject
 *   - LLM-extracted W-2 fields                        -> parse-or-fallback
 *   - the computed 1040 handed to the PDF filler      -> internally trusted
 *
 * Money is in dollars (numbers). The 1040 uses the whole-dollar method, so the
 * tax engine rounds line values to whole dollars; W-2 inputs may carry cents.
 */
import { z } from "zod";

// ─── Filing status ────────────────────────────────────────────────────────────
export const FilingStatus = z.enum(["single", "mfj", "mfs", "hoh", "qss"]);
export type FilingStatus = z.infer<typeof FilingStatus>;

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  single: "Single",
  mfj: "Married filing jointly",
  mfs: "Married filing separately",
  hoh: "Head of household",
  qss: "Qualifying surviving spouse",
};

// ─── Money helpers ──────────────────────────────────────────────────────────--
const money = z.number().finite();
const nonNegMoney = z.number().finite().nonnegative();

// ─── W-2 (the subset that feeds a 1040) ─────────────────────────────────────--
export const W2Data = z.object({
  employeeName: z.string().min(1).optional(),
  employeeSSN: z.string().optional(),
  employeeAddress: z.string().optional(),
  employerName: z.string().optional(),
  employerEIN: z.string().optional(),
  /** Box 1 — wages, tips, other compensation (federal taxable wages). */
  box1Wages: nonNegMoney,
  /** Box 2 — federal income tax withheld. */
  box2FederalWithholding: nonNegMoney,
  box3SocialSecurityWages: nonNegMoney.optional(),
  box4SocialSecurityTax: nonNegMoney.optional(),
  box5MedicareWages: nonNegMoney.optional(),
  box6MedicareTax: nonNegMoney.optional(),
  box15State: z.string().optional(),
  box16StateWages: nonNegMoney.optional(),
  box17StateTax: nonNegMoney.optional(),
});
export type W2Data = z.infer<typeof W2Data>;

// ─── Dependent (stretch: Child Tax Credit / Other Dependent Credit) ─────────--
export const Dependent = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  ssn: z.string().optional(),
  relationship: z.string().optional(),
  /** True if a qualifying child under 17 (-> CTC); otherwise treated as ODC. */
  qualifiesForCTC: z.boolean().default(false),
});
export type Dependent = z.infer<typeof Dependent>;

// ─── Address ─────────────────────────────────────────────────────────────────
export const Address = z.object({
  line1: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  zip: z.string().min(5).max(10),
});
export type Address = z.infer<typeof Address>;

// ─── Taxpayer profile (gathered across the conversation, hence partial) ──────--
export const TaxpayerProfile = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  ssn: z.string().optional(),
  address: Address.partial().optional(),
  filingStatus: FilingStatus.optional(),
  spouseFirstName: z.string().optional(),
  spouseLastName: z.string().optional(),
  spouseSSN: z.string().optional(),
  dependents: z.array(Dependent).default([]),
});
export type TaxpayerProfile = z.infer<typeof TaxpayerProfile>;

// ─── Computed 1040 result (every line the form needs) ───────────────────────--
export const Form1040Result = z.object({
  taxYear: z.literal(2025),
  filingStatus: FilingStatus,
  line1a_wages: money,
  line1z_totalWages: money,
  line9_totalIncome: money,
  line11_agi: money,
  line12_standardDeduction: money,
  line14_totalDeductions: money,
  line15_taxableIncome: money,
  line16_tax: money,
  line19_childTaxCredit: money, // 0 in core slice; populated with dependents
  line22_taxAfterCredits: money,
  line24_totalTax: money,
  line25a_w2Withholding: money,
  line25d_totalWithholding: money,
  line33_totalPayments: money,
  line34_overpayment: money, // refund side (>= 0)
  line35a_refund: money,
  line37_amountOwed: money, // owe side (>= 0)
  /** Human-facing summary derived from the above. */
  outcome: z.enum(["refund", "owe", "even"]),
  outcomeAmount: nonNegMoney,
});
export type Form1040Result = z.infer<typeof Form1040Result>;

// ─── HTTP boundary payloads ─────────────────────────────────────────────────--
export const LIMITS = {
  maxMessageChars: 2000,
  maxReplyChars: 4000,
  maxQuestions: 5,
  maxUploadBytes: 11 * 1024 * 1024,
} as const;

export const ChatTurnRequest = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().min(1).max(LIMITS.maxMessageChars),
});
export type ChatTurnRequest = z.infer<typeof ChatTurnRequest>;

export const UploadRequest = z.object({
  sessionId: z.string().min(1).max(100),
  filename: z.string().min(1).max(255),
  /** base64-encoded PDF bytes (no data: prefix). */
  dataBase64: z.string().min(1),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

// ─── Observability (per-turn trace, surfaced in the UI) ─────────────────────--
export const ToolTrace = z.object({
  name: z.string(),
  ok: z.boolean(),
  ms: z.number(),
  summary: z.string().optional(),
  error: z.string().optional(),
});
export type ToolTrace = z.infer<typeof ToolTrace>;

export const TurnObservation = z.object({
  turn: z.number(),
  at: z.string(),
  latencyMs: z.number(),
  model: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  costUsd: z.number(),
  toolCalls: z.array(ToolTrace),
  questionsAsked: z.number(),
  guardrailHits: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type TurnObservation = z.infer<typeof TurnObservation>;

export const ChatTurnResponse = z.object({
  sessionId: z.string(),
  reply: z.string(),
  questionsAsked: z.number(),
  questionsRemaining: z.number(),
  profile: TaxpayerProfile.partial(),
  hasW2: z.boolean(),
  result: Form1040Result.nullable(),
  downloadReady: z.boolean(),
  observation: TurnObservation,
  fallback: z.boolean().optional(),
});
export type ChatTurnResponse = z.infer<typeof ChatTurnResponse>;
