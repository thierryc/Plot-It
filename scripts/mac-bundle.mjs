import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, dirname, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";

export const capture = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", ...options });
export async function hashFile(path) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
export async function exists(path) { return !!await stat(path).catch(() => null); }
async function isMachO(path) {
  const bytes = await readFile(path);
  return bytes.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(bytes.readUInt32BE(0));
}
export async function mergeUniversal(armApp, intelApp, destination) {
  await cp(armApp, destination, { recursive: true, verbatimSymlinks: true });
  async function merge(source, target) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (["_CodeSignature", ".package-lock.json", "BUILD-INFO.json", "THIRD-PARTY-COMPONENTS.json"].includes(entry.name)) continue;
      const from = join(source, entry.name), to = join(target, entry.name);
      if (!await exists(to)) { await cp(from, to, { recursive: true, verbatimSymlinks: true }); continue; }
      if (entry.isDirectory()) { await merge(from, to); continue; }
      if (entry.isSymbolicLink() || await hashFile(from) === await hashFile(to)) continue;
      if (!await isMachO(from) || !await isMachO(to)) throw new Error(`Universal inputs differ outside native code: ${from}`);
      const present = capture("lipo", ["-archs", to]).split(/\s+/);
      const sourceArchs = capture("lipo", ["-archs", from]).split(/\s+/);
      const missing = sourceArchs.filter(arch => !present.includes(arch));
      for (const arch of missing) {
        const slice = `${to}.${arch}.thin`, combined = `${to}.universal`;
        try {
          if (sourceArchs.length === 1) await cp(from, slice); else run("lipo", [from, "-thin", arch, "-output", slice]);
          const mode = (await stat(to)).mode & 0o777;
          run("lipo", ["-create", to, slice, "-output", combined]);
          await rename(combined, to);
          await chmod(to, mode);
        } finally { await rm(slice, { force: true }); await rm(combined, { force: true }); }
      }
    }
  }
  await merge(intelApp, destination);
  await rm(join(destination, "Contents/_CodeSignature"), { recursive: true, force: true });
  await rm(join(destination, "Contents/Resources/runtime/node_modules/.package-lock.json"), { force: true });
  for (const binary of ["Contents/MacOS/PlotItMCP", "Contents/MacOS/plotit-mcp", "Contents/Resources/runtime/node"]) {
    const archs = capture("lipo", ["-archs", join(destination, binary)]).split(/\s+/);
    if (!archs.includes("arm64") || !archs.includes("x86_64")) throw new Error(`Universal slice missing: ${binary}`);
  }
}

export async function makeIcon(source, destination, workDirectory) {
  if (source && extname(source).toLowerCase() === ".icon") {
    const resources = dirname(destination);
    run("xcrun", ["actool", source, "--compile", resources,
      "--output-format", "human-readable-text", "--notices", "--warnings", "--errors",
      "--output-partial-info-plist", join(workDirectory, "Icon-Info.plist"),
      "--app-icon", "AppIcon", "--include-all-app-icons", "--enable-on-demand-resources", "NO",
      "--development-region", "en", "--target-device", "mac", "--minimum-deployment-target", "14.0", "--platform", "macosx"]);
    if (!await exists(destination) || !await exists(join(resources, "Assets.car"))) throw new Error("Icon Composer compilation did not produce AppIcon.icns and Assets.car.");
    return;
  }
  if (source && extname(source).toLowerCase() === ".icns") { await cp(source, destination); return; }
  const iconset = join(workDirectory, "AppIcon.iconset");
  await mkdir(iconset, { recursive: true });
  if (source) {
    if (extname(source).toLowerCase() !== ".png") throw new Error("Supply an Icon Composer .icon, .icns, or square PNG at least 1024 × 1024 pixels.");
    const dimensions = capture("sips", ["-g", "pixelWidth", "-g", "pixelHeight", source]);
    const width = Number(/pixelWidth:\s*(\d+)/.exec(dimensions)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(dimensions)?.[1]);
    if (width !== height || width < 1024) throw new Error("The final PNG icon must be square and at least 1024 × 1024 pixels.");
  }
  const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="80" y="80" width="864" height="864" rx="192" fill="#137b75"/><path d="M284 700V324h240c170 0 170 234 0 234H388M388 700V324" fill="none" stroke="#fff" stroke-width="65" stroke-linecap="round" stroke-linejoin="round"/><circle cx="722" cy="700" r="32" fill="#afe2cc"/></svg>';
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    const target = join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`);
    if (source) run("sips", ["-z", String(size * scale), String(size * scale), source, "--out", target], { stdio: "ignore" });
    else await writeFile(target, new Resvg(placeholder, { fitTo: { mode: "width", value: size * scale } }).render().asPng());
  }
  run("iconutil", ["-c", "icns", iconset, "-o", destination]);
  await rm(iconset, { recursive: true });
}

export async function componentInventory(runtime) {
  const components = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith("@")) { await walk(path); continue; }
      const manifest = await readFile(join(path, "package.json"), "utf8").then(JSON.parse).catch(() => null);
      if (manifest?.name && manifest?.version) components.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? "See bundled license", cpu: manifest.cpu ?? null, os: manifest.os ?? null });
      if (await exists(join(path, "node_modules"))) await walk(join(path, "node_modules"));
    }
  }
  await walk(join(runtime, "node_modules"));
  return components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export async function notarize(path, profile, logPath, staple = true) {
  const result = JSON.parse(capture("xcrun", ["notarytool", "submit", path, "--keychain-profile", profile, "--wait", "--output-format", "json"]));
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "Accepted") throw new Error(`Notarization did not accept ${path}; inspect ${logPath}.`);
  if (staple) { run("xcrun", ["stapler", "staple", path]); run("xcrun", ["stapler", "validate", path]); }
}
