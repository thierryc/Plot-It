import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { MachineConfig } from "../common";

interface SetupStatus {
  config: MachineConfig; configDigest: string; configured: boolean; armed: boolean;
  nativeSessionActive: boolean; controlBlocker: string | null;
  machineProfiles: { id: string; name: string }[];
  paperPresets: { name: string; width: number; height: number }[];
  devices: { path: string; manufacturer?: string; vendorId?: string; productId?: string }[];
  runner: { connected: boolean; status: string; origin: string; firmware?: string } | null;
}
interface SetupResult { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }
const app = new App({ name: "PlotIt plotter setup", version: "1.0.0" });
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => get<HTMLInputElement>(id);
const select = (id: string) => get<HTMLSelectElement>(id);
const form = get<HTMLFormElement>("settings");
let state: SetupStatus | undefined, baseDigest = "", dirty = false, busy = false, connected = false, disposed = false, conflict = false;
let customSize = { width: 210, height: 297 };
let timer: ReturnType<typeof setTimeout> | undefined;
const numeric = ["rotation", "widthMm", "heightMm", "penUp", "penDown", "speed", "travelSpeed"] as const;
const idle = () => !state?.runner || ["idle", "pending", "finished", "stopped", "failed", "interrupted"].includes(state.runner.status);
function message(id: "notice" | "error", text = "") { get(id).textContent = text; get(id).hidden = !text; }
function choices(element: HTMLSelectElement, values: { value: string; text: string }[], selected: string) {
  element.replaceChildren(...values.map(value => { const option = document.createElement("option"); option.value = value.value; option.textContent = value.text; return option; }));
  element.value = selected;
}
function paperSelection() {
  const preset = state?.paperPresets.find(p => p.name === select("paper").value);
  get("custom").hidden = !!preset;
  if (preset) { input("widthMm").value = String(preset.width); input("heightMm").value = String(preset.height); }
  get("dimensions").textContent = `${input("widthMm").value} × ${input("heightMm").value} mm`;
}
function populate() {
  if (!state) return;
  const c = state.config;
  choices(select("profile"), state.machineProfiles.map(p => ({ value: p.id, text: p.name })), c.profile);
  const preset = state.paperPresets.find(p => Math.abs(p.width - c.widthMm) < .005 && Math.abs(p.height - c.heightMm) < .005);
  choices(select("paper"), [...state.paperPresets.map(p => ({ value: p.name, text: p.name })), { value: "custom", text: "Custom…" }], preset?.name ?? "custom");
  const devices = state.devices.map(d => ({ value: d.path, text: `${d.manufacturer ? d.manufacturer + " · " : ""}${d.path}` }));
  if (c.device && !devices.some(d => d.value === c.device)) devices.push({ value: c.device, text: `${c.device} · unavailable` });
  choices(select("device"), [{ value: "", text: "Auto-detect one EBB plotter" }, ...devices], c.device);
  for (const key of numeric) input(key).value = String(c[key]);
  select("servo").value = c.servo;
  input("firmware").value = c.firmware;
  customSize = { width: c.widthMm, height: c.heightMm };
  baseDigest = state.configDigest; dirty = false; conflict = false;
  paperSelection();
}
function render() {
  if (!state) return;
  const canSetup = state.nativeSessionActive && idle() && !busy;
  const usb = state.runner?.connected === true;
  const origin = usb && ["automatic", "explicit"].includes(state.runner?.origin ?? "unset");
  get<HTMLFieldSetElement>("fields").disabled = !canSetup;
  get<HTMLButtonElement>("save").disabled = !canSetup || conflict || !form.checkValidity();
  get<HTMLButtonElement>("connect").disabled = !canSetup || !state.configured || (!usb && (dirty || conflict));
  get("connect").textContent = usb ? "Disconnect plotter" : "Connect plotter";
  for (const id of ["pen-up", "pen-down"]) get<HTMLButtonElement>(id).disabled = !canSetup || !usb;
  input("confirm-origin").disabled = !canSetup || !usb;
  get<HTMLButtonElement>("set-origin").disabled = !canSetup || !usb || !input("confirm-origin").checked;
  get<HTMLButtonElement>("refresh").disabled = busy;
  get("saved").dataset.done = String(state.configured && !dirty);
  get("saved").textContent = dirty ? "Save your changes" : state.configured ? "Machine settings saved" : "Save machine settings";
  get("connected").dataset.done = String(usb);
  get("connected").textContent = usb ? `USB connected${state.runner?.firmware ? " · " + state.runner.firmware : ""}` : "Connect USB";
  get("origin-ready").dataset.done = String(origin);
  get("origin-ready").textContent = origin ? "Drawing origin established" : "Set drawing origin";
  get("connection").textContent = !state.nativeSessionActive ? "Open the Mac companion" : !idle() ? "Drawing in progress" : usb ? "Plotter connected" : "Companion connected";
  const count = state.devices.filter(d => d.vendorId?.toLowerCase() === "04d8" && d.productId?.toLowerCase() === "fd92").length;
  get("device-help").textContent = count === 1 ? "One compatible EBB plotter detected." : count > 1 ? "Multiple EBB plotters detected. Choose the USB device to use." : "No EBB plotter detected. Connect USB, then refresh devices.";
  get("control").textContent = state.armed ? "Ready · agents can start drawings when requested." : state.controlBlocker ?? "Waiting for the plotter to be ready.";
  get("freshness").textContent = busy ? "Working…" : dirty ? "Unsaved changes · live status updates" : "Status updates automatically";
}
function consume(result: SetupResult, reset = false) {
  if (result.isError) throw new Error(result.content?.find(c => c.type === "text")?.text || "Plotter setup failed.");
  const next = result.structuredContent as SetupStatus | undefined;
  if (!next?.config || !next.configDigest || !next.machineProfiles || !next.paperPresets || !next.devices) throw new Error("Incomplete setup status. Update PlotIt MCP and refresh.");
  if (state && (state.configDigest !== next.configDigest || state.runner?.connected !== next.runner?.connected || state.runner?.origin !== next.runner?.origin)) input("confirm-origin").checked = false;
  state = next;
  if (!dirty || reset) populate();
  else if (baseDigest !== next.configDigest) { conflict = true; message("error", "Settings changed in another window or agent. Reload saved settings before saving your changes."); }
  render();
}
function schedule() {
  clearTimeout(timer);
  if (connected && !disposed) timer = setTimeout(() => void refresh(), 5000);
}
async function request(name: string, args: Record<string, unknown> = {}, notice?: string) {
  if (!connected || busy || disposed) return;
  clearTimeout(timer); busy = true; render();
  try {
    const result = await app.callServerTool({ name, arguments: args }, { timeout: 60000 });
    consume(result, name === "configure_plotter");
    if (!conflict) message("error");
    if (notice) message("notice", notice);
    if (name === "set_plotter_origin") input("confirm-origin").checked = false;
  } catch (e) { message("error", e instanceof Error ? e.message : "Setup did not complete. Refresh the current state before retrying."); }
  finally { busy = false; render(); schedule(); }
}
async function refresh() { if (document.hidden) { schedule(); return; } await request("get_setup"); }
form.addEventListener("input", () => { dirty = true; message("notice"); paperSelection(); render(); });
form.addEventListener("change", () => { dirty = true; message("notice"); render(); });
select("paper").addEventListener("change", () => {
  if (select("paper").value === "custom") { input("widthMm").value = String(customSize.width); input("heightMm").value = String(customSize.height); }
  paperSelection(); dirty = true; render();
});
for (const key of ["widthMm", "heightMm"]) input(key).addEventListener("input", () => { if (form.checkValidity()) customSize = { width: input("widthMm").valueAsNumber, height: input("heightMm").valueAsNumber }; });
form.addEventListener("submit", event => {
  event.preventDefault(); if (!state || conflict || !form.reportValidity()) return;
  const settings: Record<string, unknown> = Object.fromEntries(numeric.map(key => [key, Number(input(key).value)]));
  Object.assign(settings, { profile: select("profile").value, device: select("device").value, servo: select("servo").value, firmware: input("firmware").value });
  void request("configure_plotter", { settings, expectedConfigDigest: baseDigest }, "Settings saved. Connect the plotter and establish its origin.");
});
get("reload").addEventListener("click", () => { populate(); message("error"); message("notice", "Loaded the saved machine settings."); render(); });
get("connect").addEventListener("click", () => void request(state?.runner?.connected ? "disconnect_plotter" : "connect_plotter"));
get("pen-up").addEventListener("click", () => void request("test_pen", { down: false }, "Pen up test completed."));
get("pen-down").addEventListener("click", () => void request("test_pen", { down: true }, "Pen down test completed."));
input("confirm-origin").addEventListener("change", render);
get("set-origin").addEventListener("click", () => { if (input("confirm-origin").checked) void request("set_plotter_origin", { currentPositionConfirmed: true }, "Origin captured. The connected plotter is ready."); });
get("refresh").addEventListener("click", () => void refresh());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
app.ontoolresult = result => { if (disposed) return; try { consume(result); schedule(); } catch (e) { message("error", e instanceof Error ? e.message : "Unable to load setup."); } };
const theme = (ctx: ReturnType<typeof app.getHostContext>) => { if (ctx?.theme) applyDocumentTheme(ctx.theme); if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables); };
app.onhostcontextchanged = theme;
app.onteardown = async () => { disposed = true; clearTimeout(timer); return {}; };
window.addEventListener("pagehide", () => { disposed = true; clearTimeout(timer); });
void app.connect().then(() => { connected = true; theme(app.getHostContext()); schedule(); }).catch(e => message("error", `This client could not connect the setup card. Ask your agent to use the setup tools instead. ${e instanceof Error ? e.message : ""}`));
