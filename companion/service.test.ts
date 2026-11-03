import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startCompanion } from "./service";
import { startRunner } from "../server/runner";
import { RunnerClient } from "../server/ipc";
import { PlotterCore } from "../src/plotter-core";
import { fakeTransport } from "../server/test-fixtures/fake-ebb";
import { defaultMachine } from "./common";
import { atomicJson } from "../server/jobs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 30));
  }
}
describe("local companion integration", () => {
  it("revokes a stale session before accepting its next heartbeat and rejects duplicate services", async () => {
    const directory = await mkdtemp("/tmp/pi-lease-");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await atomicJson(join(directory, "machine.json"), defaultMachine);
    const snapshot = {
      epoch: "test-epoch",
      connected: true,
      origin: "explicit",
      status: "idle",
      firmware: "2.8.1",
    };
    const runner = {
      snapshot,
      close() {},
      request: async () => ({ ok: true, value: {} }),
    } as unknown as RunnerClient;
    const options = {
      directory,
      socketDirectory: join(directory, "sock"),
      resources: resolve("."),
      assetRoot: resolve("."),
      runner,
      home: directory,
    };
    const service = await startCompanion(options);
    cleanup.push(() => service.close());
    await service.handleUI("heartbeat", { session: "native" });
    await service.handleUI("arm", { session: "native", enabled: true });
    expect((await service.status()).armed).toBe(true);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
    try {
      expect((await service.status()).armed).toBe(false);
      await service.handleUI("heartbeat", { session: "native" });
      expect((await service.status()).armed).toBe(false);
    } finally {
      clock.mockRestore();
    }
    await expect(startCompanion(options)).rejects.toThrow("already running");
  });
  it("recovers unfinished preparation and simulation without replay", async () => {
    const directory = await mkdtemp("/tmp/pi-recover-");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const jobs = join(directory, "jobs");
    await (await import("node:fs/promises")).mkdir(jobs);
    await atomicJson(join(jobs, "old.meta.json"), {
      id: "old",
      status: "preparing",
      configDigest: "old",
      createdAt: "2026-01-01",
      simulation: { status: "running" },
    });
    const runner = { snapshot: null, close() {} } as unknown as RunnerClient;
    const service = await startCompanion({
      directory,
      socketDirectory: join(directory, "sock"),
      resources: resolve("."),
      runner,
    });
    cleanup.push(() => service.close());
    const recovered = JSON.parse(
      await readFile(join(jobs, "old.meta.json"), "utf8"),
    );
    expect(recovered.status).toBe("failed");
    expect(recovered.simulation.status).toBe("interrupted");
    expect(recovered.error).toContain("restarted");
  });
  it("serves real MCP clients, enforces local arming and origin, shares a runner and deduplicates starts", async () => {
    const directory = await mkdtemp("/tmp/pi-service-");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const sockets = join(directory, "sock"),
      fake = fakeTransport("2.8.1");
    const hardware = await startRunner({
      directory: join(directory, "jobs"),
      socketDirectory: join(sockets, "runner"),
      core: new PlotterCore(fake.transport),
    });
    cleanup.push(() => hardware.close());
    const runner = new RunnerClient(
      join(sockets, "runner/control.sock"),
      join(sockets, "runner/telemetry.sock"),
    );
    await runner.ready();
    const service = await startCompanion({
      directory,
      socketDirectory: sockets,
      resources: resolve("."),
      assetRoot: resolve("."),
      workerPath: resolve("dist-companion/worker.mjs"),
      runner,
      home: directory,
    });
    cleanup.push(() => service.close());
    const ui = (action: string, params: Record<string, unknown> = {}) =>
      service.handleUI(action, { ...params, session: "native-session" });
    await ui("heartbeat");
    await ui("save_machine", { config: defaultMachine });
    await expect(service.handleMcp("arm", { enabled: true })).rejects.toThrow(
      "Unsupported",
    );
    await expect(ui("arm", { enabled: true })).rejects.toThrow("origin");
    await ui("connect");
    await waitFor(
      () => service.status(),
      (s) => s.runner?.connected === true,
    );
    await ui("origin");
    await waitFor(
      () => service.status(),
      (s) => s.runner?.origin === "explicit",
    );
    const clients: Client[] = [];
    for (const name of ["codex-test", "claude-code-test"]) {
      const client = new Client({ name, version: "1.0" });
      clients.push(client);
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [resolve("dist-companion/stdio.mjs")],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (v): v is [string, string] => v[1] !== undefined,
              ),
            ),
            PLOTIT_SOCKET_DIR: sockets,
          },
        }),
      );
      cleanup.push(() => client.close());
      expect((await client.listTools()).tools).toHaveLength(8);
    }
    const call = async (
      client: Client,
      name: string,
      args: Record<string, unknown> = {},
    ) => {
      const r = await client.callTool({ name, arguments: args });
      if (r.isError) throw new Error((r.content as any[])[0].text);
      return r.structuredContent as any;
    };
    const artifact = await call(clients[0]!, "create_artwork", {
      source: {
        kind: "paths",
        paths: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 12, y: 10 },
            ],
          },
        ],
      },
    });
    const prepared = await call(clients[0]!, "prepare_job", {
      artwork: [{ id: artifact.id }],
    });
    await waitFor(
      () => call(clients[0]!, "get_job", { id: prepared.id }),
      (j) => j.status !== "preparing",
    );
    await expect(
      call(clients[0]!, "start_job", { id: prepared.id }),
    ).rejects.toThrow("Enable agent control");
    await ui("heartbeat");
    await ui("arm", { enabled: true });
    await call(clients[0]!, "start_job", { id: prepared.id });
    const duplicate = await call(clients[1]!, "start_job", { id: prepared.id });
    expect(duplicate.duplicate).toBe(true);
    await clients[0]!.close();
    const finished = await waitFor(
      () => call(clients[1]!, "get_job", { id: prepared.id }),
      (j) => ["finished", "failed", "interrupted"].includes(j.status),
    );
    expect(finished.status).toBe("finished");
    await service.handleUI("heartbeat", { session: "replacement-session" });
    expect((await service.status()).armed).toBe(false);
    const preview = await clients[1]!.callTool({
      name: "get_job",
      arguments: { id: prepared.id, includePreview: true },
    });
    expect((preview.content as any[]).some((c) => c.type === "image")).toBe(
      true,
    );
    expect(fake.commands.some((c) => c.startsWith("SM,"))).toBe(true);
  }, 30000);
});
