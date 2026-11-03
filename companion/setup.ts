export const SETUP_URI = "ui://plotit/plotter-setup-v1.html";
export const SETUP_MIME = "text/html;profile=mcp-app";
export const machineProfiles = [
  { id: "axidraw", name: "AxiDraw A4" }, { id: "axidraw-a3", name: "AxiDraw A3" },
  { id: "xylodraw", name: "XyloDraw" }, { id: "nextdraw-8511", name: "NextDraw 8511" },
  { id: "nextdraw-1117", name: "NextDraw 1117" }, { id: "nextdraw-2234", name: "NextDraw 2234" },
];
export type SetupAction = "save_machine" | "connect" | "disconnect" | "origin" | "pen";
export const setupActions: Record<string, SetupAction> = {
  configure_plotter: "save_machine", connect_plotter: "connect", disconnect_plotter: "disconnect",
  set_plotter_origin: "origin", test_pen: "pen",
};
