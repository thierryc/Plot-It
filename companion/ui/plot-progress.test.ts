import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { plotProgress } from "../progress";

const bridge = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  callServerTool: vi.fn(),
  getHostContext: vi.fn(() => ({ theme: "light" })),
  ontoolresult: undefined as ((result: any) => void) | undefined,
  onteardown: undefined as (() => Promise<object>) | undefined,
  onhostcontextchanged: undefined,
}));
vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: vi.fn(function () { return bridge; }),
  applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn(),
}));
const job = (status = "running", completed = 25) => ({
  id: "a".repeat(64), status,
  monitor: plotProgress({ status, durationMs: 120000, elapsedMs: 30000, telemetryAvailable: true, progress: { completed, total: 100 } }),
});
const response = (status = "running", completed = 25) => ({ content: [], structuredContent: job(status, completed) });
let dom: JSDOM;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  bridge.callServerTool.mockReset().mockResolvedValue(response());
  dom = new JSDOM(await readFile("companion/ui/plot-progress.html", "utf8"), { pretendToBeVisual: true });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  await import("./plot-progress");
});
afterEach(async () => {
  await bridge.onteardown?.();
  dom.window.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live conversation card", () => {
  it("loads the preview once instead of downloading it on every tick", async () => {
    bridge.ontoolresult!({ ...response(), content: [{ type: "image", mimeType: "image/png", data: "cHJldmlldw==" }] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(bridge.callServerTool).toHaveBeenCalledWith({ name: "get_job", arguments: { id: "a".repeat(64), includePreview: false } });
    expect(document.querySelector<HTMLImageElement>("#preview")?.hidden).toBe(false);
  });
  it("updates the same card quietly, confirms completion, then stops polling", async () => {
    bridge.ontoolresult!(response());
    expect(document.querySelector("#percentage")?.textContent).toBe("25%");
    bridge.callServerTool.mockResolvedValue(response("running", 100));
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector("#percentage")?.textContent).toBe("99%");
    expect(bridge.callServerTool).toHaveBeenLastCalledWith({ name: "get_job", arguments: { id: "a".repeat(64), includePreview: true } });
    bridge.callServerTool.mockResolvedValue(response("finished", 100));
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector("#title")?.textContent).toBe("Drawing complete");
    expect(document.querySelector("#percentage")?.textContent).toBe("100%");
    expect(document.querySelector<HTMLButtonElement>("#stop")?.hidden).toBe(true);
    const calls = bridge.callServerTool.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(bridge.callServerTool).toHaveBeenCalledTimes(calls);
  });
  it("keeps the last progress visible through a failed refresh and recovers", async () => {
    bridge.ontoolresult!(response());
    bridge.callServerTool.mockRejectedValueOnce(new Error("Plotter connection timed out"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector("#percentage")?.textContent).toBe("25%");
    expect(document.querySelector("#connection-error")?.textContent).toContain("timed out");
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector<HTMLElement>("#connection-error")?.hidden).toBe(true);
  });
  it("requires a second click to stop and does not start drawings", async () => {
    bridge.ontoolresult!(response());
    const stop = document.querySelector<HTMLButtonElement>("#stop")!;
    stop.click();
    expect(bridge.callServerTool).not.toHaveBeenCalled();
    expect(stop.textContent).toBe("Confirm stop");
    stop.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.callServerTool).toHaveBeenCalledWith({ name: "control_job", arguments: { id: "a".repeat(64), action: "stop" } });
    expect(bridge.callServerTool.mock.calls.every(([request]) => request.name !== "start_job")).toBe(true);
  });
  it("cleans up polling when the card is removed", async () => {
    bridge.ontoolresult!(response());
    await bridge.onteardown!();
    await vi.advanceTimersByTimeAsync(20000);
    expect(bridge.callServerTool).not.toHaveBeenCalled();
  });
  it("ignores an older in-flight refresh when the host shows a different job", async () => {
    let complete!: (value: ReturnType<typeof response>) => void;
    bridge.callServerTool.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    bridge.ontoolresult!(response());
    await vi.advanceTimersByTimeAsync(2000);
    bridge.ontoolresult!({ content: [], structuredContent: { ...job("running", 40), id: "b".repeat(64) } });
    complete(response("finished", 100));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("#percentage")?.textContent).toBe("40%");
    expect(document.querySelector("#title")?.textContent).toBe("Drawing in progress");
    await vi.advanceTimersByTimeAsync(2000);
    expect(bridge.callServerTool).toHaveBeenLastCalledWith({ name: "get_job", arguments: { id: "b".repeat(64), includePreview: true } });
  });
});
