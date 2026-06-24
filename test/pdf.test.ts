import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { computeForm1040 } from "../src/tax/engine";
import { fillForm1040, FORM_1040_PATH } from "../src/pdf/fill";
import {
  DOLLAR_FIELD_MAP,
  FILING_STATUS_CHECKBOX,
  FORM_1040_FIELDS,
  formatMoneyForForm,
} from "../src/pdf/fieldMap2025";
import type { TaxpayerProfile } from "../src/shared/contract";

const profile: TaxpayerProfile = {
  firstName: "Alex",
  lastName: "Taxpayer",
  ssn: "123-45-6789",
  filingStatus: "single",
  address: { line1: "100 Main St", city: "Austin", state: "TX", zip: "78701" },
  dependents: [],
};
const result = computeForm1040(profile, { box1Wages: 40_000, box2FederalWithholding: 4_000 });

describe("field map verification — every mapped name exists in the real 2025 form", () => {
  let actualNames: Set<string>;
  beforeAll(async () => {
    const doc = await PDFDocument.load(new Uint8Array(await readFile(FORM_1040_PATH)));
    actualNames = new Set(doc.getForm().getFields().map((f) => f.getName()));
  });

  it("has all identity + sum fields", () => {
    for (const name of Object.values(FORM_1040_FIELDS)) {
      expect(actualNames, `missing field: ${name}`).toContain(name);
    }
  });
  it("has all filing-status checkboxes", () => {
    for (const name of Object.values(FILING_STATUS_CHECKBOX)) {
      expect(actualNames, `missing checkbox: ${name}`).toContain(name);
    }
  });
  it("has all dollar-line fields", () => {
    for (const name of Object.values(DOLLAR_FIELD_MAP)) {
      expect(actualNames, `missing dollar field: ${name}`).toContain(name);
    }
  });
});

describe("round-trip — filled values survive a read-back (C4)", () => {
  let filled: PDFDocument;
  beforeAll(async () => {
    const bytes = await fillForm1040(result, profile);
    filled = await PDFDocument.load(bytes);
  });

  it("produces a valid, non-trivial PDF", () => {
    expect(filled.getPageCount()).toBe(2);
  });

  it("checks exactly the Single filing-status box", () => {
    const form = filled.getForm();
    expect(form.getCheckBox(FILING_STATUS_CHECKBOX.single).isChecked()).toBe(true);
    expect(form.getCheckBox(FILING_STATUS_CHECKBOX.mfj).isChecked()).toBe(false);
  });

  it("writes identity fields", () => {
    const form = filled.getForm();
    expect(form.getTextField(FORM_1040_FIELDS.firstName).getText()).toBe("Alex");
    expect(form.getTextField(FORM_1040_FIELDS.lastName).getText()).toBe("Taxpayer");
    expect(form.getTextField(FORM_1040_FIELDS.addressZip).getText()).toBe("78701");
  });

  it("writes every dollar line with the rounded, formatted value", () => {
    const form = filled.getForm();
    for (const [key, field] of Object.entries(DOLLAR_FIELD_MAP)) {
      const value = result[key as keyof typeof result];
      const expected = typeof value === "number" ? formatMoneyForForm(value) : "";
      const got = form.getTextField(field).getText() ?? "";
      expect(got, `field ${field} (${key})`).toBe(expected);
    }
  });

  it("places the key numbers correctly: wages, taxable, tax, refund", () => {
    const form = filled.getForm();
    const text = (n: string) => form.getTextField(n).getText() ?? "";
    expect(text(DOLLAR_FIELD_MAP.line1a_wages!)).toBe("40,000");
    expect(text(DOLLAR_FIELD_MAP.line15_taxableIncome!)).toBe("24,250");
    expect(text(DOLLAR_FIELD_MAP.line16_tax!)).toBe("2,675");
    expect(text(DOLLAR_FIELD_MAP.line35a_refund!)).toBe("1,325");
    expect(text(DOLLAR_FIELD_MAP.line37_amountOwed!)).toBe(""); // blank on refund
  });
});
