/** Presentation shared by the conversation card and plain MCP clients. */
export const PROGRESS_URI = "ui://plotit/plot-progress-v1.html";
export const PROGRESS_MIME = "text/html;profile=mcp-app";

export interface PlotProgressInput {
  status: string;
  durationMs?: number;
  error?: string;
  elapsedMs?: number;
  telemetryAvailable?: boolean;
  progress?: {
    completed?: number;
    total?: number;
    copy?: number;
    copies?: number | "continuous";
    tool?: string;
    label?: string;
    pauseReason?: string;
  };
}

const titles: Record<string, string> = {
  preparing: "Preparing your drawing", pending: "Ready to draw",
  starting: "Starting the plotter", running: "Drawing in progress",
  pausing: "Pausing the plotter", paused: "Drawing paused",
  "tool-change": "Your plotter needs attention", stopping: "Stopping the plotter",
  returning: "Returning to origin", finished: "Drawing complete",
  stopped: "Drawing stopped", failed: "Drawing needs attention",
  interrupted: "Drawing interrupted", cancelled: "Drawing cancelled",
};
export const terminalStates = new Set(["finished", "stopped", "failed", "interrupted", "cancelled"]);
const nonnegative = (value?: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function plotProgress(job: PlotProgressInput) {
  const terminal = terminalStates.has(job.status);
  const p = job.telemetryAvailable ? job.progress : undefined;
  const completed = nonnegative(p?.completed), total = nonnegative(p?.total);
  const copy = p?.copy && Number.isSafeInteger(p.copy) && p.copy > 0 ? p.copy : 1;
  const copies = typeof p?.copies === "number" && Number.isSafeInteger(p.copies) && p.copies > 0 ? p.copies : null;
  // These counters describe queued commands, not settled physical motion.
  // Never show 100% until the runner confirms that the drawing has finished.
  const fraction = job.status === "finished" ? 1
    : ["preparing", "pending"].includes(job.status) ? null
    : completed !== null && total && total > 0
      ? Math.min(0.99, Math.max(0, ((copies ? copy - 1 : 0) + Math.min(1, completed / total)) / (copies ?? 1)))
      : null;
  const duration = nonnegative(job.durationMs);
  const remainingMs = job.status === "finished" ? 0
    : !terminal && !["paused", "pausing", "tool-change", "stopping"].includes(job.status) && fraction !== null && duration !== null
      ? Math.max(0, duration * (1 - fraction)) : null;
  let detail = "Progress is estimated; completion is confirmed by the plotter.";
  if (job.status === "preparing") detail = "Planning pen movements and creating your preview.";
  else if (job.status === "pending") detail = "Preview prepared. The plotter has not started.";
  else if (job.status === "finished") detail = "The plotter has finished and motion has settled.";
  else if (job.status === "tool-change") detail = p?.pauseReason === "layer"
    ? `Check the drawing${p.label ? ` · ${p.label}` : ""}, then Continue in PlotIt MCP.`
    : `Load ${p?.tool || "the next pen"}, then Continue in PlotIt MCP.`;
  else if (job.status === "paused") detail = "Resume when you’re ready. The remaining time will update.";
  else if (job.status === "stopping") detail = "Waiting for physical motion to settle.";
  else if (job.status === "returning") detail = "Finishing the drawing and returning the carriage.";
  else if (terminal) detail = job.error || "The drawing ended before completion.";
  else if (!job.telemetryAvailable) detail = "Waiting for live plotter telemetry. Check the connection in PlotIt MCP.";
  else if (fraction !== null && fraction >= 0.99) detail = "Commands sent. Waiting for the plotter to finish moving.";
  return {
    title: titles[job.status] ?? "Checking your drawing", detail, fraction,
    elapsedMs: job.telemetryAvailable ? nonnegative(job.elapsedMs) : null,
    remainingMs, copy, copies, tool: p?.tool ?? null, terminal,
    telemetryAvailable: job.telemetryAvailable === true,
  };
}
