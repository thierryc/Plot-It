// A simulated MCP Apps host. Never starts the companion or opens USB.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Resvg } from "@resvg/resvg-js";

const paths = Array.from({ length: 26 }, (_, i) => {
  const points = Array.from({ length: 141 }, (_, x) => {
    const px = 16 + x * 2.2;
    const y = 25 + i * 5 + Math.sin(x / 17 + i / 8) * 19 + Math.sin(x / 31 - i / 10) * 12;
    return `${x === 0 ? "M" : "L"}${px.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `<path d="${points}"/>`;
}).join("");
const preview = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 210"><rect width="340" height="210" fill="white"/><g fill="none" stroke="#21695c" stroke-width=".65">${paths}</g></svg>`).render().asPng().toString("base64");
const source = `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { plotProgress } from "./companion/progress";
import { machineProfiles } from "./companion/setup";
import { PAPERS } from "./src/model";
const iframe = document.querySelector("iframe");
let bridge, mode = "progress", status = "running", completed = 38, requests = 0;
const config = {profile:"axidraw",rotation:90,servo:"standard",penUp:50,penDown:60,speed:35,travelSpeed:60,widthMm:210,heightMm:297,firmware:"2.8.1",device:""};
let revision = 1;
const setup = {config,configDigest:"preview-1",configured:true,armed:false,nativeSessionActive:true,agentControlEnabled:true,controlBlocker:"Connect your plotter.",machineProfiles,paperPresets:PAPERS,devices:[{path:"/dev/cu.usbmodem-preview",manufacturer:"EBB simulated",vendorId:"04d8",productId:"fd92"}],runner:null};
const progressResult = () => ({content:[{type:"image", mimeType:"image/png", data:${JSON.stringify(preview)}}], structuredContent:{id:"a".repeat(64), status, monitor:plotProgress({status, durationMs:180000, elapsedMs:69000, telemetryAvailable:true, progress:{completed,total:100,tool:"Blue pen"}})}});
const result = () => mode === "setup" ? {content:[],structuredContent:setup} : progressResult();
async function mount() {
  if (bridge) await bridge.close();
  bridge = new AppBridge(null, {name:"PlotIt preview host", version:"1.0.0"}, {serverTools:{}}, {hostContext:{theme:document.querySelector("#theme").checked?"dark":"light", displayMode:"inline"}});
  bridge.oncalltool = async request => {
    document.querySelector("#requests").textContent = String(++requests);
    if (request.name === "control_job") { status = {pause:"paused", resume:"running", stop:"stopping"}[request.arguments.action]; return {content:[]}; }
    if (request.name === "configure_plotter") { if(request.arguments.expectedConfigDigest !== setup.configDigest) return {isError:true,content:[{type:"text",text:"Settings changed elsewhere. Refresh."}]}; Object.assign(config,request.arguments.settings); setup.configDigest="preview-"+(++revision); setup.runner=null; setup.armed=false; setup.controlBlocker="Connect your plotter."; }
    else if (request.name === "connect_plotter") { setup.runner={connected:true,status:"idle",origin:"unset",firmware:"2.8.1"}; setup.controlBlocker="Set the drawing origin."; }
    else if (request.name === "disconnect_plotter") { setup.runner=null; setup.armed=false; setup.controlBlocker="Connect your plotter."; }
    else if (request.name === "set_plotter_origin") { setup.runner.origin="explicit"; setup.armed=true; setup.controlBlocker=null; }
    else if (!["get_job","get_setup","test_pen"].includes(request.name)) throw new Error("Only simulated setup, progress and controls are available.");
    return result();
  };
  bridge.oninitialized = async () => { await bridge.sendToolInput({arguments:mode==="setup"?{}:{id:"a".repeat(64)}}); await bridge.sendToolResult(result()); };
  bridge.onsizechange = size => { iframe.style.height = size.height + "px"; };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
  iframe.src = mode === "setup" ? "/setup.html" : "/app.html";
}
await mount();
document.querySelector("#card").onchange = async event => { mode=event.target.value; document.querySelector("#progress-controls").hidden=mode!=="progress"; await mount(); };
document.querySelector("#state").onchange = async event => { status=event.target.value; await bridge.sendToolResult(result()); };
document.querySelector("#amount").oninput = async event => { completed=Number(event.target.value); await bridge.sendToolResult(result()); };
document.querySelector("#theme").onchange = event => { const theme=event.target.checked?"dark":"light"; bridge.setHostContext({theme}); document.documentElement.style.colorScheme=theme; };
document.querySelector("#narrow").onchange = event => { document.querySelector("main").style.maxWidth=event.target.checked?"320px":"520px"; };
`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "plot-progress-preview.ts" }, bundle: true, platform: "browser", format: "esm", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PlotIt progress card preview</title><style>html{color-scheme:light}body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:light-dark(#f5f6f5,#151a18);color:light-dark(#23312b,#dce9df);margin:0;padding:30px 20px}main{max-width:520px;margin:auto}h1{font-size:19px}aside{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:18px 0;font-size:12px}[hidden]{display:none!important}select{font:inherit}iframe{width:100%;height:520px;border:0;display:block}p{color:light-dark(#62756a,#a8baad);font-size:12px;line-height:1.5}</style><main><h1>Your plotter, in the conversation</h1><p>Simulated MCP Apps host · no hardware connection</p><aside><label>Card <select id="card"><option value="progress">Drawing progress</option><option value="setup">Plotter setup</option></select></label><span id="progress-controls"><label>State <select id="state"><option value="running">Drawing</option><option value="paused">Paused</option><option value="tool-change">Pen change</option><option value="returning">Returning</option><option value="finished">Complete</option><option value="failed">Failed</option></select></label><label>Progress <input id="amount" aria-label="Simulated progress" type="range" min="0" max="100" value="38"></label></span><label><input id="theme" type="checkbox">Dark</label><label><input id="narrow" type="checkbox">Narrow</label></aside><iframe title="Live drawing card" sandbox="allow-scripts allow-same-origin"></iframe><p>Quiet data refreshes: <span id="requests">0</span>. The card stays in place as it updates.</p></main><script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></html>`;
const app = await readFile("dist-companion/assets/plot-progress.html", "utf8");
const setupApp = await readFile("dist-companion/assets/plotter-setup.html", "utf8");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(req.url === "/app.html" ? app : req.url === "/setup.html" ? setupApp : html);
});
const port = Number(process.env.PLOTIT_PREVIEW_PORT ?? 4137);
server.listen(port, "127.0.0.1", () => console.log(`Progress-card preview: http://127.0.0.1:${port}`));
