import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { capture, run, exists, hashFile } from "./mac-bundle.mjs";

const app = resolve(process.argv[2] ?? "output/plotit-mcp-universal/PlotIt MCP.app");
const resources = join(app, "Contents/Resources"), runtime = join(resources, "runtime");
const info = JSON.parse(await readFile(join(resources, "BUILD-INFO.json"), "utf8"));
if (info.sourceArchiveSha256) assert.equal(await hashFile(join(resources, "plot-it-source.tar.gz")), info.sourceArchiveSha256, "Bundled source archive differs from build provenance");
const expected = info.architecture === "universal" ? ["arm64", "x86_64"] : [info.architecture === "x64" ? "x86_64" : "arm64"];
for (const relative of ["Contents/MacOS/PlotItMCP", "Contents/MacOS/plotit-mcp", "Contents/Resources/runtime/node"]) {
  const path = join(app, relative), actual = capture("lipo", ["-archs", path]).split(/\s+/);
  for (const arch of expected) assert(actual.includes(arch), `${relative} missing ${arch}`);
  assert((await stat(path)).mode & 0o111, `${relative} is not executable`);
}
for (const file of ["AppIcon.icns", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "NODE-LICENSE", "COMPANION-NOTICES.txt", "THIRD-PARTY-COMPONENTS.json", "plot-it-source.tar.gz", "assets/plot-progress.html", "assets/plotter-setup.html"]) assert(await exists(join(resources, file)), `Missing ${file}`);
for (const name of ["PlotItIdle", "PlotItPlotting"]) {
  const path = join(resources, "PlotItMCP_PlotItApp.bundle/Contents/Resources", `${name}.pdf`);
  assert((await readFile(path)).subarray(0, 5).toString() === "%PDF-", `Missing vector menu-bar icon: ${name}`);
}
if (info.liquidGlassIcon) {
  assert.equal(capture("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconName", join(app, "Contents/Info.plist")]), "AppIcon");
  assert((await stat(join(resources, "Assets.car"))).size > 0, "Missing Liquid Glass icon catalog");
}
for (const name of ["plot-progress", "plotter-setup"]) assert(!(await readFile(join(resources, "assets", `${name}.html`), "utf8")).includes("/* PLOTIT_APP_SCRIPT */"), `${name} script was not bundled`);
run("codesign", ["--verify", "--deep", "--strict", app]);
const runtimeArchitectures = process.argv.includes("--host-only") ? expected.filter(arch => arch === (process.arch === "x64" ? "x86_64" : process.arch)) : expected;
for (const arch of runtimeArchitectures) {
  const wanted = arch === "x86_64" ? "x64" : "arm64";
  const result = capture("/usr/bin/arch", [`-${arch}`, join(runtime, "node"), "--input-type=module", "-e", `import { createRequire } from 'node:module'; const require=createRequire(${JSON.stringify(join(runtime, "package.json"))}); const {Resvg}=require('@resvg/resvg-js'); const bindings=require('@serialport/bindings-cpp'); new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').render().asPng(); if(!bindings.autoDetect)throw new Error('Serial binding missing'); console.log(process.arch);`]);
  assert.equal(result, wanted, `Runtime selected the wrong CPU for ${arch}`);
}
if (process.argv.includes("--release")) {
  assert.equal(info.signingMode, "developer-id");
  assert.equal(info.finalIcon, true);
  assert.equal(info.sourceDirty, false, "Public release must come from a clean commit");
  assert.match(info.sourceCommit, /^[0-9a-f]{40}$/);
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose", app]);
}
console.info(`Verified ${info.architecture}: Swift/Node slices (${expected.join(" + ")}), signatures, cards and bundled notices. Native addons exercised: ${runtimeArchitectures.join(" + ") || "none (cross-build)"}. No USB was opened.`);
