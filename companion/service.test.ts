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
import { PAPERS } from "../src/model";
import { PROGRESS_URI, PROGRESS_MIME } from "./progress";
import { SETUP_URI } from "./setup";
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
  it("reserves updates atomically and restores connection-based control on native recovery", async () => {
    const directory = await mkdtemp("/tmp/pi-update-svc-");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await atomicJson(join(directory, "machine.json"), defaultMachine);
    const runner = { snapshot: { connected: true, origin: "explicit", status: "idle" }, close() {}, request: vi.fn(async () => ({ ok: true, value: {} })) } as unknown as RunnerClient;
    const service = await startCompanion({ directory, socketDirectory: join(directory, "sock"), resources: resolve("."), runner, home: directory });
    cleanup.push(() => service.close());
    await service.handleUI("heartbeat", { session: "native" });
    runner.snapshot!.status = "paused";
    await expect(service.handleUI("prepare_update", { session: "native" })).rejects.toThrow("settled");
    runner.snapshot!.status = "idle";
    await service.handleUI("prepare_update", { session: "native" });
    expect(runner.request).toHaveBeenCalledWith(expect.objectContaining({ action: "prepare-update" }));
    await expect(service.handleMcp("configure_plotter", { settings: {} })).rejects.toThrow("update");
    const delayed = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
    await service.handleUI("heartbeat", { session: "native" });
    expect(runner.request).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cancel-update" }));
    await expect(service.handleMcp("prepare_job", {})).rejects.toThrow("update");
    delayed.mockRestore();
    await service.handleUI("heartbeat", { session: "recovered" });
    expect(runner.request).toHaveBeenCalledWith(expect.objectContaining({ action: "cancel-update" }));
    expect(await service.status()).toMatchObject({ armed: true, agentControlEnabled: true });
    let unblock!: () => void;
    const delay = new Promise<void>(resolve => { unblock = resolve; });
    runner.request = vi.fn(async () => { await delay; return { ok: true, value: {} }; });
    const preparing = service.handleUI("prepare_update", { session: "recovered" });
    const replacement = service.handleUI("heartbeat", { session: "new-window" });
    const obsoleteCancel = service.handleUI("cancel_update", { session: "recovered" });
    const obsoleteResult = expect(obsoleteCancel).rejects.toThrow("Reconnect");
    unblock(); await preparing; await replacement; await obsoleteResult;
    await service.handleUI("heartbeat", { session: "recovered" });
    runner.request = vi.fn(async () => { throw new Error("IPC timeout"); });
    await expect(service.handleUI("prepare_update", { session: "recovered" })).rejects.toThrow("IPC timeout");
    await expect(service.handleMcp("configure_plotter", { settings: {} })).rejects.toThrow("update");
    runner.request = vi.fn(async () => ({ ok: true, value: {} }));
    await service.handleUI("cancel_update", { session: "recovered" });
    await service.handleMcp("configure_plotter", { settings: {} });
    runner.snapshot = null;
    await atomicJson(join(directory, "sock/runner-identity.json"), { pid: process.pid });
    await expect(service.handleUI("prepare_update", { session: "recovered" })).rejects.toThrow("Reconnect");
    await expect(service.handleUI("quit", { session: "recovered" })).rejects.toThrow("update");
    await rm(join(directory, "sock/runner-identity.json"));
    await service.handleUI("cancel_update", { session: "recovered" });
  });

  it("grants control from connection readiness and ignores obsolete Off preferences", async () => {
    const directory = await mkdtemp("/tmp/pi-lease-");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await atomicJson(join(directory, "machine.json"), defaultMachine);
    await atomicJson(join(directory, "control-preferences.json"), { agentControlEnabled: false });
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
      request: vi.fn(async () => ({ ok: true, value: {} })),
    } as unknown as RunnerClient;
    const options = {
      directory,
      socketDirectory: join(directory, "sock"),
      resources: resolve("."),
      assetRoot: resolve("."),
      runner,
      home: directory,
    };
    let service = await startCompanion(options);
    cleanup.push(() => service.close());
    expect((await service.status()).armed).toBe(false);
    await service.handleUI("heartbeat", { session: "native" });
    expect((await service.status()).armed).toBe(true);
    expect((await service.status()).paperPresets).toEqual(PAPERS);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
    try {
      expect((await service.status()).armed).toBe(false);
      await service.handleUI("heartbeat", { session: "native" });
      expect((await service.status()).armed).toBe(true);
    } finally {
      clock.mockRestore();
    }
    await expect(startCompanion(options)).rejects.toThrow("already running");
    snapshot.origin = "unset";
    expect((await service.status()).armed).toBe(false);
    snapshot.origin = "explicit";
    expect((await service.status()).armed).toBe(true);
    expect(runner.request).not.toHaveBeenCalled();
    await service.handleUI("origin", { session: "native" });
    expect((await service.status()).armed).toBe(false);
    runner.snapshot = { ...snapshot } as unknown as typeof runner.snapshot;
    expect((await service.status()).armed).toBe(true);
    await service.handleUI("suspend_control", { session: "native" });
    expect((await service.status()).armed).toBe(false);
    await service.handleUI("heartbeat", { session: "replacement" });
    expect((await service.status()).armed).toBe(true);
    runner.snapshot!.connected = false;
    expect((await service.status()).armed).toBe(false);
    runner.snapshot!.connected = true;
    await service.handleUI("heartbeat", { session: "third" });
    expect((await service.status()).armed).toBe(true);
    expect(runner.request).toHaveBeenCalledTimes(1);
    await service.close();
    service = await startCompanion(options);
    await service.handleUI("heartbeat", { session: "restarted" });
    expect(await service.status()).toMatchObject({ armed: true, agentControlEnabled: true });
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
  it("blocks agent setup during a drawing and requires fresh state after settings change", async () => {
    const directory = await mkdtemp("/tmp/pi-setup-");
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await atomicJson(join(directory, "machine.json"), defaultMachine);
    const runner = { snapshot: { connected: true, origin: "explicit", status: "running" }, close() {}, request: vi.fn(async () => ({ ok: true, value: {} })) } as unknown as RunnerClient;
    const service = await startCompanion({ directory, socketDirectory: join(directory, "sock"), resources: resolve("."), runner, home: directory, listDevices: async () => [] });
    cleanup.push(() => service.close());
    await service.handleUI("heartbeat", { session: "native" });
    for (const [name, args] of [["configure_plotter", { settings: { widthMm: 220 } }], ["connect_plotter", {}], ["disconnect_plotter", {}], ["test_pen", { down: true }], ["set_plotter_origin", { currentPositionConfirmed: true }]] as const) await expect(service.handleMcp(name, args)).rejects.toThrow("settled");
    expect(runner.request).not.toHaveBeenCalled();
    runner.snapshot!.status = "idle";
    await service.handleMcp("configure_plotter", { settings: { widthMm: 220 } });
    expect(await service.status()).toMatchObject({ armed: false, agentControlEnabled: true });
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
    await expect(service.handleMcp("configure_plotter", { settings: { widthMm: 200 } })).rejects.toThrow("Open PlotIt MCP");
    await ui("heartbeat");
    await ui("save_machine", { config: defaultMachine });
    const setup = await service.handleMcp("get_setup", {});
    expect(setup.nativeSessionActive).toBe(true);
    expect(setup.machineProfiles).toHaveLength(6);
    await service.handleMcp("configure_plotter", { settings: { widthMm: 215.9, heightMm: 279.4 }, expectedConfigDigest: setup.configDigest });
    expect((await service.status()).config).toMatchObject({ widthMm: 215.9, heightMm: 279.4, profile: "axidraw" });
    await expect(service.handleMcp("configure_plotter", { settings: { penUp: 40 }, expectedConfigDigest: setup.configDigest })).rejects.toThrow("changed elsewhere");
    await expect(service.handleMcp("configure_plotter", { settings: { widthMm: 0 } })).rejects.toThrow("paper width");
    await expect(service.handleMcp("arm", { enabled: true })).rejects.toThrow(
      "Unsupported",
    );
    expect((await service.status()).armed).toBe(false);
    await service.handleMcp("connect_plotter", {});
    await waitFor(
      () => service.status(),
      (s) => s.runner?.connected === true,
    );
    await expect(service.handleMcp("set_plotter_origin", {})).rejects.toThrow("Confirm");
    await service.handleMcp("test_pen", { down: false });
    await service.handleMcp("set_plotter_origin", { currentPositionConfirmed: true });
    await waitFor(
      () => service.status(),
      (s) => s.runner?.origin === "explicit",
    );
    await waitFor(() => service.status(), (s) => s.armed);
    const clients: Client[] = [];
    for (const name of ["codex-test", "claude-code-test"]) {
      const client = new Client({ name, version: "1.0" }, name === "claude-code-test" ? { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [PROGRESS_MIME] } } } } : {});
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
      const advertised = (await client.listTools()).tools;
      expect(advertised).toHaveLength(16);
      expect(advertised.find(t => t.name === "show_plot_progress")?._meta?.ui).toEqual(name === "claude-code-test" ? { resourceUri: PROGRESS_URI } : undefined);
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
    const expired = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
    try {
      await expect(call(clients[0]!, "start_job", { id: prepared.id })).rejects.toThrow("Open PlotIt MCP");
    } finally { expired.mockRestore(); }
    await ui("heartbeat");
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
      name: "show_plot_progress",
      arguments: { id: prepared.id },
    });
    expect((preview.content as any[]).some((c) => c.type === "image")).toBe(
      true,
    );
    expect((preview.structuredContent as any).monitor).toMatchObject({ terminal: true, fraction: 1, title: "Drawing complete" });
    const resource = await clients[1]!.readResource({ uri: PROGRESS_URI });
    expect(resource.contents[0]?.mimeType).toBe(PROGRESS_MIME);
    expect((resource.contents[0] as { text: string }).text).toContain("Estimated drawing progress");
    const setupResource = await clients[1]!.readResource({ uri: SETUP_URI });
    expect((setupResource.contents[0] as { text: string }).text).toContain("Set up your plotter");
    expect(fake.commands.some((c) => c.startsWith("SM,"))).toBe(true);
  }, 30000);
});
