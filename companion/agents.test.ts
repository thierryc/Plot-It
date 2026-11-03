import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse } from "smol-toml";
import { AgentSetup, editConfig, configPath } from "./agents";
const entry = {
  command: "/Applications/PlotIt MCP.app/Contents/MacOS/plotit-mcp",
  args: [],
};
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
describe("agent configuration edits", () => {
  it.skipIf(!process.env.PLOTIT_TEST_CLAUDE_CLI)(
    "uses the installed Claude Code CLI with an isolated profile",
    async () => {
      const home = await mkdtemp("/tmp/pi-claude-cli-");
      temporary.push(home);
      const setup = new AgentSetup(entry.command, home, {
        "claude-code": process.env.PLOTIT_TEST_CLAUDE_CLI,
      });
      setup.claudeDirectory = join(home, "profile");
      const path = configPath(
        "claude-code",
        home,
        undefined,
        setup.claudeDirectory,
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          mcpServers: {
            other: { type: "stdio", command: "other", args: [], env: {} },
          },
        }),
      );
      const install = await setup.plan("claude-code", "install");
      await setup.apply(install.id);
      expect(
        JSON.parse(await readFile(path, "utf8")).mcpServers.plotit.command,
      ).toBe(entry.command);
      const same = await setup.plan("claude-code", "install");
      expect((await setup.apply(same.id)).unchanged).toBe(true);
      const remove = await setup.plan("claude-code", "remove");
      await setup.apply(remove.id);
      expect(
        JSON.parse(await readFile(path, "utf8")).mcpServers.other.command,
      ).toBe("other");
    },
  );
  it.skipIf(!process.env.PLOTIT_TEST_CODEX_CLI)(
    "uses the installed Codex CLI without touching its real profile",
    async () => {
      const home = await mkdtemp("/tmp/pi-codex-cli-");
      temporary.push(home);
      const setup = new AgentSetup(entry.command, home, {
        codex: process.env.PLOTIT_TEST_CODEX_CLI,
      });
      const path = configPath("codex", home, join(home, ".codex"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        '# Keep this\nmodel = "test-model"\n[mcp_servers.other]\ncommand = "other"\n',
      );
      const install = await setup.plan("codex", "install");
      expect(install.cli).toBeTruthy();
      await setup.apply(install.id);
      const installed = parse(await readFile(path, "utf8"));
      expect(installed.model).toBe("test-model");
      expect((installed.mcp_servers as any).other.command).toBe("other");
      expect((installed.mcp_servers as any).plotit.command).toBe(entry.command);
      const same = await setup.plan("codex", "install");
      expect((await setup.apply(same.id)).unchanged).toBe(true);
      const remove = await setup.plan("codex", "remove");
      await setup.apply(remove.id);
      expect(
        (parse(await readFile(path, "utf8")).mcp_servers as any).other.command,
      ).toBe("other");
    },
  );
  it("preserves Codex comments, tables and values across idempotent install/removal", () => {
    const before =
      '# My settings\nmodel = "example"\n[mcp_servers.other]\ncommand = "other"\n[profiles.work]\nmodel = "work"\n';
    const installed = editConfig("codex", before, entry, "install");
    expect(installed).toContain("# My settings");
    expect((parse(installed).mcp_servers as any).other.command).toBe("other");
    expect(editConfig("codex", installed, entry, "install")).toBe(installed);
    expect(parse(editConfig("codex", installed, entry, "remove"))).toEqual(
      parse(before),
    );
  });
  it("refuses conflicts until Replace and never removes a subsequently edited entry", () => {
    const before = JSON.stringify({
      mcpServers: {
        plotit: { command: "different" },
        other: { command: "other" },
      },
      preferences: { keep: true },
    });
    expect(() =>
      editConfig("claude-desktop", before, entry, "install"),
    ).toThrow("Replace");
    const after = JSON.parse(
      editConfig("claude-desktop", before, entry, "install", true),
    );
    expect(after.mcpServers.other.command).toBe("other");
    expect(after.preferences.keep).toBe(true);
    expect(() =>
      editConfig("claude-desktop", before, entry, "remove"),
    ).toThrow();
  });
  it("does not silently rewrite complex TOML or malformed JSON", () => {
    expect(() =>
      editConfig(
        "claude-desktop",
        JSON.stringify({
          mcpServers: { plotit: { ...entry, env: { CHANGED: "yes" } } },
        }),
        entry,
        "remove",
      ),
    ).toThrow();
    expect(() =>
      editConfig(
        "codex",
        'mcp_servers = {plotit = {command = "other"}}\n',
        entry,
        "install",
        true,
      ),
    ).toThrow();
    expect(() =>
      editConfig("claude-desktop", "{bad", entry, "install"),
    ).toThrow();
  });
  it("backs up the reviewed file and rejects concurrent changes", async () => {
    const home = await mkdtemp("/tmp/pi-config-");
    temporary.push(home);
    const setup = new AgentSetup(entry.command, home);
    const path = configPath("claude-desktop", home);
    await mkdir(dirname(path), { recursive: true });
    const before = JSON.stringify({
      mcpServers: { other: { command: "other" } },
    });
    await writeFile(path, before);
    const preview = await setup.plan("claude-desktop", "install");
    await writeFile(path, before + " ");
    await expect(setup.apply(preview.id)).rejects.toThrow("changed");
    const again = await setup.plan("claude-desktop", "install"),
      result = await setup.apply(again.id);
    expect(await readFile(result.backup!, "utf8")).toBe(before + " ");
    expect(JSON.parse(await readFile(path, "utf8")).mcpServers.plotit).toEqual(
      entry,
    );
    const same = await setup.plan("claude-desktop", "install");
    expect((await setup.apply(same.id)).unchanged).toBe(true);
    const remove = await setup.plan("claude-desktop", "remove");
    await setup.apply(remove.id);
    expect(
      JSON.parse(await readFile(path, "utf8")).mcpServers.other.command,
    ).toBe("other");
  });
});
