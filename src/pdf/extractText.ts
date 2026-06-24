/**
 * Deterministic PDF -> text extraction (pdfjs-dist, Node legacy build).
 * Used to read uploaded W-2 PDFs before parsing/structuring their fields.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // pdfjs may mutate/transfer the buffer; hand it a private copy.
  const data = new Uint8Array(bytes);
  const doc = await getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ");
      pages.push(line);
    }
    return pages.join("\n");
  } finally {
    await doc.destroy();
  }
}
