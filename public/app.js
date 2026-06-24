// Minimal vanilla chat client + live observation trail. No build step.
const sessionId =
  (crypto.randomUUID && crypto.randomUUID()) || "s-" + Math.random().toString(36).slice(2);

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const turnsEl = $("turns");
const metricsEl = $("metrics");
const stateEl = $("state");
const qcountEl = $("qcount");
const inputEl = $("input");
const fileEl = $("file");
const composer = $("composer");
const downloadBar = $("downloadBar");

const observations = [];
let busy = false;

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setBusy(b) {
  busy = b;
  inputEl.disabled = b;
  composer.querySelector('button[type="submit"]').disabled = b;
}

const usd = (n) => "$" + Number(n).toFixed(5);
const ms = (n) => Math.round(n) + "ms";
const dollars = (n) => "$" + Number(n).toLocaleString("en-US");

function renderMetrics() {
  const n = observations.length;
  const totalCost = observations.reduce((s, o) => s + o.costUsd, 0);
  const sorted = observations.map((o) => o.latencyMs).sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] : 0;
  const errors = observations.filter((o) => o.error).length;
  const cell = (k, v) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`;
  metricsEl.innerHTML =
    cell("turns", n) +
    cell("$/run", usd(totalCost)) +
    cell("p95", ms(p95)) +
    cell("err", (n ? (errors / n) * 100 : 0).toFixed(0) + "%");
}

function renderTurn(obs) {
  observations.push(obs);
  const tools = obs.toolCalls.length
    ? obs.toolCalls
        .map((t) => `<span class="tool ${t.ok ? "" : "fail"}" title="${t.summary || ""}">${t.name}${t.ok ? "" : " ✗"}</span>`)
        .join("")
    : '<span class="muted small">no tools</span>';
  const guards = (obs.guardrailHits || []).length
    ? `<div class="guards">guardrails: ${obs.guardrailHits.join(", ")}</div>`
    : "";
  const div = document.createElement("div");
  div.className = "turn";
  div.innerHTML =
    `<div class="turn-head">#${obs.turn}` +
    `<span class="meta">${ms(obs.latencyMs)} · ${obs.promptTokens + obs.completionTokens} tok · ${usd(obs.costUsd)}</span></div>` +
    `<div class="tools">${tools}</div>${guards}`;
  turnsEl.appendChild(div);
  turnsEl.scrollTop = turnsEl.scrollHeight;
  renderMetrics();
}

function renderState(data) {
  qcountEl.textContent = data.questionsAsked ?? 0;
  const p = data.profile || {};
  const chips = [`<span class="chip">W-2: ${data.hasW2 ? "✓ read" : "—"}</span>`];
  if (p.filingStatus) chips.push(`<span class="chip">${p.filingStatus.toUpperCase()}</span>`);
  if (p.dependents && p.dependents.length) chips.push(`<span class="chip">${p.dependents.length} dependent(s)</span>`);
  if (data.result) {
    const r = data.result;
    chips.push(`<span class="chip">taxable ${dollars(r.line15_taxableIncome)}</span>`);
    const label = r.outcome === "refund" ? "Refund" : r.outcome === "owe" ? "You owe" : "Balanced";
    chips.push(`<div class="headline ${r.outcome}">${label}: ${dollars(r.outcomeAmount)}</div>`);
  }
  stateEl.innerHTML = chips.join("");
}

function handleResponse(data) {
  if (data && data.error) {
    addMessage("assistant", data.error);
    return;
  }
  addMessage("assistant", data.reply);
  if (data.observation) renderTurn(data.observation);
  renderState(data);
  if (data.downloadReady) downloadBar.classList.remove("hidden");
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function send(text) {
  if (busy || !text.trim()) return;
  addMessage("user", text);
  setBusy(true);
  const typing = addMessage("assistant typing", "Ada is typing…");
  try {
    const j = await postJson("/api/chat", { sessionId, message: text });
    typing.remove();
    handleResponse(j);
  } catch {
    typing.remove();
    addMessage("assistant", "Network hiccup — please try again.");
  } finally {
    setBusy(false);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function upload(file) {
  if (busy) return;
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    addMessage("assistant", "Please upload your W-2 as a PDF.");
    return;
  }
  addMessage("user", "📎 " + file.name);
  setBusy(true);
  const typing = addMessage("assistant typing", "Reading your W-2…");
  try {
    const dataBase64 = await fileToBase64(file);
    const j = await postJson("/api/upload", { sessionId, filename: file.name, dataBase64 });
    typing.remove();
    handleResponse(j);
  } catch {
    typing.remove();
    addMessage("assistant", "Upload failed — please try again.");
  } finally {
    setBusy(false);
  }
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value;
  inputEl.value = "";
  send(text);
});
fileEl.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) upload(f);
  fileEl.value = "";
});
$("downloadBtn").addEventListener("click", () => {
  window.location.href = "/api/download?sessionId=" + encodeURIComponent(sessionId);
});

(async function init() {
  try {
    const r = await fetch("/api/greeting");
    const j = await r.json();
    addMessage("assistant", j.greeting);
  } catch {
    addMessage("assistant", "Hi! Upload your W-2 (PDF) to get started.");
  }
  renderMetrics();
})();
