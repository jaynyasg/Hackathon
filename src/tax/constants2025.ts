/**
 * TY2025 federal tax constants (IRS Rev. Proc. 2024-40; OBBBA P.L. 119-21).
 *
 * Ported from the opentax/UsTaxes reference data and cross-checked against the
 * standard-deduction figures printed on the 2025 Form 1040 itself
 * (Single $15,750 / MFJ $31,500 / HOH $23,625).
 *
 * Brackets carry a pre-computed `base` (cumulative tax at `over`) so the tax of
 * an income I in bracket (over, upTo] is exactly `base + rate * (I - over)`.
 */
import type { FilingStatus } from "../shared/contract";

export type Bracket = {
  readonly over: number;
  readonly upTo: number;
  readonly rate: number;
  readonly base: number;
};

/** IRC §1(c) — Single */
const BRACKETS_SINGLE: readonly Bracket[] = [
  { over: 0, upTo: 11_925, rate: 0.1, base: 0 },
  { over: 11_925, upTo: 48_475, rate: 0.12, base: 1_192.5 },
  { over: 48_475, upTo: 103_350, rate: 0.22, base: 5_578.5 },
  { over: 103_350, upTo: 197_300, rate: 0.24, base: 17_651 },
  { over: 197_300, upTo: 250_525, rate: 0.32, base: 40_199 },
  { over: 250_525, upTo: 626_350, rate: 0.35, base: 57_231 },
  { over: 626_350, upTo: Infinity, rate: 0.37, base: 188_769.75 },
];

/** IRC §1(d) — Married Filing Separately */
const BRACKETS_MFS: readonly Bracket[] = [
  { over: 0, upTo: 11_925, rate: 0.1, base: 0 },
  { over: 11_925, upTo: 48_475, rate: 0.12, base: 1_192.5 },
  { over: 48_475, upTo: 103_350, rate: 0.22, base: 5_578.5 },
  { over: 103_350, upTo: 197_300, rate: 0.24, base: 17_651 },
  { over: 197_300, upTo: 250_525, rate: 0.32, base: 40_199 },
  { over: 250_525, upTo: 375_800, rate: 0.35, base: 57_231 },
  { over: 375_800, upTo: Infinity, rate: 0.37, base: 101_077.25 },
];

/** IRC §1(b) — Head of Household */
const BRACKETS_HOH: readonly Bracket[] = [
  { over: 0, upTo: 17_000, rate: 0.1, base: 0 },
  { over: 17_000, upTo: 64_850, rate: 0.12, base: 1_700 },
  { over: 64_850, upTo: 103_350, rate: 0.22, base: 7_442 },
  { over: 103_350, upTo: 197_300, rate: 0.24, base: 15_912 },
  { over: 197_300, upTo: 250_500, rate: 0.32, base: 38_460 },
  { over: 250_500, upTo: 626_350, rate: 0.35, base: 55_484 },
  { over: 626_350, upTo: Infinity, rate: 0.37, base: 187_031.5 },
];

/** IRC §1(a) — Married Filing Jointly / Qualifying Surviving Spouse */
const BRACKETS_MFJ: readonly Bracket[] = [
  { over: 0, upTo: 23_850, rate: 0.1, base: 0 },
  { over: 23_850, upTo: 96_950, rate: 0.12, base: 2_385 },
  { over: 96_950, upTo: 206_700, rate: 0.22, base: 11_157 },
  { over: 206_700, upTo: 394_600, rate: 0.24, base: 35_302 },
  { over: 394_600, upTo: 501_050, rate: 0.32, base: 80_398 },
  { over: 501_050, upTo: 751_600, rate: 0.35, base: 114_462 },
  { over: 751_600, upTo: Infinity, rate: 0.37, base: 202_154.5 },
];

export const BRACKETS_2025: Record<FilingStatus, readonly Bracket[]> = {
  single: BRACKETS_SINGLE,
  mfs: BRACKETS_MFS,
  hoh: BRACKETS_HOH,
  mfj: BRACKETS_MFJ,
  qss: BRACKETS_MFJ, // QSS uses the MFJ rate schedule
};

/** Base standard deduction by filing status (TY2025, post-OBBBA). */
export const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15_750,
  mfs: 15_750,
  hoh: 23_625,
  mfj: 31_500,
  qss: 31_500,
};

/** Below this taxable income, the IRS requires the Tax Table (not the formula). */
export const TAX_TABLE_CEILING_2025 = 100_000;

/** Child Tax Credit per qualifying child under 17 (TY2025, OBBBA). */
export const CTC_PER_CHILD_2025 = 2_200;

/** Credit for Other Dependents (non-CTC dependents) (TY2025). */
export const ODC_PER_DEPENDENT_2025 = 500;

/** CTC/ODC phase-out begins above this MAGI (all statuses except MFJ). */
export const CTC_PHASEOUT_THRESHOLD_OTHER_2025 = 200_000;
/** CTC/ODC phase-out begins above this MAGI (MFJ/QSS). */
export const CTC_PHASEOUT_THRESHOLD_MFJ_2025 = 400_000;
