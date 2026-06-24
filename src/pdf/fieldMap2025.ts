/**
 * 2025 IRS Form 1040 AcroForm field names.
 *
 * Ported from the opentax reference map (which states it was "verified
 * empirically by filling each field with a unique value and inspecting the
 * output") and re-verified here by test/pdf.test.ts, which asserts every name
 * below actually exists in assets/f1040.pdf. A stale or wrong name fails loudly.
 *
 * NOTE: the 2025 form moved lines 12-15 to page 2 and shifted the tax/payment
 * field indices, so these names are specific to the 2025 revision.
 */
import type { FilingStatus, Form1040Result } from "../shared/contract";

/** Identity + intermediate-sum fields (not part of the result line map). */
export const FORM_1040_FIELDS = {
  firstName: "topmostSubform[0].Page1[0].f1_14[0]",
  lastName: "topmostSubform[0].Page1[0].f1_15[0]",
  ssn: "topmostSubform[0].Page1[0].f1_16[0]",
  spouseFirstName: "topmostSubform[0].Page1[0].f1_17[0]",
  spouseLastName: "topmostSubform[0].Page1[0].f1_18[0]",
  spouseSSN: "topmostSubform[0].Page1[0].f1_19[0]",
  addressLine1: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_20[0]",
  addressCity: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_22[0]",
  addressState: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_23[0]",
  addressZip: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_24[0]",
  agiPage2: "topmostSubform[0].Page2[0].f2_01[0]", // line 11b (AGI carry)
  line18Sum: "topmostSubform[0].Page2[0].f2_10[0]", // line 16 + 17
  line21Sum: "topmostSubform[0].Page2[0].f2_13[0]", // line 19 + 20
} as const;

/** Filing-status checkboxes (single on-state per box). */
export const FILING_STATUS_CHECKBOX: Record<FilingStatus, string> = {
  single: "topmostSubform[0].Page1[0].c1_1[0]",
  mfj: "topmostSubform[0].Page1[0].c1_2[0]",
  mfs: "topmostSubform[0].Page1[0].c1_3[0]",
  hoh: "topmostSubform[0].Page1[0].c1_4[0]",
  qss: "topmostSubform[0].Page1[0].c1_5[0]",
};

/** Computed result line -> PDF text field. */
export const DOLLAR_FIELD_MAP: Partial<Record<keyof Form1040Result, string>> = {
  line1a_wages: "topmostSubform[0].Page1[0].f1_47[0]",
  line1z_totalWages: "topmostSubform[0].Page1[0].f1_57[0]",
  line9_totalIncome: "topmostSubform[0].Page1[0].f1_73[0]",
  line11_agi: "topmostSubform[0].Page1[0].f1_75[0]",
  line12_standardDeduction: "topmostSubform[0].Page2[0].f2_02[0]",
  line14_totalDeductions: "topmostSubform[0].Page2[0].f2_05[0]",
  line15_taxableIncome: "topmostSubform[0].Page2[0].f2_06[0]",
  line16_tax: "topmostSubform[0].Page2[0].f2_08[0]",
  line19_childTaxCredit: "topmostSubform[0].Page2[0].f2_11[0]",
  line22_taxAfterCredits: "topmostSubform[0].Page2[0].f2_14[0]",
  line24_totalTax: "topmostSubform[0].Page2[0].f2_16[0]",
  line25a_w2Withholding: "topmostSubform[0].Page2[0].f2_17[0]",
  line25d_totalWithholding: "topmostSubform[0].Page2[0].f2_20[0]",
  line33_totalPayments: "topmostSubform[0].Page2[0].f2_29[0]",
  line34_overpayment: "topmostSubform[0].Page2[0].f2_30[0]",
  line35a_refund: "topmostSubform[0].Page2[0].f2_31[0]",
  line37_amountOwed: "topmostSubform[0].Page2[0].f2_35[0]",
};

/** Whole-dollar money for a form box; blank when zero (forms leave 0 blank). */
export function formatMoneyForForm(n: number): string {
  if (!n) return "";
  return Math.round(n).toLocaleString("en-US");
}
