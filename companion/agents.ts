import {
  readFile,
  writeFile,
  rename,
  mkdir,
  access,
  constants,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";
import { object } from "./common";

export type Agent = "codex" | "claude-code" | "claude-desktop";
type Definition = { command: string; args: string[] };
export interface AgentChange {
  id: string;
  agent: Agent;
  operation: "install" | "remove";
  path: string;
  before: string;
  after: string;
  conflict: boolean;
  entry: Definition;
  cli?: string;
  command?: string[];
}
const BEGIN = "# BEGIN PlotIt MCP (managed)",
  END = "# END PlotIt MCP (managed)";
const run = promisify(execFile);
async function contents(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}
export function configPath(
  agent: Agent,
  home = homedir(),
  codexHome = process.env.CODEX_HOME,
  claudeDirectory = home === homedir()
    ? process.env.CLAUDE_CONFIG_DIR
    : undefined,
) {
  if (agent === "codex")
    return join(codexHome || join(home, ".codex"), "config.toml");
  if (agent === "claude-code")
    return join(claudeDirectory || home, ".claude.json");
  return join(
    home,
    "Library",
    "Application Support",
    "Claude",
    "claude_desktop_config.json",
  );
}
function equivalent(a: unknown, b: Definition) {
  if (!a || typeof a !== "object") return false;
  const v = a as Definition & { type?: string; env?: Record<string, unknown> };
  return (
    Object.keys(v).every((k) =>
      ["command", "args", "type", "env"].includes(k),
    ) &&
    (v.type === undefined || v.type === "stdio") &&
    (v.env === undefined || Object.keys(v.env).length === 0) &&
    v.command === b.command &&
    JSON.stringify(v.args ?? []) === JSON.stringify(b.args)
  );
}
export function editConfig(
  agent: Agent,
  before: string,
  entry: Definition,
  operation: "install" | "remove",
  replace = false,
): string {
  if (agent !== "codex") {
    const config = before.trim() ? object(JSON.parse(before)) : {};
    const servers = object(config.mcpServers ?? {}),
      previous = servers.plotit;
    if (previous && !equivalent(previous, entry) && !replace)
      throw new Error(
        "A different plotit server is configured. Choose Replace explicitly.",
      );
    if (operation === "remove" && previous && !equivalent(previous, entry))
      throw new Error(
        "This plotit entry was changed elsewhere; it will not be removed.",
      );
    if (operation === "install")
      servers.plotit = {
        ...(agent === "claude-code" ? { type: "stdio" } : {}),
        ...entry,
      };
    else delete servers.plotit;
    return JSON.stringify({ ...config, mcpServers: servers }, null, 2) + "\n";
  }
  const parsed = before.trim() ? parseToml(before) : {};
  const servers = (parsed.mcp_servers ?? {}) as Record<string, unknown>,
    previous = servers.plotit;
  if (previous && !equivalent(previous, entry) && !replace)
    throw new Error(
      "A different plotit server is configured. Choose Replace explicitly.",
    );
  if (operation === "remove" && previous && !equivalent(previous, entry))
    throw new Error(
      "This plotit entry was changed elsewhere; it will not be removed.",
    );
  let after = before;
  const begin = before.indexOf(BEGIN),
    end = before.indexOf(END);
  if (begin >= 0 && end > begin)
    after =
      before.slice(0, begin) +
      before.slice(end + END.length).replace(/^\r?\n/, "");
  else if (previous) {
    // Only edit a simple dedicated table. Verify semantic preservation below;
    // inline/complex hand-written configurations receive a useful refusal.
    const lines = before.split(/(?<=\n)/);
    let own = false;
    after = "";
    for (const line of lines) {
      if (/^\s*\[/.test(line))
        own = /^\s*\[mcp_servers\.plotit(?:\.[\w-]+)*\]\s*(?:#.*)?$/.test(
          line.trim(),
        );
      if (!own) after += line;
    }
  }
  if (operation === "install")
    after =
      after.trimEnd() +
      `\n\n${BEGIN}\n[mcp_servers.plotit]\ncommand = ${JSON.stringify(entry.command)}\nargs = []\n${END}\n`;
  const result = after.trim() ? parseToml(after) : {};
  const strip = (v: Record<string, any>) => {
    const copy = structuredClone(v);
    if (copy.mcp_servers) {
      delete copy.mcp_servers.plotit;
      if (!Object.keys(copy.mcp_servers).length) delete copy.mcp_servers;
    }
    return copy;
  };
  if (!isDeepStrictEqual(strip(parsed), strip(result)))
    throw new Error(
      "Cannot safely edit this TOML layout. Configure plotit manually using the supplied entry.",
    );
  if (
    operation === "install" &&
    !equivalent((result.mcp_servers as Record<string, unknown>)?.plotit, entry)
  )
    throw new Error("Could not install the PlotIt entry.");
  return after;
}
export class AgentSetup {
  private changes = new Map<string, AgentChange>();
  codexHome?: string;
  claudeDirectory?: string;
  constructor(
    readonly launcher: string,
    readonly home = homedir(),
    readonly overrides: Partial<Record<Agent, string>> = {},
  ) {
    this.claudeDirectory =
      home === homedir()
        ? process.env.CLAUDE_CONFIG_DIR || undefined
        : undefined;
  }
  entry(): Definition {
    return { command: this.launcher, args: [] };
  }
  preview(change: AgentChange): AgentChange {
    const parsed = change.before.trim()
      ? change.agent === "codex"
        ? parseToml(change.before)
        : JSON.parse(change.before)
      : {};
    const previous = (
      change.agent === "codex" ? parsed.mcp_servers : parsed.mcpServers
    )?.plotit;
    // The dialog needs the affected entry, never unrelated settings or credentials.
    return {
      ...change,
      before: previous
        ? JSON.stringify(
            {
              command: previous.command ?? "HTTP server",
              argumentCount: Array.isArray(previous.args)
                ? previous.args.length
                : 0,
            },
            null,
            2,
          )
        : "No existing PlotIt entry",
      after: JSON.stringify(change.entry, null, 2),
    };
  }
  async executable(
    agent: Agent,
    selected?: string,
  ): Promise<string | undefined> {
    const name = agent === "codex" ? "codex" : "claude";
    const bundleExecutables = (app: string) =>
      agent === "codex"
        ? [
            join(app, "Contents/Resources/codex"),
            join(
              app,
              "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
            ),
          ]
        : [];
    const candidates = selected
      ? selected.endsWith(".app")
        ? bundleExecutables(selected)
        : [selected]
      : [
          ...(process.env.PATH ?? "")
            .split(":")
            .filter(Boolean)
            .map((p) => join(p, name)),
          join(this.home, ".local/bin", name),
          join("/opt/homebrew/bin", name),
          join("/usr/local/bin", name),
          ...(agent === "codex"
            ? ["/Applications", join(this.home, "Applications")].flatMap(
                (root) =>
                  ["Codex.app", "ChatGPT.app"].flatMap((app) =>
                    bundleExecutables(join(root, app)),
                  ),
              )
            : []),
        ];
    for (const p of candidates)
      try {
        await access(p, constants.X_OK);
        if (!(await stat(p)).isFile()) continue;
        return resolve(p);
      } catch {
        /* next candidate */
      }
  }
  async status() {
    return Promise.all(
      (["codex", "claude-code", "claude-desktop"] as Agent[]).map(
        async (agent) => {
          const path = configPath(
              agent,
              this.home,
              this.codexHome ??
                (this.home === homedir()
                  ? process.env.CODEX_HOME
                  : join(this.home, ".codex")),
              this.claudeDirectory,
            ),
            before = await contents(path);
          let configured = false,
            error: string | undefined;
          try {
            const config =
              agent === "codex"
                ? before.trim()
                  ? parseToml(before)
                  : {}
                : before.trim()
                  ? JSON.parse(before)
                  : {};
            configured = equivalent(
              (agent === "codex" ? config.mcp_servers : config.mcpServers)
                ?.plotit,
              this.entry(),
            );
          } catch (e) {
            error = (e as Error).message;
          }
          return {
            id: agent,
            path,
            configured,
            cli: await this.executable(agent, this.overrides[agent]),
            error,
          };
        },
      ),
    );
  }
  async plan(
    agent: Agent,
    operation: "install" | "remove",
    replace = false,
  ): Promise<AgentChange> {
    if (
      !["codex", "claude-code", "claude-desktop"].includes(agent) ||
      !["install", "remove"].includes(operation)
    )
      throw new Error("Unsupported agent action.");
    const path = configPath(
        agent,
        this.home,
        this.codexHome ??
          (this.home === homedir()
            ? process.env.CODEX_HOME
            : join(this.home, ".codex")),
        this.claudeDirectory,
      ),
      before = await contents(path),
      entry = this.entry();
    let conflict = false;
    try {
      editConfig(agent, before, entry, operation);
    } catch (e) {
      if (!String(e).includes("different plotit")) throw e;
      conflict = true;
    }
    if (conflict && !replace)
      return {
        id: "",
        agent,
        operation,
        path,
        before,
        after: "",
        conflict,
        entry,
      };
    const after = editConfig(agent, before, entry, operation, replace),
      cli =
        agent === "claude-desktop"
          ? undefined
          : await this.executable(agent, this.overrides[agent]);
    if (agent === "claude-code" && !cli)
      throw new Error(
        "Locate the Claude Code executable, or install Claude Code first.",
      );
    const command =
      cli && !conflict
        ? agent === "codex"
          ? operation === "install"
            ? ["mcp", "add", "plotit", "--", entry.command]
            : ["mcp", "remove", "plotit"]
          : operation === "install"
            ? [
                "mcp",
                "add",
                "--scope",
                "user",
                "--transport",
                "stdio",
                "plotit",
                "--",
                entry.command,
              ]
            : ["mcp", "remove", "--scope", "user", "plotit"]
        : undefined;
    const change = {
      id: randomUUID(),
      agent,
      operation,
      path,
      before,
      after,
      conflict,
      entry,
      cli,
      command,
    };
    this.changes.set(change.id, change);
    if (this.changes.size > 10)
      this.changes.delete(this.changes.keys().next().value!);
    return change;
  }
  async apply(id: string) {
    const c = this.changes.get(id);
    if (!c) throw new Error("Preview this configuration change again.");
    this.changes.delete(id);
    if ((await contents(c.path)) !== c.before)
      throw new Error(
        "Configuration changed since preview. Review the change again.",
      );
    const prior = c.before.trim()
      ? c.agent === "codex"
        ? parseToml(c.before)
        : JSON.parse(c.before)
      : {};
    const previous = (
      c.agent === "codex" ? prior.mcp_servers : prior.mcpServers
    )?.plotit;
    if (
      (c.operation === "install" && equivalent(previous, c.entry)) ||
      (c.operation === "remove" && previous === undefined)
    )
      return {
        configured: c.operation === "install",
        backup: null,
        restartRequired: false,
        unchanged: true,
      };
    await mkdir(dirname(c.path), { recursive: true, mode: 0o700 });
    const backup = `${c.path}.plotit-${Date.now()}.bak`;
    if (c.before)
      await writeFile(backup, c.before, { mode: 0o600, flag: "wx" });
    if ((await contents(c.path)) !== c.before)
      throw new Error(
        "Configuration changed while making its backup. Review the change again.",
      );
    if (c.cli && c.command) {
      await run(c.cli, c.command, {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ...(c.agent === "codex" ? { CODEX_HOME: dirname(c.path) } : {}),
          ...(c.agent === "claude-code" && this.claudeDirectory
            ? { CLAUDE_CONFIG_DIR: this.claudeDirectory }
            : {}),
        },
      });
    } else {
      const temp = `${c.path}.${randomUUID()}.tmp`;
      await writeFile(temp, c.after, { mode: 0o600, flag: "wx" });
      await rename(temp, c.path);
    }
    const updated = await contents(c.path);
    const parsed =
        c.agent === "codex" ? parseToml(updated) : JSON.parse(updated),
      installed = equivalent(
        (c.agent === "codex" ? parsed.mcp_servers : parsed.mcpServers)?.plotit,
        c.entry,
      );
    if (installed !== (c.operation === "install"))
      throw new Error(
        "The agent did not save the expected configuration. Check its managed settings.",
      );
    return {
      configured: installed,
      backup: c.before ? backup : null,
      restartRequired: c.agent === "claude-desktop",
    };
  }
}
