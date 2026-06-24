/**
 * Generates a realistic FAKE W-2 PDF for testing (PRD: "you supply a realistic
 * fake one"). All data is fictional — no real PII.
 *
 * Box 1 (federal taxable wages, 40,000) is intentionally lower than Boxes 3/5
 * (SS/Medicare wages, 42,000) to model a $2,000 pre-tax 401(k) deferral. A
 * correct extractor must take Box 1 for Form 1040 line 1a — not Box 3/5.
 *
 * The layout draws label then value as adjacent text so the (deterministic)
 * text extractor reads them in order. `npm run gen:w2` writes the file.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Ground-truth values — the single source of truth for the golden test. */
export const SAMPLE_W2 = {
  employeeName: "Alex P. Taxpayer",
  employeeSSN: "123-45-6789",
  employeeAddress: "100 Main St, Austin, TX 78701",
  employerName: "Acme Widgets LLC",
  employerEIN: "12-3456789",
  box1Wages: 40_000,
  box2FederalWithholding: 4_000,
  box3SocialSecurityWages: 42_000,
  box4SocialSecurityTax: 2_604,
  box5MedicareWages: 42_000,
  box6MedicareTax: 609,
  box15State: "TX",
} as const;

const money = (n: number) => n.toFixed(2); // "40000.00" (no commas, payroll style)

export async function generateSampleW2Bytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.05, 0.07);
  const muted = rgb(0.4, 0.4, 0.45);

  let y = 740;
  const left = 40;
  const valueX = 360;

  const title = (t: string) => {
    page.drawText(t, { x: left, y, size: 13, font: bold, color: ink });
    y -= 22;
  };
  const note = (t: string) => {
    page.drawText(t, { x: left, y, size: 8, font, color: muted });
    y -= 16;
  };
  /** Draw "label" at left and "value" at valueX on the same baseline (adjacent
   *  in the content stream so extraction reads label then value). */
  const row = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 9, font, color: ink });
    page.drawText(value, { x: valueX, y, size: 9, font: bold, color: ink });
    y -= 18;
  };
  const gap = (px = 8) => {
    y -= px;
  };

  title("2025 Form W-2  Wage and Tax Statement");
  note("SAMPLE - fictional data for testing only. Not a real W-2. No real PII.");
  gap();

  row("a  Employee's social security number", SAMPLE_W2.employeeSSN);
  row("b  Employer identification number (EIN)", SAMPLE_W2.employerEIN);
  row("c  Employer's name, address, and ZIP code", SAMPLE_W2.employerName);
  row("    Employer address", "500 Commerce Way, Austin, TX 78702");
  row("e  Employee's first name and initial, Last name", SAMPLE_W2.employeeName);
  row("f  Employee's address and ZIP code", SAMPLE_W2.employeeAddress);
  gap();

  row("1  Wages, tips, other compensation", money(SAMPLE_W2.box1Wages));
  row("2  Federal income tax withheld", money(SAMPLE_W2.box2FederalWithholding));
  row("3  Social security wages", money(SAMPLE_W2.box3SocialSecurityWages));
  row("4  Social security tax withheld", money(SAMPLE_W2.box4SocialSecurityTax));
  row("5  Medicare wages and tips", money(SAMPLE_W2.box5MedicareWages));
  row("6  Medicare tax withheld", money(SAMPLE_W2.box6MedicareTax));
  gap();

  row("12a  Code D (401k elective deferral)", money(2_000));
  row("15  State", SAMPLE_W2.box15State);
  row("     Employer's state ID number", "TX-99999");
  row("16  State wages, tips, etc.", "0.00");
  row("17  State income tax", "0.00");

  return await doc.save();
}

async function main(): Promise<void> {
  const bytes = await generateSampleW2Bytes();
  const out = fileURLToPath(new URL("../../assets/sample-w2.pdf", import.meta.url));
  await writeFile(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes)`);
}

// Run as a script (tsx src/pdf/generateSampleW2.ts) but not when imported.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generateSampleW2.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
