import { describe, it, expect } from "vitest";
import {
  computeForm1040,
  incomeTax,
  standardDeduction,
  roundDollar,
} from "../src/tax/engine";
import type { TaxpayerProfile, W2Data } from "../src/shared/contract";

/**
 * Expected values are hand-computed from the 2025 rate schedules using the IRS
 * Tax Table method for taxable income < $100,000 (tax on the MIDPOINT of the
 * $50 row, rounded). This is the "as if filing with the government" oracle (C3).
 *
 * Case A (Single, $40k wages, $4k withheld), step by step:
 *   AGI 40,000 - std ded 15,750 = taxable 24,250
 *   row 24,250-24,300 -> midpoint 24,275
 *   tax = 1,192.50 + 12% x (24,275 - 11,925) = 1,192.50 + 1,482 = 2,674.50 -> 2,675
 *   payments 4,000 - tax 2,675 = refund 1,325
 */
function profile(p: Partial<TaxpayerProfile> = {}): TaxpayerProfile {
  return { dependents: [], ...p };
}
function w2(box1: number, box2: number): W2Data {
  return { box1Wages: box1, box2FederalWithholding: box2 };
}

describe("roundDollar (IRS whole-dollar method)", () => {
  it("rounds halves up", () => {
    expect(roundDollar(2674.5)).toBe(2675);
    expect(roundDollar(852.5)).toBe(853);
    expect(roundDollar(100.49)).toBe(100);
  });
});

describe("standardDeduction (2025)", () => {
  it("matches the figures printed on the form", () => {
    expect(standardDeduction("single")).toBe(15_750);
    expect(standardDeduction("mfj")).toBe(31_500);
    expect(standardDeduction("hoh")).toBe(23_625);
    expect(standardDeduction("mfs")).toBe(15_750);
    expect(standardDeduction("qss")).toBe(31_500);
  });
});

describe("incomeTax (2025)", () => {
  it("uses the tax-table midpoint below $100k", () => {
    expect(incomeTax(24_250, "single")).toBe(2_675);
    expect(incomeTax(8_500, "mfj")).toBe(853);
  });
  it("uses the worksheet formula at/above $100k", () => {
    // 120,000 single: 17,651 + 24% x (120,000 - 103,350) = 17,651 + 3,996 = 21,647
    expect(incomeTax(120_000, "single")).toBe(21_647);
  });
  it("is zero for non-positive taxable income", () => {
    expect(incomeTax(0, "single")).toBe(0);
    expect(incomeTax(-50, "single")).toBe(0);
  });
});

describe("computeForm1040 — Case A: Single $40k, $4k withheld -> refund $1,325", () => {
  const r = computeForm1040(profile({ filingStatus: "single" }), w2(40_000, 4_000));
  it("flows wages through to taxable income", () => {
    expect(r.line1a_wages).toBe(40_000);
    expect(r.line9_totalIncome).toBe(40_000);
    expect(r.line11_agi).toBe(40_000);
    expect(r.line12_standardDeduction).toBe(15_750);
    expect(r.line15_taxableIncome).toBe(24_250);
  });
  it("computes tax, payments, and a refund", () => {
    expect(r.line16_tax).toBe(2_675);
    expect(r.line24_totalTax).toBe(2_675);
    expect(r.line25d_totalWithholding).toBe(4_000);
    expect(r.line34_overpayment).toBe(1_325);
    expect(r.line35a_refund).toBe(1_325);
    expect(r.line37_amountOwed).toBe(0);
    expect(r.outcome).toBe("refund");
    expect(r.outcomeAmount).toBe(1_325);
  });
});

describe("computeForm1040 — Case B: MFJ $40k, $2k withheld -> refund $1,147", () => {
  const r = computeForm1040(profile({ filingStatus: "mfj" }), w2(40_000, 2_000));
  it("applies the MFJ deduction and bracket", () => {
    expect(r.line12_standardDeduction).toBe(31_500);
    expect(r.line15_taxableIncome).toBe(8_500);
    expect(r.line16_tax).toBe(853);
    expect(r.line34_overpayment).toBe(1_147);
    expect(r.outcome).toBe("refund");
  });
});

describe("computeForm1040 — Case C: Single $40k, only $1k withheld -> owes $1,675", () => {
  const r = computeForm1040(profile({ filingStatus: "single" }), w2(40_000, 1_000));
  it("computes an amount owed", () => {
    expect(r.line24_totalTax).toBe(2_675);
    expect(r.line33_totalPayments).toBe(1_000);
    expect(r.line37_amountOwed).toBe(1_675);
    expect(r.line34_overpayment).toBe(0);
    expect(r.outcome).toBe("owe");
    expect(r.outcomeAmount).toBe(1_675);
  });
});

describe("computeForm1040 — Case D (stretch): Single $40k + 1 child -> CTC $2,200", () => {
  const r = computeForm1040(
    profile({
      filingStatus: "single",
      dependents: [
        { firstName: "Sam", lastName: "Rivera", qualifiesForCTC: true },
      ],
    }),
    w2(40_000, 4_000),
  );
  it("reduces tax by the Child Tax Credit", () => {
    expect(r.line16_tax).toBe(2_675);
    expect(r.line19_childTaxCredit).toBe(2_200);
    expect(r.line22_taxAfterCredits).toBe(475);
    expect(r.line24_totalTax).toBe(475);
    expect(r.line35a_refund).toBe(3_525);
  });
});
