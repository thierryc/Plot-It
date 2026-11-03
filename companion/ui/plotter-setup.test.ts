import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { defaultMachine, fingerprint } from "../common";
const bridge = vi.hoisted(() => ({ connect: vi.fn(async () => {}), callServerTool: vi.fn(), getHostContext: vi.fn(() => ({ theme: "light" })), ontoolresult: undefined as ((result: any) => void) | undefined, onteardown: undefined as (() => Promise<object>) | undefined, onhostcontextchanged: undefined }));
vi.mock("@modelcontextprotocol/ext-apps", () => ({ App: vi.fn(function () { return bridge; }), applyDocumentTheme: vi.fn(), applyHostStyleVariables: vi.fn() }));
const status = () => ({ config: { ...defaultMachine }, configDigest: fingerprint(defaultMachine), configured: true, armed: false, nativeSessionActive: true, agentControlEnabled: true, controlBlocker: "Connect your plotter.", machineProfiles: [{ id: "axidraw", name: "AxiDraw A4" }], paperPresets: [{ name: "A4 portrait", width: 210, height: 297 }], devices: [], runner: null as null | { connected: boolean; status: string; origin: string } });
const result = (value = status()) => ({ content: [], structuredContent: value });
let dom: JSDOM;
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); bridge.callServerTool.mockReset().mockResolvedValue(result());
  dom = new JSDOM(await readFile("companion/ui/plotter-setup.html", "utf8"), { pretendToBeVisual: true });
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
  await import("./plotter-setup");
});
afterEach(async () => { await bridge.onteardown?.(); dom.window.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const change = (id: string, value: string) => { element<HTMLInputElement>(id).value = value; element(id).dispatchEvent(new dom.window.Event("change", { bubbles: true })); };
describe("conversation setup card", () => {
  it("opens without changing settings or hardware and refreshes quietly", async () => {
    bridge.ontoolresult!(result());
    expect(bridge.callServerTool).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(bridge.callServerTool).toHaveBeenCalledWith({ name: "get_setup", arguments: {} }, { timeout: 60000 });
  });
  it("saves custom paper dimensions with a stale-settings guard", async () => {
    bridge.ontoolresult!(result()); change("paper", "custom"); change("widthMm", "222.5");
    element<HTMLFormElement>("settings").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.callServerTool).toHaveBeenCalledWith({ name: "configure_plotter", arguments: { settings: expect.objectContaining({ widthMm: 222.5, heightMm: 297 }), expectedConfigDigest: fingerprint(defaultMachine) } }, { timeout: 60000 });
  });
  it("preserves local edits and prevents overwrite after another client saves", () => {
    bridge.ontoolresult!(result()); change("penUp", "45");
    const changed = status(); changed.config.penUp = 30; changed.configDigest = fingerprint(changed.config);
    bridge.ontoolresult!(result(changed));
    expect(element<HTMLInputElement>("penUp").value).toBe("45");
    expect(element<HTMLButtonElement>("save").disabled).toBe(true);
    expect(element("error").textContent).toContain("another window");
    element("reload").click();
    expect(element<HTMLInputElement>("penUp").value).toBe("30");
  });
  it("requires physical origin confirmation and disables hardware actions while drawing", async () => {
    const ready = status(); ready.runner = { connected: true, status: "idle", origin: "unset" };
    bridge.ontoolresult!(result(ready));
    expect(element<HTMLButtonElement>("set-origin").disabled).toBe(true);
    element<HTMLInputElement>("confirm-origin").click(); element("set-origin").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.callServerTool).toHaveBeenCalledWith({ name: "set_plotter_origin", arguments: { currentPositionConfirmed: true } }, { timeout: 60000 });
    ready.runner.status = "running"; bridge.ontoolresult!(result(ready));
    for (const id of ["connect", "pen-up", "pen-down", "set-origin"]) expect(element<HTMLButtonElement>(id).disabled).toBe(true);
  });
  it("requires a new origin confirmation after the hardware connection changes", () => {
    const ready = status(); ready.runner = { connected: true, status: "idle", origin: "unset" };
    bridge.ontoolresult!(result(ready));
    element<HTMLInputElement>("confirm-origin").click();
    expect(element<HTMLButtonElement>("set-origin").disabled).toBe(false);
    bridge.ontoolresult!(result({ ...ready, runner: { ...ready.runner, connected: false } }));
    bridge.ontoolresult!(result(ready));
    expect(element<HTMLInputElement>("confirm-origin").checked).toBe(false);
    expect(element<HTMLButtonElement>("set-origin").disabled).toBe(true);
  });
});
