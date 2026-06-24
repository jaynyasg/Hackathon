/**
 * Proof-of-life: run the WHOLE deterministic pipeline once on the sample W-2 —
 * extract -> parse -> compute -> fill — print a line-by-line 1040 to eyeball,
 * and write out/sample-1040-filled.pdf to open in any viewer (prd-compile
 * step 5). The in-browser visual check happens later against the running app.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { generateSampleW2Bytes } from "../src/pdf/generateSampleW2";
import { extractPdfText } from "../src/pdf/extractText";
import { parseW2FromText } from "../src/pdf/parseW2";
import { computeForm1040 } from "../src/tax/engine";
import { fillForm1040 } from "../src/pdf/fill";
import { FILING_STATUS_LABEL, type TaxpayerProfile } from "../src/shared/contract";

const w2Bytes = await generateSampleW2Bytes();
const w2 = parseW2FromText(await extractPdfText(w2Bytes));
if (!w2) throw new Error("proof-of-life: W-2 parse failed");

const profile: TaxpayerProfile = {
  firstName: "Alex P.",
  lastName: "Taxpayer",
  ssn: w2.employeeSSN,
  filingStatus: "single",
  address: { line1: "100 Main St", city: "Austin", state: "TX", zip: "78701" },
  dependents: [],
};

const r = computeForm1040(profile, w2);
const m = (n: number) => n.toLocaleString("en-US").padStart(10);

console.log(`\n=== Filled 2025 Form 1040 (${FILING_STATUS_LABEL[r.filingStatus]}) — ${profile.firstName} ${profile.lastName} ===`);
console.log(`W-2 read: Box 1 wages=${w2.box1Wages}  Box 2 withheld=${w2.box2FederalWithholding}  (Box 3 SS wages=${w2.box3SocialSecurityWages})`);
console.log("-".repeat(48));
console.log(`Line 1a  Wages .................... ${m(r.line1a_wages)}`);
console.log(`Line 9   Total income ............ ${m(r.line9_totalIncome)}`);
console.log(`Line 11  AGI ..................... ${m(r.line11_agi)}`);
console.log(`Line 12  Standard deduction ...... ${m(r.line12_standardDeduction)}`);
console.log(`Line 15  Taxable income ......... ${m(r.line15_taxableIncome)}`);
console.log(`Line 16  Tax ..................... ${m(r.line16_tax)}`);
console.log(`Line 24  Total tax ............... ${m(r.line24_totalTax)}`);
console.log(`Line 25d Withholding ............. ${m(r.line25d_totalWithholding)}`);
console.log(`Line 33  Total payments .......... ${m(r.line33_totalPayments)}`);
console.log(`Line 34  Overpayment (refund) .... ${m(r.line34_overpayment)}`);
console.log(`Line 37  Amount owed ............. ${m(r.line37_amountOwed)}`);
console.log("-".repeat(48));
console.log(`OUTCOME: ${r.outcome.toUpperCase()} $${r.outcomeAmount.toLocaleString("en-US")}\n`);

const pdf = await fillForm1040(r, profile);
await mkdir("out", { recursive: true });
await writeFile("out/sample-1040-filled.pdf", pdf);
console.log(`Wrote out/sample-1040-filled.pdf (${pdf.length} bytes) — open it to eyeball the rendered form.`);
