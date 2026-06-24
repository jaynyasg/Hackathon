/**
 * Fill the 2025 Form 1040 AcroForm from a computed result + taxpayer profile.
 *
 * Keeps the form fields live (does not flatten) so values can be read back for
 * verification (C4) and a judge can still inspect/adjust the form.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import type { Form1040Result, TaxpayerProfile } from "../shared/contract";
import {
  DOLLAR_FIELD_MAP,
  FILING_STATUS_CHECKBOX,
  FORM_1040_FIELDS,
  formatMoneyForForm,
} from "./fieldMap2025";

/** Path to the blank 2025 form shipped in the repo. */
export const FORM_1040_PATH = fileURLToPath(
  new URL("../../assets/f1040.pdf", import.meta.url),
);

export async function fillForm1040(
  result: Form1040Result,
  profile: TaxpayerProfile,
  formBytes?: Uint8Array,
): Promise<Uint8Array> {
  const bytes = formBytes ?? new Uint8Array(await readFile(FORM_1040_PATH));
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  // Respect each field's maxLength (truncate + warn) instead of throwing, so
  // arbitrary names/addresses from the live system never crash the fill.
  const setText = (name: string, value: string | undefined) => {
    if (!value) return;
    const field = form.getTextField(name);
    const max = field.getMaxLength();
    let v = value;
    if (max !== undefined && v.length > max) {
      console.warn(`[fill] truncating "${name}" from ${v.length} to maxLength ${max}`);
      v = v.slice(0, max);
    }
    field.setText(v);
  };
  const ssnDigits = (s: string | undefined) =>
    s ? s.replace(/\D/g, "").slice(0, 9) : undefined;

  // Identity.
  setText(FORM_1040_FIELDS.firstName, profile.firstName);
  setText(FORM_1040_FIELDS.lastName, profile.lastName);
  setText(FORM_1040_FIELDS.ssn, ssnDigits(profile.ssn));
  if (profile.filingStatus === "mfj" || profile.filingStatus === "mfs") {
    setText(FORM_1040_FIELDS.spouseFirstName, profile.spouseFirstName);
    setText(FORM_1040_FIELDS.spouseLastName, profile.spouseLastName);
    setText(FORM_1040_FIELDS.spouseSSN, ssnDigits(profile.spouseSSN));
  }
  setText(FORM_1040_FIELDS.addressLine1, profile.address?.line1);
  setText(FORM_1040_FIELDS.addressCity, profile.address?.city);
  setText(FORM_1040_FIELDS.addressState, profile.address?.state);
  setText(FORM_1040_FIELDS.addressZip, profile.address?.zip);

  // Filing status checkbox (exactly one).
  form.getCheckBox(FILING_STATUS_CHECKBOX[result.filingStatus]).check();

  // Dollar lines from the computed result.
  for (const [key, field] of Object.entries(DOLLAR_FIELD_MAP)) {
    const value = result[key as keyof Form1040Result];
    if (typeof value === "number") setText(field, formatMoneyForForm(value));
  }

  // AGI also prints on page 2 (line 11b); intermediate sums lines 18 & 21.
  setText(FORM_1040_FIELDS.agiPage2, formatMoneyForForm(result.line11_agi));
  setText(FORM_1040_FIELDS.line18Sum, formatMoneyForForm(result.line16_tax));
  setText(FORM_1040_FIELDS.line21Sum, formatMoneyForForm(result.line19_childTaxCredit));

  // Ensure viewers render the values we set.
  form.updateFieldAppearances();
  return await doc.save();
}
