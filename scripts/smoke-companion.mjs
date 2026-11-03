import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const app = resolve(
    process.argv[2] ?? "output/plotit-mcp-arm64/PlotIt MCP.app",
  ),
  resources = join(app, "Contents/Resources"),
  node = join(resources, "runtime/node");
const temp = await mkdtemp("/tmp/pi-package-"),
  socket = join(temp, "sock");
const env = {
  ...process.env,
  PLOTIT_RESOURCES: resources,
  PLOTIT_DATA_DIR: join(temp, "data"),
  PLOTIT_SOCKET_DIR: socket,
  PLOTIT_UI_SESSION: randomUUID(),
};
const ui = spawn(node, [join(resources, "runtime/ui-client.mjs")], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
});
const pending = new Map();
let stderr = "";
ui.stderr.on("data", (b) => (stderr += b));
createInterface({ input: ui.stdout }).on("line", (line) => {
  const r = JSON.parse(line),
    p = pending.get(r.id);
  if (!p) return;
  pending.delete(r.id);
  clearTimeout(p.timer);
  r.ok ? p.resolve(r.value) : p.reject(new Error(r.error));
});
function request(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID(),
      timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`Packaged UI request timed out: ${action}\n${stderr}`),
        );
      }, 25000);
    pending.set(id, { resolve, reject, timer });
    ui.stdin.write(JSON.stringify({ id, action, params }) + "\n");
  });
}
const client = new Client({
  name: "Packaged runtime smoke test",
  version: "1.0",
});
try {
  const status = await request("heartbeat");
  assert.equal(status.armed, false);
  assert.equal(status.runner, null);
  const config = status.config;
  await request("save_machine", { config });
  const test = await request("test_server");
  assert.equal(test.ok, true);
  await client.connect(
    new StdioClientTransport({
      command: node,
      args: [join(resources, "runtime/stdio.mjs")],
      env: Object.fromEntries(
        Object.entries(env).filter(([, v]) => v !== undefined),
      ),
    }),
  );
  assert.equal((await client.listTools()).tools.length, 8);
  async function call(name, args = {}) {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return r.structuredContent;
  }
  const artwork = await call("create_artwork", {
    source: {
      kind: "text",
      fontId: "hershey-futural",
      text: "Hello PlotIt",
      capHeightMm: 5,
    },
  });
  const prepared = await call("prepare_job", {
    artwork: [{ id: artwork.id, xMm: 10, yMm: 10 }],
  });
  async function wait(done) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const job = await call("get_job", { id: prepared.id });
      if (done(job)) return job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Packaged job timed out.");
  }
  const ready = await wait((j) => j.status !== "preparing");
  assert.equal(ready.status, "pending");
  const preview = await client.callTool({
    name: "get_job",
    arguments: { id: prepared.id, includePreview: true },
  });
  assert(preview.content.some((c) => c.type === "image"));
  await call("simulate_job", { id: prepared.id });
  const simulated = await wait(
    (j) => j.simulation && j.simulation.status !== "running",
  );
  assert.equal(simulated.simulation.status, "finished");
  const started = await client.callTool({
    name: "start_job",
    arguments: { id: prepared.id },
  });
  assert.equal(started.isError, true);
  console.info(
    `Packaged runtime passed: ${app}\n8 tools, text preparation, PNG preview, simulation, and disarmed Start verified. No USB was opened.`,
  );
} finally {
  await client.close().catch(() => undefined);
  await request("heartbeat").catch(() => undefined);
  await request("quit").catch(() => undefined);
  ui.stdin.end();
  ui.kill();
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("Test ended."));
  }
  pending.clear();
  const pid = Number(
    await readFile(join(socket, "service.lock"), "utf8").catch(() => 0),
  );
  if (pid > 1)
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  await rm(temp, { recursive: true, force: true });
}
