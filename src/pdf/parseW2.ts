/**
 * Deterministic W-2 parser: maps extracted text -> W2Data by anchoring on each
 * box's distinctive label and taking the value that follows. Fast, free, and
 * exact for clean digital W-2s (incl. the sample). Returns null when it can't
 * find the required wage/withholding boxes, signalling the caller to fall back
 * to LLM extraction for messy/unknown layouts.
 */
import { W2Data } from "../shared/contract";

/** First currency value (e.g. "40000.00") appearing after `label`. */
function moneyAfter(text: string, label: string): number | undefined {
  const i = text.indexOf(label);
  if (i < 0) return undefined;
  const m = text.slice(i + label.length).match(/(-?[\d,]+\.\d{2})/);
  const raw = m?.[1];
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** Trimmed text between `start` and the next `end` marker. */
function between(text: string, start: string, end: string): string | undefined {
  const i = text.indexOf(start);
  if (i < 0) return undefined;
  const rest = text.slice(i + start.length);
  const j = rest.indexOf(end);
  const seg = (j < 0 ? rest : rest.slice(0, j)).trim();
  return seg || undefined;
}

export function parseW2FromText(rawText: string): W2Data | null {
  const t = rawText.replace(/\s+/g, " ").trim();

  const box1Wages = moneyAfter(t, "Wages, tips, other compensation");
  const box2FederalWithholding = moneyAfter(t, "Federal income tax withheld");
  if (box1Wages === undefined || box2FederalWithholding === undefined) return null;

  const ssn = t.match(/\b(\d{3}-\d{2}-\d{4})\b/)?.[1];
  const ein =
    t.match(/\(EIN\)\s*(\d{2}-\d{7})/)?.[1] ?? t.match(/\b(\d{2}-\d{7})\b/)?.[1];

  const candidate = {
    employeeName: between(t, "Last name", "f Employee"),
    employeeSSN: ssn,
    employeeAddress: between(t, "Employee's address and ZIP code", "1 Wages"),
    employerName: between(t, "and ZIP code", "Employer address"),
    employerEIN: ein,
    box1Wages,
    box2FederalWithholding,
    box3SocialSecurityWages: moneyAfter(t, "Social security wages"),
    box4SocialSecurityTax: moneyAfter(t, "Social security tax withheld"),
    box5MedicareWages: moneyAfter(t, "Medicare wages and tips"),
    box6MedicareTax: moneyAfter(t, "Medicare tax withheld"),
    box15State: t.match(/\b15\s+State\s+([A-Z]{2})\b/)?.[1],
  };

  // Boundary guard: only return data that satisfies the contract.
  const parsed = W2Data.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
