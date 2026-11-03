import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { locations, privateDirectory } from "./common";
import { rpc } from "./rpc";
const paths = locations();
await privateDirectory(paths.directory);
await privateDirectory(paths.socketDirectory);
const socket = join(paths.socketDirectory, "ui.sock");
try {
  await rpc(
    socket,
    "heartbeat",
    { session: process.env.PLOTIT_UI_SESSION },
    500,
  );
} catch {
  const log = await open(join(paths.directory, "service.log"), "a", 0o600);
  const service = spawn(
    process.execPath,
    [join(dirname(fileURLToPath(import.meta.url)), "service.mjs")],
    { detached: true, stdio: ["ignore", log.fd, log.fd], env: process.env },
  );
  service.on("error", (e) => console.error(e));
  service.unref();
  await log.close();
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      await rpc(
        socket,
        "heartbeat",
        { session: process.env.PLOTIT_UI_SESSION },
        500,
      );
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready)
    throw new Error(
      "PlotIt service could not start. See service.log in Application Support/PlotIt MCP.",
    );
}
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  void (async () => {
    let id: unknown = null;
    try {
      if (line.length > 1024 * 1024)
        throw new Error("UI request exceeds limit.");
      const request = JSON.parse(line);
      id = request.id;
      const result = await rpc(
        socket,
        request.action,
        { ...request.params, session: process.env.PLOTIT_UI_SESSION },
        30000,
      );
      process.stdout.write(
        JSON.stringify({ id, ok: true, value: result }) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        }) + "\n",
      );
    }
  })();
});
