import {
  mkdir,
  readFile,
  writeFile,
  open,
  unlink,
  stat,
  truncate,
} from "node:fs/promises";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { Worker } from "node:worker_threads";
import { SerialPort } from "serialport";
import { RunnerClient } from "../server/ipc";
import { JobStore, atomicJson } from "../server/jobs";
import type { Server } from "node:http";
import {
  locations,
  privateDirectory,
  VERSION,
  defaultMachine,
  machine,
  settings,
  fingerprint,
  identity,
  text,
  object,
} from "./common";
import { listenRpc } from "./rpc";
import { AgentSetup, type Agent } from "./agents";
import type { JobInfo } from "./artwork";
import { claimService } from "./ownership";
import { PAPERS } from "../src/model";
import { plotProgress } from "./progress";
import { machineProfiles, setupActions, type SetupAction } from "./setup";

export interface CompanionOptions {
  directory: string;
  socketDirectory: string;
  resources: string;
  assetRoot?: string;
  launcher?: string;
  workerPath?: string;
  runnerPath?: string;
  runner?: RunnerClient;
  listDevices?: () => Promise<unknown[]>;
  home?: string;
}
export async function startCompanion(options: CompanionOptions) {
  const { directory, socketDirectory, resources } = options;
  await privateDirectory(directory);
  await privateDirectory(socketDirectory);
  await mkdir(join(directory, "jobs"), { recursive: true, mode: 0o700 });
  let config = { ...defaultMachine },
    configured = false;
  try {
    config = machine(
      JSON.parse(await readFile(join(directory, "machine.json"), "utf8")),
    );
    configured = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const releaseLock = await claimService(socketDirectory);
  let uiSession = "",
    lastHeartbeat = 0,
    controlSuspended = false,
    lastJob: JobInfo | undefined,
    closing = false;
  const connectedAgents = new Map<string, { name: string; at: number }>();
  const tasks = new Map<string, Worker>();
  let runnerChild: ChildProcess | undefined;
  let reservations = 0;
  const runner =
    options.runner ??
    new RunnerClient(
      join(socketDirectory, "runner/control.sock"),
      join(socketDirectory, "runner/telemetry.sock"),
    );
  const setup = new AgentSetup(
    options.launcher ?? join(resources, "../MacOS/plotit-mcp"),
    options.home,
  );
  try {
    const saved = JSON.parse(
      await readFile(join(directory, "agent-preferences.json"), "utf8"),
    );
    Object.assign(setup.overrides, saved.executables ?? {});
    setup.codexHome = saved.codexHome;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Agent preferences:", e);
  }
  const saveAgentPreferences = () =>
    atomicJson(join(directory, "agent-preferences.json"), {
      executables: setup.overrides,
      codexHome: setup.codexHome,
    });
  const assetRoot = options.assetRoot ?? join(resources, "assets");
  let updateReserved = false;
  let updateConfirmed = false;
  async function cancelUpdate() {
    if (!updateReserved) return;
    if (runner.snapshot) await command("cancel-update");
    else if (await stat(join(socketDirectory, "runner-identity.json")).catch(() => null)) throw new Error("Reconnect the plotter service to cancel the update reservation.");
    updateReserved = false;
    updateConfirmed = false;
  }
  let changingHardware = false;
  let readinessBarrier: typeof runner.snapshot = null;
  const controlBlocker = () => {
    if (updateReserved) return "PlotIt is preparing to install an update.";
    if (closing || controlSuspended) return "Agent control is suspended while quitting.";
    if (!uiSession || Date.now() - lastHeartbeat >= 5000) return "Open PlotIt MCP to allow agent control.";
    if (!configured) return "Save your machine settings.";
    if (changingHardware || (readinessBarrier && readinessBarrier === runner.snapshot)) return "Waiting for the plotter’s current state.";
    if (!runner.snapshot?.connected) return "Connect your plotter.";
    if (!["automatic", "explicit"].includes(runner.snapshot.origin)) return "Set the drawing origin.";
    return null;
  };
  const isArmed = () => controlBlocker() === null;
  const active = () =>
    !!runner.snapshot &&
    ![
      "idle",
      "pending",
      ...["finished", "stopped", "failed", "interrupted"],
    ].includes(runner.snapshot.status);
  const idle = () => {
    if (updateReserved) throw new Error("PlotIt is preparing to install an update.");
    if (active())
      throw new Error("Wait until the current drawing has settled.");
  };
  let controls = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = controls.then(fn);
    controls = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function ensureRunner() {
    if (options.runner) {
      await runner.ready();
      return;
    }
    try {
      await runner.ready(300);
      return;
    } catch {
      /* launch only on explicit UI setup */
    }
    if (runnerChild && runnerChild.exitCode === null)
      throw new Error("Plotter runner is starting. Try again shortly.");
    const log = await open(join(directory, "runner.log"), "a", 0o600);
    runnerChild = spawn(
      process.execPath,
      [
        options.runnerPath ??
          join(dirname(fileURLToPath(import.meta.url)), "runner-entry.mjs"),
      ],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: {
          ...process.env,
          PLOTIT_DATA_DIR: directory,
          PLOTIT_SOCKET_DIR: socketDirectory,
          PLOTIT_DEVICE: config.device,
        },
      },
    );
    runnerChild.unref();
    await log.close();
    runnerChild.on("error", (e) => console.error("Runner:", e.message));
    await runner.ready(10000);
  }
  async function stopRunner() {
    if (options.runner) return;
    const saved = JSON.parse(
      await readFile(
        join(socketDirectory, "runner-identity.json"),
        "utf8",
      ).catch(() => "null"),
    );
    if (!saved) return;
    if (
      saved.epoch !== runner.snapshot?.epoch ||
      !Number.isSafeInteger(saved.pid) ||
      saved.pid <= 1
    )
      throw new Error(
        "Cannot identify the existing runner safely. Close the other PlotIt installation first.",
      );
    process.kill(saved.pid, "SIGTERM");
    const deadline = Date.now() + 10000;
    while (runner.snapshot && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    if (runner.snapshot)
      throw new Error(
        "The plotter runner has not shut down. Wait before changing devices.",
      );
    runnerChild = undefined;
  }
  async function command(action: any, fields: Record<string, unknown> = {}) {
    const changesReadiness = ["disconnect-ebb", "connect-ebb", "set-origin"].includes(action);
    if (changesReadiness) changingHardware = true;
    try {
      const r = await runner.request({ version: 1, requestId: randomUUID(), action, ...fields });
      if (!r.ok) throw new Error(r.error ?? "Plotter command failed.");
      return r.value ?? {};
    } finally {
      // Control replies and telemetry use separate sockets. Wait for a fresh
      // snapshot after the reply before automatically granting control again.
      if (changesReadiness) { readinessBarrier = runner.snapshot; changingHardware = false; }
    }
  }
  async function job(id: string): Promise<JobInfo> {
    const info = JSON.parse(
      await readFile(
        join(directory, "jobs", `${identity(id)}.meta.json`),
        "utf8",
      ),
    ) as JobInfo;
    if (!["preparing", "failed"].includes(info.status)) {
      const stored = await new JobStore(join(directory, "jobs")).get(id);
      info.status =
        runner.snapshot?.jobId === id ? runner.snapshot.status : stored.status;
      if (stored.error) info.error = stored.error;
    }
    return info;
  }
  async function status() {
    const connected = [...connectedAgents.entries()]
      .filter(([, a]) => Date.now() - a.at < 15000)
      .map(([id, a]) => ({ id, name: a.name }));
    if (lastJob) lastJob = await job(lastJob.id).catch(() => lastJob);
    return {
      version: VERSION,
      configured,
      config,
      configDigest: fingerprint(config),
      paperPresets: PAPERS,
      agentControlEnabled: true, // Wire compatibility for older clients; connection now controls availability.
      controlBlocker: controlBlocker(),
      armed: isArmed(),
      runner: runner.snapshot ?? null,
      agents: connected,
      lastJob: lastJob ?? null,
      preparing: tasks.size > 0,
      hardwareExperimental: true,
    };
  }
  async function devices() {
    const list = await (options.listDevices ? options.listDevices() : SerialPort.list());
    return list.flatMap(item => {
      if (!item || typeof item !== "object" || !("path" in item) || typeof item.path !== "string") return [];
      const value = item as Record<string, unknown>;
      return [{ path: item.path, ...Object.fromEntries(["manufacturer", "vendorId", "productId"].filter(key => typeof value[key] === "string").map(key => [key, value[key]])) }];
    });
  }
  async function setupStatus() {
    return { ...await status(), machineProfiles, devices: await devices(), nativeSessionActive: !!uiSession && Date.now() - lastHeartbeat < 5000 && !closing && !controlSuspended };
  }
  const requireNativeSession = () => {
    if (!uiSession || Date.now() - lastHeartbeat >= 5000 || closing || controlSuspended) throw new Error("Open PlotIt MCP on this Mac before changing plotter setup.");
  };
  async function performSetup(action: SetupAction, p: Record<string, unknown>) {
    requireNativeSession();
    return exclusive(async () => {
      requireNativeSession();
      idle();
      if (action === "save_machine") {
        if (p.expectedConfigDigest !== undefined && p.expectedConfigDigest !== fingerprint(config)) throw new Error("Machine settings changed elsewhere. Refresh and review them before saving.");
        const patch = object(p.settings ?? p.config);
        if (Object.keys(patch).some(key => !Object.hasOwn(defaultMachine, key))) throw new Error("Unknown machine setting.");
        const next = machine(p.settings ? { ...config, ...patch } : patch);
        if (configured && fingerprint(next) === fingerprint(config)) return status();
        if (runner.snapshot?.connected) await command("disconnect-ebb", { settings: settings(config) });
        if (next.device !== config.device) await stopRunner();
        await atomicJson(join(directory, "machine.json"), next);
        config = next;
        configured = true;
      } else if (action === "connect") {
        if (!configured) throw new Error("Save machine settings first.");
        if (!runner.snapshot?.connected) { await ensureRunner(); await command("connect-ebb"); }
      } else if (action === "disconnect") {
        if (runner.snapshot?.connected) await command("disconnect-ebb", { settings: settings(config) });
      } else {
        if (!configured || !runner.snapshot?.connected) throw new Error("Save settings and connect the plotter first.");
        if (action === "origin") await command("set-origin", { profile: settings(config).profile, settings: settings(config) });
        else {
          if (typeof p.down !== "boolean") throw new Error("Choose pen up or pen down.");
          await command("pen", { percent: p.down ? config.penDown : config.penUp, settings: settings(config) });
        }
      }
      return status();
    });
  }
  function worker(
    action: string,
    input: unknown,
    extra: Record<string, unknown> = {},
    reserved = false,
  ): Promise<any> {
    if (updateReserved) throw new Error("PlotIt is preparing to install an update.");
    if (!reserved && tasks.size + reservations >= 2)
      throw new Error(
        "Artwork preparation is busy. Wait for the existing task.",
      );
    const key = randomUUID(),
      w = new Worker(
        options.workerPath ??
          join(dirname(fileURLToPath(import.meta.url)), "worker.mjs"),
        {
          workerData: {
            action,
            input,
            directory,
            resources: assetRoot,
            config,
            ...extra,
          },
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        },
      );
    tasks.set(key, w);
    return new Promise((resolve, reject) => {
      let received = false;
      const timer = setTimeout(() => {
        void w.terminate();
        reject(new Error("Artwork task exceeded its two-minute limit."));
      }, 120000);
      w.once("message", (r) => {
        received = true;
        r.ok ? resolve(r.value) : reject(new Error(r.error));
      });
      w.once("error", reject);
      w.once("exit", (code) => {
        clearTimeout(timer);
        tasks.delete(key);
        if (!received) reject(new Error(`Artwork task exited (${code}).`));
      });
    });
  }
  async function handleMcp(
    action: string,
    p: Record<string, unknown>,
  ): Promise<any> {
    if (closing) throw new Error("PlotIt is shutting down.");
    if (action === "agent_ping") {
      if (p.name !== "PlotIt connection test")
        connectedAgents.set(identity(p.id), {
          name: text(p.name, "client", 100),
          at: Date.now(),
        });
      return {};
    }
    if (action === "agent_disconnect") {
      connectedAgents.delete(identity(p.id));
      return {};
    }
    if (action === "get_status") return status();
    if (action === "get_setup" || action === "show_plotter_setup") return setupStatus();
    if (setupActions[action]) {
      if (action === "set_plotter_origin" && p.currentPositionConfirmed !== true) throw new Error("Confirm that the carriage is at the intended drawing origin first.");
      await performSetup(setupActions[action]!, p);
      return setupStatus();
    }
    if (action === "list_fonts") {
      const list = JSON.parse(
        await readFile(join(assetRoot, "src/fonts/catalog.json"), "utf8"),
      ) as any[];
      return {
        fonts: list
          .filter((f) => f.kind === "openplotfont")
          .map(({ id, name, license, coverageHint }) => ({
            id,
            name,
            license,
            coverageHint,
          })),
        layout: {
          units: "mm",
          features: [
            "multiline",
            "alignment",
            "spacing",
            "kerning",
            "ligatures",
            "contextual",
            "OpenType features",
          ],
        },
      };
    }
    if (["create_artwork", "prepare_job", "simulate_job"].includes(action) && updateReserved) throw new Error("PlotIt is preparing to install an update.");
    if (action === "create_artwork") return worker("create", p);
    if (action === "prepare_job") {
      if (!configured)
        throw new Error(
          "Save your machine and paper settings in PlotIt MCP before preparing a job.",
        );
      const requestId = randomUUID(),
        id = createHash("sha256").update(requestId).digest("hex");
      const target = {
        ...config,
        firmware: runner.snapshot?.firmware ?? config.firmware,
      };
      const info: JobInfo = {
        id,
        status: "preparing",
        configDigest: fingerprint(target),
        createdAt: new Date().toISOString(),
      };
      // Reserve capacity before returning an accepted task identity.
      if (tasks.size + reservations >= 2)
        throw new Error("Artwork preparation is busy.");
      reservations++;
      try {
        await atomicJson(join(directory, "jobs", `${id}.meta.json`), info);
        lastJob = info;
        void worker("prepare", p, { id, requestId, config: target }, true)
          .then(
            (v) => {
              if (lastJob?.id === id) lastJob = v;
            },
            async (e) => {
              info.status = "failed";
              info.error = e.message;
              await atomicJson(
                join(directory, "jobs", `${id}.meta.json`),
                info,
              );
              if (lastJob?.id === id) lastJob = info;
            },
          )
          .catch(console.error);
      } finally {
        reservations--;
      }
      return { id, status: "preparing" };
    }
    if (action === "get_job" || action === "show_plot_progress") {
      const info = await job(identity(p.id));
      const live = runner.snapshot?.jobId === info.id && runner.snapshot.connected ? runner.snapshot : null;
      return {
        ...info,
        ...(live
          ? { progress: live.progress, elapsedMs: live.elapsedMs }
          : {}),
        monitor: plotProgress({ ...info, telemetryAvailable: !!live, progress: live?.progress, elapsedMs: live?.elapsedMs }),
        previewUri: info.previewPath
          ? `plotit://jobs/${info.id}/preview`
          : undefined,
        svgUri: info.svgPath ? `plotit://jobs/${info.id}/svg` : undefined,
      };
    }
    if (action === "read_resource") {
      const match = /^plotit:\/\/jobs\/([a-f0-9]{64})\/(preview|svg)$/.exec(
        String(p.uri),
      );
      if (!match) throw new Error("Unknown PlotIt resource.");
      const info = await job(match[1]!);
      const path = match[2] === "preview" ? info.previewPath : info.svgPath;
      if (!path) throw new Error("Preview is not ready.");
      const bytes = await readFile(path);
      return {
        mimeType: match[2] === "preview" ? "image/png" : "image/svg+xml",
        data: bytes.toString("base64"),
      };
    }
    if (action === "simulate_job") {
      const info = await job(identity(p.id));
      if (info.status === "preparing" || info.status === "failed")
        throw new Error("Wait for a successfully prepared job.");
      if (info.simulation?.status === "running")
        return { id: info.id, simulation: info.simulation };
      const pending = worker("simulate", {}, { id: info.id });
      info.simulation = { status: "running", elapsedMs: 0, commands: 0 };
      await atomicJson(join(directory, "jobs", `${info.id}.meta.json`), info);
      void pending
        .then(
          async (result) => {
            const fresh = await job(info.id);
            fresh.simulation = result;
            await atomicJson(
              join(directory, "jobs", `${info.id}.meta.json`),
              fresh,
            );
          },
          async (e) => {
            const fresh = await job(info.id);
            fresh.simulation = { status: "failed", elapsedMs: 0, commands: 0 };
            fresh.error = e.message;
            await atomicJson(
              join(directory, "jobs", `${info.id}.meta.json`),
              fresh,
            );
          },
        )
        .catch(console.error);
      return { id: info.id, simulation: info.simulation };
    }
    if (action === "start_job")
      return exclusive(async () => {
        const info = await job(identity(p.id));
        const record = await new JobStore(join(directory, "jobs")).get(info.id);
        if (record.startRequestId)
          return { id: info.id, status: info.status, duplicate: true };
        if (!isArmed())
          throw new Error(
            controlBlocker() ?? "Connect the plotter before starting.",
          );
        if (!runner.snapshot?.connected)
          throw new Error("Connect the plotter in PlotIt MCP.");
        idle();
        if (runner.snapshot.origin === "unset")
          throw new Error("Establish the physical origin in PlotIt MCP.");
        const target = {
          ...config,
          firmware: runner.snapshot.firmware ?? config.firmware,
        };
        if (info.configDigest !== fingerprint(target))
          throw new Error(
            "Machine settings or firmware changed. Prepare a new job.",
          );
        await command("start", { jobId: info.id });
        return { id: info.id, status: "starting" };
      });
    if (action === "control_job")
      return exclusive(async () => {
        const id = identity(p.id);
        if (runner.snapshot?.jobId !== id)
          throw new Error("This is not the active drawing.");
        if (!["pause", "resume", "stop"].includes(String(p.action)))
          throw new Error("Choose pause, resume, or stop.");
        if (p.action === "resume") {
          if (!isArmed())
            throw new Error(controlBlocker() ?? "Connect the plotter before resuming.");
          if (runner.snapshot.status === "tool-change")
            throw new Error(
              "Load the next pen and click Continue in PlotIt MCP.",
            );
        }
        await command(p.action);
        return { id, status: runner.snapshot.status };
      });
    throw new Error("Unsupported MCP operation.");
  }
  async function handleUI(
    action: string,
    p: Record<string, unknown>,
  ): Promise<any> {
    if (action === "heartbeat") return exclusive(async () => {
      const session = identity(p.session);
      if (uiSession !== session) {
        await cancelUpdate();
        uiSession = session;
        controlSuspended = false;
      } else if (!updateReserved && Date.now() - lastHeartbeat >= 5000) {
        controlSuspended = false;
      }
      lastHeartbeat = Date.now();
      return status();
    });
    const requireSession = () => {
      if (p.session !== uiSession || Date.now() - lastHeartbeat >= 5000) throw new Error("Reconnect the native companion window.");
    };
    requireSession();
    if (action === "prepare_update") return exclusive(async () => {
      requireSession();
      if (updateConfirmed) return { ready: true };
      if (!updateReserved) idle();
      if (tasks.size || reservations || changingHardware) throw new Error("Wait until preparation and calibration have finished.");
      updateReserved = true;
      try {
        if (runner.snapshot) await command("prepare-update");
        else if (await stat(join(socketDirectory, "runner-identity.json")).catch(() => null)) throw new Error("Reconnect the plotter service before updating.");
        updateConfirmed = true;
        return { ready: true };
      } catch (error) {
        // A timed-out acknowledgement may already have reserved the runner.
        // Release only after a confirmed cancellation; otherwise stay closed.
        await cancelUpdate().catch(() => undefined);
        throw error;
      }
    });
    if (action === "cancel_update") return exclusive(async () => {
      requireSession();
      await cancelUpdate();
      return { ready: true };
    });
    if (action === "status") return status();
    if (action === "devices") return { devices: await devices() };
    if (["save_machine", "connect", "disconnect", "origin", "pen"].includes(action)) return performSetup(action as SetupAction, p);
    if (action === "agent_status")
      return { agents: await setup.status(), entry: setup.entry() };
    if (action === "plan_agent")
      return setup.preview(
        await setup.plan(
          p.agent as Agent,
          p.operation as "install" | "remove",
          p.replace === true,
        ),
      );
    if (action === "apply_agent") return setup.apply(identity(p.id));
    if (action === "locate_agent") {
      const agent = p.agent as Agent;
      if (!["codex", "claude-code"].includes(agent))
        throw new Error("Unsupported agent.");
      const path = await setup.executable(
        agent,
        text(p.path, "executable path", 4096),
      );
      if (!path) throw new Error("Choose an executable file.");
      setup.overrides[agent] = path;
      await saveAgentPreferences();
      return { path };
    }
    if (action === "codex_config_directory") {
      const path = text(p.path, "configuration directory", 4096);
      if (!isAbsolute(path))
        throw new Error("Choose an absolute configuration directory.");
      setup.codexHome = path;
      await saveAgentPreferences();
      return { path };
    }
    if (action === "suspend_control") {
      controlSuspended = true;
      return status();
    }
    if (action === "control")
      return exclusive(async () => {
        if (!["pause", "resume", "continue", "stop"].includes(String(p.action)))
          throw new Error("Unsupported job control.");
        await command(p.action);
        return status();
      });
    if (action === "test_server") {
      const [{ Client }, { StdioClientTransport }] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/client/stdio.js"),
      ]);
      const client = new Client({
        name: "PlotIt connection test",
        version: VERSION,
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(dirname(fileURLToPath(import.meta.url)), "stdio.mjs")],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (v): v is [string, string] => v[1] !== undefined,
            ),
          ),
          PLOTIT_SOCKET_DIR: socketDirectory,
        },
        stderr: "pipe",
      });
      try {
        await client.connect(transport);
        const advertised = await client.listTools();
        if (advertised.tools.length !== 16)
          throw new Error(
            "The MCP server did not advertise the expected tools.",
          );
        await client.callTool({ name: "get_status", arguments: {} });
        return {
          ok: true,
          version: VERSION,
          tools: advertised.tools.map((t) => t.name),
        };
      } finally {
        await client.close();
      }
    }
    if (action === "quit")
      return exclusive(async () => {
        requireSession();
        if (!updateConfirmed) idle();
        controlSuspended = true;
        closing = true;
        await close();
        return { quit: true };
      });
    throw new Error("Unsupported companion operation.");
  }
  // Restarted services mark incomplete preparation tasks failed; never replay work.
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(join(directory, "jobs"))) {
    if (!name.endsWith(".meta.json")) continue;
    try {
      const path = join(directory, "jobs", name),
        info = JSON.parse(await readFile(path, "utf8")) as JobInfo;
      if (info.status === "preparing") {
        info.status = "failed";
        info.error =
          "Companion restarted during preparation. Prepare a new job.";
      }
      if (info.simulation?.status === "running")
        info.simulation.status = "interrupted";
      await atomicJson(path, info);
      if (!lastJob || info.createdAt > lastJob.createdAt) lastJob = info;
    } catch (e) {
      console.error("Job recovery:", e);
    }
  }
  let mcpServer: Server | undefined, uiServer: Server | undefined;
  try {
    mcpServer = await listenRpc(socketDirectory, "mcp.sock", handleMcp);
    uiServer = await listenRpc(socketDirectory, "ui.sock", handleUI);
  } catch (e) {
    mcpServer?.close();
    await releaseLock();
    runner.close();
    throw e;
  }
  let logTick = 0;
  const lease = setInterval(() => {
    if (++logTick % 60 === 0)
      for (const name of ["service.log", "runner.log", "native-client.log"]) {
        const path = join(directory, name);
        void stat(path)
          .then((s) =>
            s.size > 5 * 1024 * 1024 ? truncate(path, 0) : undefined,
          )
          .catch(() => undefined);
      }
  }, 1000);
  async function close() {
    closing = true;
    clearInterval(lease);
    controlSuspended = true;
    for (const w of tasks.values()) await w.terminate();
    if (runner.snapshot?.connected && !active())
      await command("disconnect-ebb", { settings: settings(config) }).catch(
        console.error,
      );
    if (!active()) await stopRunner().catch(console.error);
    runner.close();
    // Do not await server.close inside its own in-flight quit request.
    mcpServer?.close();
    uiServer?.close();
    await Promise.all(
      ["mcp.sock", "ui.sock"].map((name) =>
        unlink(join(socketDirectory, name)).catch(() => undefined),
      ),
    );
    await releaseLock();
  }
  return { handleMcp, handleUI, status, close };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const paths = locations();
  const service = await startCompanion(paths);
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(sig, () => {
      void service.close().then(() => process.exit(0));
    });
  // No process is kept alive by agent connections. The native app controls lifetime.
  void writeFile(join(paths.directory, "service-version"), VERSION, {
    mode: 0o600,
  });
}
