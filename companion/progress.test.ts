import { describe, it, expect } from "vitest";
import { plotProgress } from "./progress";

describe("conversation drawing progress", () => {
  it("does not claim physical completion from queued commands or elapsed estimates", () => {
    const result = plotProgress({ status: "running", durationMs: 1000, elapsedMs: 5000, telemetryAvailable: true, progress: { completed: 100, total: 100 } });
    expect(result.fraction).toBe(0.99);
    expect(result.terminal).toBe(false);
    expect(result.detail).toContain("Waiting for the plotter");
    expect(plotProgress({ status: "finished" })).toMatchObject({ fraction: 1, terminal: true, remainingMs: 0 });
  });
  it("normalizes multi-copy progress without using interval timers as an ETA", () => {
    expect(plotProgress({ status: "running", durationMs: 40000, telemetryAvailable: true, progress: { completed: 50, total: 100, copy: 2, copies: 4 } })).toMatchObject({ fraction: 0.375, remainingMs: 25000, copy: 2, copies: 4 });
  });
  it("shows attention states and hides remaining time during pauses", () => {
    const input = { durationMs: 1000, telemetryAvailable: true, progress: { completed: 30, total: 100, tool: "blue pen" } };
    expect(plotProgress({ ...input, status: "paused" }).remainingMs).toBeNull();
    expect(plotProgress({ ...input, status: "tool-change" })).toMatchObject({ remainingMs: null, detail: "Load blue pen, then Continue in PlotIt MCP." });
    expect(plotProgress({ ...input, status: "tool-change", progress: { ...input.progress, pauseReason: "layer", label: "Dry ink" } }).detail).toContain("Dry ink");
  });
  it("does not invent progress when telemetry is missing or invalid", () => {
    expect(plotProgress({ status: "running", progress: { completed: 80, total: 100 }, elapsedMs: 2000 })).toMatchObject({ fraction: null, elapsedMs: null, remainingMs: null });
    expect(plotProgress({ status: "running", telemetryAvailable: true, progress: { completed: NaN, total: Infinity } }).fraction).toBeNull();
    expect(plotProgress({ status: "pending" }).fraction).toBeNull();
    expect(plotProgress({ status: "failed", error: "USB disconnected" })).toMatchObject({ terminal: true, detail: "USB disconnected" });
  });
});
