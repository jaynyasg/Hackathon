/**
 * HTTP server: serves the static chat UI and the API. Every inbound payload is
 * validated against the contract (pillar 3: input guardrail) before use.
 */
import { fileURLToPath } from "node:url";
import express from "express";
import { CONFIG } from "../agent/config";
import { llmConfigured } from "../agent/llm";
import { ChatTurnRequest, LIMITS, UploadRequest } from "../shared/contract";
import { getSession, resetSession } from "../agent/session";
import { runTurn } from "../agent/loop";
import { ingestW2 } from "../agent/ingest";
import { summarizeSession } from "../agent/observability";
import { GREETING } from "../agent/prompt";

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(fileURLToPath(new URL("../../public", import.meta.url))));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: CONFIG.model, llmConfigured: llmConfigured() });
});

app.get("/api/greeting", (_req, res) => {
  res.json({ greeting: GREETING });
});

app.post("/api/chat", async (req, res) => {
  const parsed = ChatTurnRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.flatten() });
    return;
  }
  if (!llmConfigured()) {
    res.status(503).json({ error: "The assistant isn't configured yet (set OPENAI_API_KEY)." });
    return;
  }
  const session = getSession(parsed.data.sessionId);
  try {
    res.json(await runTurn(session, parsed.data.message));
  } catch (err) {
    console.error("[chat] error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/api/upload", async (req, res) => {
  const parsed = UploadRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid upload", details: parsed.error.flatten() });
    return;
  }
  if (!llmConfigured()) {
    res.status(503).json({ error: "The assistant isn't configured yet (set OPENAI_API_KEY)." });
    return;
  }
  const { sessionId, filename, dataBase64 } = parsed.data;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(dataBase64, "base64"));
  } catch {
    res.status(400).json({ error: "could not decode the file" });
    return;
  }
  if (bytes.length === 0 || bytes.length > LIMITS.maxUploadBytes) {
    res.status(400).json({ error: "the file is empty or too large" });
    return;
  }
  if (!Buffer.from(bytes.subarray(0, 5)).toString("latin1").startsWith("%PDF")) {
    res.status(400).json({ error: "that doesn't look like a PDF — please upload a W-2 PDF" });
    return;
  }

  const session = getSession(sessionId);
  await ingestW2(session, bytes, filename);
  try {
    res.json(await runTurn(session, `I just uploaded my W-2 (file: ${filename}).`));
  } catch (err) {
    console.error("[upload] error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/download", (req, res) => {
  const session = getSession(String(req.query.sessionId ?? ""));
  if (!session.pdfBytes) {
    res.status(404).json({ error: "no completed return yet" });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="form-1040-2025.pdf"');
  res.send(Buffer.from(session.pdfBytes));
});

// Observability endpoint — powers the live trail panel and a judge's inspection.
app.get("/api/trace", (req, res) => {
  const session = getSession(String(req.query.sessionId ?? ""));
  res.json({
    sessionId: session.id,
    turns: session.turns,
    metrics: summarizeSession(session.turns),
    profile: { ...session.profile, ssn: undefined, spouseSSN: undefined },
    hasW2: Boolean(session.w2),
    questionsAsked: session.questionsAsked,
    downloadReady: Boolean(session.pdfBytes),
  });
});

app.post("/api/reset", (req, res) => {
  const sessionId = String((req.body as { sessionId?: string } | undefined)?.sessionId ?? "");
  if (sessionId) resetSession(sessionId);
  res.json({ ok: true });
});

app.listen(CONFIG.port, () => {
  console.log(
    `1040 assistant listening on http://localhost:${CONFIG.port} ` +
      `(model=${CONFIG.model}, llm=${llmConfigured() ? "ready" : "NOT CONFIGURED"})`,
  );
});
