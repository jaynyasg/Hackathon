/** Ingest an uploaded W-2 PDF into the session: extract text, parse fields. */
import { extractPdfText } from "../pdf/extractText";
import { parseW2FromText } from "../pdf/parseW2";
import type { SessionState } from "./session";

export async function ingestW2(
  session: SessionState,
  bytes: Uint8Array,
  filename: string,
): Promise<void> {
  session.w2Bytes = bytes;
  session.w2Filename = filename;
  try {
    const text = await extractPdfText(bytes);
    session.w2RawText = text;
    session.w2 = parseW2FromText(text); // null -> extract_w2 tool reports it couldn't read it
  } catch (err) {
    session.w2RawText = null;
    session.w2 = null;
    console.error("[ingest] extraction failed:", err instanceof Error ? err.message : err);
  }
}
