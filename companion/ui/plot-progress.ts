import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { plotProgress } from "../progress";

interface JobView {
  id: string;
  status: string;
  monitor: ReturnType<typeof plotProgress>;
}
interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: { type: string; text?: string; data?: string; mimeType?: string }[];
}
const app = new App({ name: "PlotIt drawing progress", version: "1.0.0" });
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const card = document.querySelector<HTMLElement>(".card")!;
const bar = el<HTMLProgressElement>("progress");
const preview = el<HTMLImageElement>("preview");
const pause = el<HTMLButtonElement>("pause");
const stop = el<HTMLButtonElement>("stop");
const refreshButton = el<HTMLButtonElement>("refresh");
let current: JobView | undefined;
let ready = false, disposed = false, inFlight = false, loadedPreview = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopConfirmation: ReturnType<typeof setTimeout> | undefined;
const labels: Record<string, string> = { preparing: "Preparing", pending: "Ready", starting: "Starting", running: "Live", pausing: "Pausing", paused: "Paused", "tool-change": "Action needed", returning: "Finishing", stopping: "Stopping", finished: "Complete", stopped: "Stopped", failed: "Failed", interrupted: "Interrupted", cancelled: "Cancelled" };
const duration = (ms: number | null) => {
  if (ms === null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function resetStop() {
  clearTimeout(stopConfirmation);
  stop.textContent = "Stop…";
  delete stop.dataset.confirm;
}
function error(message?: string) {
  el("connection-error").hidden = !message;
  el("connection-error").textContent = message ?? "";
  if (message) el("freshness").textContent = "Updates interrupted";
}
function render(job: JobView) {
  const m = job.monitor;
  card.dataset.phase = job.status;
  el("phase").textContent = labels[job.status] ?? job.status;
  if (el("title").textContent !== m.title) el("title").textContent = m.title;
  el("detail").textContent = m.detail;
  el("percentage").textContent = m.fraction === null ? "—" : `${Math.floor(m.fraction * 100)}%`;
  if (m.fraction === null) bar.removeAttribute("value"); else bar.value = m.fraction;
  bar.setAttribute("aria-valuetext", m.fraction === null ? labels[job.status] ?? job.status : `${Math.floor(m.fraction * 100)} percent, ${job.status === "finished" ? "complete" : "estimated"}`);
  el("elapsed").textContent = duration(m.elapsedMs);
  el("remaining").textContent = duration(m.remainingMs);
  el("third-label").textContent = m.copies && m.copies > 1 ? "Copy" : "Plot";
  el("third-value").textContent = m.copies && m.copies > 1 ? `${m.copy} of ${m.copies}` : labels[job.status] ?? job.status;
  el("freshness").textContent = m.terminal ? "Final plotter state" : m.telemetryAvailable ? "Live · updates automatically" : job.status === "pending" ? "Ready when you are" : "Updates automatically";
  pause.hidden = !["running", "paused"].includes(job.status);
  pause.textContent = job.status === "paused" ? "Resume" : "Pause";
  stop.hidden = m.terminal || ["pending", "preparing", "stopping"].includes(job.status);
  if (stop.hidden) resetStop();
}
function consume(result: ToolResult) {
  if (result.isError) throw new Error(result.content?.find(c => c.type === "text")?.text || "Unable to read plotter state.");
  const job = result.structuredContent as unknown as JobView | undefined;
  if (!job?.id || !job.monitor) throw new Error("PlotIt returned an incomplete drawing status. Update the companion and retry.");
  if (current && current.id !== job.id) { loadedPreview = false; preview.hidden = true; preview.removeAttribute("src"); el("preview-placeholder").hidden = false; }
  current = job;
  const image = result.content?.find(c => c.type === "image" && c.mimeType === "image/png" && c.data);
  if (image) {
    preview.src = `data:image/png;base64,${image.data}`;
    preview.hidden = false;
    el("preview-placeholder").hidden = true;
    loadedPreview = true;
  }
  render(job);
  error();
}
function schedule(delay?: number) {
  clearTimeout(timer);
  if (!disposed && current && !current.monitor.terminal && ready) {
    timer = setTimeout(() => void refresh(), delay ?? (current.status === "pending" ? 10000 : current.status === "running" ? 2000 : 4000));
  }
}
function setBusy(busy: boolean) {
  inFlight = busy;
  refreshButton.disabled = busy;
  pause.disabled = stop.disabled = busy || current?.monitor.telemetryAvailable !== true;
}
async function refresh(action?: "pause" | "resume" | "stop") {
  if (!ready || disposed || !current || inFlight) return;
  if (document.hidden && !action) { schedule(5000); return; }
  clearTimeout(timer);
  setBusy(true);
  const jobId = current.id;
  try {
    if (action) {
      const response = await app.callServerTool({ name: "control_job", arguments: { id: jobId, action } });
      if (response.isError) throw new Error(response.content.find(c => c.type === "text")?.text || "The control request failed. Check the current state before retrying.");
      if (disposed || current?.id !== jobId) return;
    }
    const response = await app.callServerTool({ name: "get_job", arguments: { id: jobId, includePreview: !loadedPreview } });
    if (!disposed && current?.id === jobId) consume(response);
  } catch (reason) {
    if (!disposed && current?.id === jobId) error(reason instanceof Error ? reason.message : "Updates interrupted. Reconnecting…");
  } finally { setBusy(false); schedule(); }
}
app.ontoolresult = result => {
  if (disposed) return;
  try { consume(result); schedule(); } catch (reason) { error(reason instanceof Error ? reason.message : "Unable to load drawing."); }
};
const theme = (context: ReturnType<typeof app.getHostContext>) => {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
};
app.onhostcontextchanged = theme;
app.onteardown = async () => { disposed = true; clearTimeout(timer); resetStop(); return {}; };
refreshButton.addEventListener("click", () => void refresh());
pause.addEventListener("click", () => void refresh(current?.status === "paused" ? "resume" : "pause"));
stop.addEventListener("click", () => {
  if (stop.dataset.confirm === "true") { resetStop(); void refresh("stop"); }
  else { stop.dataset.confirm = "true"; stop.textContent = "Confirm stop"; stopConfirmation = setTimeout(resetStop, 5000); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
window.addEventListener("pagehide", () => { disposed = true; clearTimeout(timer); resetStop(); });
void app.connect().then(() => { ready = true; theme(app.getHostContext()); schedule(); }).catch(reason => error(`This client could not connect the live card: ${reason instanceof Error ? reason.message : "unknown error"}. Ask your agent for the drawing status.`));
