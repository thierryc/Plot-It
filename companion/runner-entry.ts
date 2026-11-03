import { locations } from "./common";
import { join } from "node:path";
import { startRunner } from "../server/runner";
import { PlotterCore } from "../src/plotter-core";
import { NodeSerialTransport } from "../server/serial";
import { atomicJson } from "../server/jobs";
import { spawn, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";
const { directory, socketDirectory } = locations();
const core = new PlotterCore(
  new NodeSerialTransport(process.env.PLOTIT_DEVICE || undefined),
  { positionBudgetMs: 30 },
);
const service = await startRunner({
  directory: join(directory, "jobs"),
  socketDirectory: join(socketDirectory, "runner"),
  connectionPolicy: "manual",
  core,
});
await atomicJson(join(socketDirectory, "runner-identity.json"), {
  pid: process.pid,
  epoch: service.snapshot().epoch,
});
let assertion: ChildProcess | undefined;
const progress = core.onProgress;
core.onProgress = (value) => {
  progress(value);
  const active = !["idle", "finished", "stopped", "cancelled"].includes(
    value.state,
  );
  if (process.platform === "darwin" && active && !assertion) {
    assertion = spawn(
      "/usr/bin/caffeinate",
      ["-i", "-w", String(process.pid)],
      { stdio: "ignore" },
    );
    assertion.on("error", () => {
      assertion = undefined;
    });
  }
  if (!active && assertion) {
    assertion.kill();
    assertion = undefined;
  }
};
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (!stopping) {
      stopping = true;
      void service.close().then(
        async () => {
          assertion?.kill();
          await unlink(join(socketDirectory, "runner-identity.json")).catch(
            () => undefined,
          );
          process.exit(0);
        },
        (e) => {
          console.error(e);
          process.exit(1);
        },
      );
    }
  });
