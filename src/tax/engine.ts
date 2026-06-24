/**
 * Pure 2025 Form 1040 tax engine. No I/O, no LLM — the ONLY path to a tax
 * number in the whole system, which is what makes "the agent never invents
 * numbers" an architectural guarantee rather than a prompt request.
 *
 * Scope: a single W-2, standard deduction, federal only. Other income,
 * itemizing, and most credits are out of scope (noted as scale-path). The
 * Child Tax Credit is wired in but inert unless dependents are supplied.
 */
import type {
  FilingStatus,
  Form1040Result,
  TaxpayerProfile,
  W2Data,
} from "../shared/contract";
import {
  BRACKETS_2025,
  CTC_PER_CHILD_2025,
  ODC_PER_DEPENDENT_2025,
  STANDARD_DEDUCTION_2025,
  TAX_TABLE_CEILING_2025,
} from "./constants2025";

/** IRS whole-dollar method: round to the nearest dollar (half rounds up). */
export function roundDollar(n: number): number {
  return Math.round(n);
}

export function standardDeduction(status: FilingStatus): number {
  return STANDARD_DEDUCTION_2025[status];
}

/** Tax on an exact income using the rate schedule (no table rounding). */
function bracketTax(income: number, status: FilingStatus): number {
  if (income <= 0) return 0;
  for (const b of BRACKETS_2025[status]) {
    if (income > b.over && income <= b.upTo) {
      return b.base + b.rate * (income - b.over);
    }
  }
  return 0; // unreachable: the top bracket's upTo is Infinity
}

/**
 * Federal income tax on a taxable income (TY2025), matching the IRS method:
 *  - taxable < $100,000: Tax Table — tax on the MIDPOINT of the $50 row, rounded.
 *    (Exact for taxable >= $3,000; a ~$40k W-2 earner is always above that.)
 *  - taxable >= $100,000: Tax Computation Worksheet — formula on the actual income.
 */
export function incomeTax(taxable: number, status: FilingStatus): number {
  if (taxable <= 0) return 0;
  if (taxable < TAX_TABLE_CEILING_2025) {
    const rowMidpoint = Math.floor(taxable / 50) * 50 + 25;
    return roundDollar(bracketTax(rowMidpoint, status));
  }
  return roundDollar(bracketTax(taxable, status));
}

export function computeForm1040(profile: TaxpayerProfile, w2: W2Data): Form1040Result {
  const status: FilingStatus = profile.filingStatus ?? "single";

  const wages = roundDollar(w2.box1Wages);
  const withholding = roundDollar(w2.box2FederalWithholding);

  // Income (only W-2 wages are in scope; lines 1b-8 and adjustments are 0).
  const line1a_wages = wages;
  const line1z_totalWages = wages;
  const line9_totalIncome = line1z_totalWages;
  const line11_agi = line9_totalIncome;

  // Deductions -> taxable income.
  const line12_standardDeduction = standardDeduction(status);
  const line14_totalDeductions = line12_standardDeduction;
  const line15_taxableIncome = Math.max(0, line11_agi - line14_totalDeductions);

  // Tax before credits (line 17 Schedule 2 and line 13 QBI are out of scope).
  const line16_tax = incomeTax(line15_taxableIncome, status);
  const line18 = line16_tax;

  // Credits: CTC ($2,200/qualifying child) + ODC ($500/other dependent),
  // nonrefundable and capped at the tax. The refundable ACTC overflow is out of
  // scope (never triggers for a ~$40k earner with a single dependent).
  const deps = profile.dependents ?? [];
  const ctcChildren = deps.filter((d) => d.qualifiesForCTC).length;
  const otherDeps = deps.length - ctcChildren;
  const creditClaim = ctcChildren * CTC_PER_CHILD_2025 + otherDeps * ODC_PER_DEPENDENT_2025;
  const line19_childTaxCredit = Math.min(creditClaim, line18);
  const line21 = line19_childTaxCredit;
  const line22_taxAfterCredits = Math.max(0, line18 - line21);

  // Total tax (line 23 other taxes out of scope).
  const line24_totalTax = line22_taxAfterCredits;

  // Payments (only W-2 withholding in scope).
  const line25a_w2Withholding = withholding;
  const line25d_totalWithholding = withholding;
  const line33_totalPayments = line25d_totalWithholding;

  // Refund vs. amount owed.
  const overpaid = line33_totalPayments > line24_totalTax;
  const line34_overpayment = overpaid ? line33_totalPayments - line24_totalTax : 0;
  const line35a_refund = line34_overpayment;
  const line37_amountOwed = overpaid ? 0 : line24_totalTax - line33_totalPayments;

  const outcome =
    line34_overpayment > 0 ? "refund" : line37_amountOwed > 0 ? "owe" : "even";
  const outcomeAmount = line34_overpayment > 0 ? line34_overpayment : line37_amountOwed;

  return {
    taxYear: 2025,
    filingStatus: status,
    line1a_wages,
    line1z_totalWages,
    line9_totalIncome,
    line11_agi,
    line12_standardDeduction,
    line14_totalDeductions,
    line15_taxableIncome,
    line16_tax,
    line19_childTaxCredit,
    line22_taxAfterCredits,
    line24_totalTax,
    line25a_w2Withholding,
    line25d_totalWithholding,
    line33_totalPayments,
    line34_overpayment,
    line35a_refund,
    line37_amountOwed,
    outcome,
    outcomeAmount,
  };
}
