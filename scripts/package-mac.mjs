import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  chmod,
  symlink,
  stat,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mergeUniversal, makeIcon, componentInventory, notarize, hashFile, exists, capture } from "./mac-bundle.mjs";

import { UPDATE_FEED, UPDATE_PUBLIC_KEY, SPARKLE_VERSION, appcastItem, verifyUpdate } from "./mac-update.mjs";

if (process.platform !== "darwin")
  throw new Error("Build the Mac app on macOS.");
const args = process.argv.slice(2),
  requested = args[args.indexOf("--arch") + 1] ?? process.arch;
const architectures =
  ["all", "universal"].includes(requested)
    ? ["arm64", "x64", "universal"]
    : [args.includes("--arch") ? requested : process.arch];
if (architectures.some((a) => !["arm64", "x64", "universal"].includes(a)))
  throw new Error("Use --arch arm64, x64, universal, or all.");
const packageArchitectures = requested === "universal" ? ["universal"] : architectures;
const release = args.includes("--release"),
  identity = process.env.PLOTIT_SIGN_IDENTITY,
  notary = process.env.PLOTIT_NOTARY_PROFILE;
if (release && (!identity || !notary))
  throw new Error(
    "Release packaging requires PLOTIT_SIGN_IDENTITY and PLOTIT_NOTARY_PROFILE.",
  );
const config = JSON.parse(await readFile("macos/release.json", "utf8"));
const version = process.env.PLOTIT_MAC_VERSION ?? config.version;
const buildNumber = process.env.PLOTIT_MAC_BUILD ?? config.build;
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+(\.\d+){0,2}$/.test(buildNumber)) throw new Error("Set a numeric macOS version and build number.");
const icon = process.env.PLOTIT_APP_ICON ? resolve(process.env.PLOTIT_APP_ICON)
  : await exists("macos/Assets/AppIcon.icon") ? resolve("macos/Assets/AppIcon.icon")
  : await exists("macos/Assets/AppIcon.icns") ? resolve("macos/Assets/AppIcon.icns")
  : await exists("macos/Assets/AppIcon.png") ? resolve("macos/Assets/AppIcon.png") : null;
if (release && !icon) throw new Error("Add the final app icon before release: macos/Assets/AppIcon.icon, AppIcon.icns or AppIcon.png, or PLOTIT_APP_ICON.");
const artifacts = [];
const builtAt = new Date().toISOString();
let sourceCommit = null, sourceDirty = true;
try {
  sourceCommit = capture("git", ["rev-parse", "HEAD"]);
  sourceDirty = capture("git", ["status", "--porcelain"]).length > 0;
} catch { /* Corresponding-source archives intentionally do not include .git. */ }
if (release && (!sourceCommit || sourceDirty)) throw new Error("Commit reviewed source before creating a signed public release.");
function verifySourceCommit() {
  if (release && (capture("git", ["rev-parse", "HEAD"]) !== sourceCommit || capture("git", ["status", "--porcelain"]).length > 0)) throw new Error("Source changed during the release build. Commit the changes and rebuild.");
}
const root = resolve("."),
  pin = (await readFile(".nvmrc", "utf8")).trim();
if (process.versions.node !== pin)
  throw new Error(`Build with the repository-pinned Node ${pin}.`);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });
run(process.execPath, ["scripts/source-archive.mjs"]);
const sourceArchiveSha256 = await hashFile("public/plot-it-source.tar.gz");
// Compile once so every CPU slice includes identical artwork and asset catalog bytes.
const iconResources = resolve("output/plotit-icon-assets");
await rm(iconResources, { recursive: true, force: true });
await mkdir(iconResources, { recursive: true });
await makeIcon(icon, join(iconResources, "AppIcon.icns"), iconResources);
for (const arch of architectures) {
  const out = resolve("output", `plotit-mcp-${arch}`),
    app = join(out, "PlotIt MCP.app"),
    contents = join(app, "Contents"),
    resources = join(contents, "Resources"),
    runtime = join(resources, "runtime");
  await rm(out, { recursive: true, force: true });
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await mkdir(runtime, { recursive: true });
  if (arch === "universal") {
    await mergeUniversal(resolve("output/plotit-mcp-arm64/PlotIt MCP.app"), resolve("output/plotit-mcp-x64/PlotIt MCP.app"), app);
  } else {
  run("swift", [
    "build",
    "--package-path",
    "macos",
    "--scratch-path",
    `/tmp/plotit-swift-${arch}`,
    "-c",
    "release",
    "--triple",
    `${arch === "x64" ? "x86_64" : arch}-apple-macosx14.0`,
  ]);
  const bin = execFileSync(
    "swift",
    [
      "build",
      "--package-path",
      "macos",
      "--scratch-path",
      `/tmp/plotit-swift-${arch}`,
      "-c",
      "release",
      "--triple",
      `${arch === "x64" ? "x86_64" : arch}-apple-macosx14.0`,
      "--show-bin-path",
    ],
    { encoding: "utf8" },
  ).trim();
  const sparkle = `/tmp/plotit-swift-${arch}/artifacts/sparkle/Sparkle`;
  await mkdir(join(contents, "Frameworks"), { recursive: true });
  run("ditto", [join(sparkle, "Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"), join(contents, "Frameworks/Sparkle.framework")]);
  await cp(join(sparkle, "LICENSE"), join(resources, "SPARKLE-LICENSE"));
  await cp(join(bin, "PlotItMCP"), join(contents, "MacOS", "PlotItMCP"));
  await cp(join(bin, "plotit-mcp"), join(contents, "MacOS", "plotit-mcp"));
  for (const file of await readdir(bin))
    if (file.endsWith(".bundle")) await cp(join(bin, file), join(resources, file), { recursive: true });
  for (const file of await readdir("dist-companion"))
    if (file.endsWith(".mjs"))
      await cp(join("dist-companion", file), join(runtime, file));
  await cp("dist-companion/assets", join(resources, "assets"), {
    recursive: true,
  });
  await cp("package.json", join(runtime, "package.json"));
  await cp("package-lock.json", join(runtime, "package-lock.json"));
  for (const name of ["plotter-core", "openplotfont"]) {
    const target = join(runtime, "packages", name);
    await mkdir(target, { recursive: true });
    await cp(
      join("packages", name, "package.json"),
      join(target, "package.json"),
    );
    await cp(join("packages", name, "dist"), join(target, "dist"), {
      recursive: true,
    });
  }
  // npm's lockfile integrity checks and explicit target architecture apply to all native dependencies.
  run(
    process.execPath,
    [
      resolve(
        dirname(process.execPath),
        "../lib/node_modules/npm/bin/npm-cli.js",
      ),
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--os=darwin",
      `--cpu=${arch}`,
    ],
    { cwd: runtime },
  );
  if (arch === process.arch) {
    await cp(process.execPath, join(runtime, "node"));
    await cp(
      resolve(dirname(process.execPath), "../LICENSE"),
      join(resources, "NODE-LICENSE"),
    );
  } else {
    const filename = `node-v${pin}-darwin-${arch}.tar.gz`,
      base = `https://nodejs.org/dist/v${pin}/`;
    const checks = await (await fetch(base + "SHASUMS256.txt")).text(),
      response = await fetch(base + filename);
    if (!response.ok)
      throw new Error("Could not download the pinned Node runtime.");
    const bytes = Buffer.from(await response.arrayBuffer()),
      expected = checks
        .split("\n")
        .find((l) => l.endsWith(`  ${filename}`))
        ?.split(" ")[0];
    if (
      !expected ||
      createHash("sha256").update(bytes).digest("hex") !== expected
    )
      throw new Error("Node runtime checksum mismatch.");
    const archive = join(out, filename);
    await writeFile(archive, bytes);
    run("tar", ["-xzf", archive, "-C", out]);
    await cp(
      join(out, `node-v${pin}-darwin-${arch}/bin/node`),
      join(runtime, "node"),
    );
    await cp(
      join(out, `node-v${pin}-darwin-${arch}/LICENSE`),
      join(resources, "NODE-LICENSE"),
    );
    await rm(join(out, `node-v${pin}-darwin-${arch}`), { recursive: true });
    await rm(archive);
  }
  }
  await chmod(join(runtime, "node"), 0o755);
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${config.bundleIdentifier}</string><key>CFBundleName</key><string>PlotIt MCP</string><key>CFBundleDisplayName</key><string>PlotIt MCP</string><key>CFBundleExecutable</key><string>PlotItMCP</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${buildNumber}</string><key>LSMinimumSystemVersion</key><string>${config.minimumMacOS}</string><key>NSHumanReadableCopyright</key><string>${config.copyright}</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>CFBundleIconFile</key><string>AppIcon</string></dict></plist>`,
  );
  const plist = join(contents, "Info.plist");
  for (const [key, type, value] of [
    ["PlotItUpdatesEnabled", "bool", release ? "true" : "false"],
    ["SUFeedURL", "string", UPDATE_FEED], ["SUPublicEDKey", "string", UPDATE_PUBLIC_KEY],
    ["SUEnableAutomaticChecks", "bool", "true"], ["SUAutomaticallyUpdate", "bool", "true"],
    ["SUScheduledCheckInterval", "integer", "86400"], ["SUEnableSystemProfiling", "bool", "false"],
  ]) run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} ${type} ${value}`, plist]);
  await cp(join(iconResources, "AppIcon.icns"), join(resources, "AppIcon.icns"));
  if (await exists(join(iconResources, "Assets.car"))) {
    await cp(join(iconResources, "Assets.car"), join(resources, "Assets.car"));
    run("/usr/libexec/PlistBuddy", ["-c", "Add :CFBundleIconName string AppIcon", join(contents, "Info.plist")]);
  }
  const info = { name: config.displayName, version, build: buildNumber, channel: config.channel, architecture: arch, sourceCommit, sourceDirty, sourceArchiveSha256, builtAt, nodeVersion: pin, finalIcon: !!icon, liquidGlassIcon: await exists(join(resources, "Assets.car")), signingMode: release ? "developer-id" : "ad-hoc" };
  await writeFile(join(resources, "BUILD-INFO.json"), JSON.stringify(info, null, 2) + "\n");
  await writeFile(join(resources, "THIRD-PARTY-COMPONENTS.json"), JSON.stringify([...(await componentInventory(runtime)), { name: "Sparkle", version: SPARKLE_VERSION, license: "MIT and bundled third-party notices (SPARKLE-LICENSE)", cpu: ["arm64", "x86_64"], os: ["darwin"] }], null, 2) + "\n");
  for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
    await cp(file, join(resources, file));
  await cp(
    "public/plot-it-source.tar.gz",
    join(resources, "plot-it-source.tar.gz"),
  );
  await writeFile(
    join(resources, "COMPANION-NOTICES.txt"),
    "PlotIt MCP is Apache-2.0. Corresponding source is included as plot-it-source.tar.gz.\nMCP SDK: MIT; MCP Apps SDK: MIT; MCP client/core: Apache-2.0; smol-toml: MIT; resvg-js: MPL-2.0; Node.js and npm dependencies retain their bundled LICENSE/NOTICE files in runtime/node_modules.\n",
  );
  const entitlements = join(out, "runtime.entitlements");
  await writeFile(
    entitlements,
    '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/>' +
      (arch === "arm64" ? "" : '<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>') +
      '</dict></plist>',
  );
  // Sign nested Mach-O code first; never disable library validation globally.
  async function signNative(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const full = join(path, item.name);
      if (item.isDirectory()) await signNative(full);
      else if (item.name.endsWith(".node") || item.name.endsWith(".dylib"))
        run("codesign", [
          "--force",
          "--sign",
          release ? identity : "-",
          ...(release ? ["--timestamp", "--options", "runtime"] : []),
          full,
        ]);
    }
  }
  const framework = join(contents, "Frameworks/Sparkle.framework");
  const sign = path => run("codesign", ["--force", "--sign", release ? identity : "-", ...(release ? ["--timestamp", "--options", "runtime"] : []), path]);
  // Follow Sparkle's documented inside-out signing order, preserving symlinks.
  for (const relative of ["Versions/B/XPCServices/Downloader.xpc", "Versions/B/XPCServices/Installer.xpc", "Versions/B/Autoupdate", "Versions/B/Updater.app", "."]) sign(join(framework, relative));
  await signNative(runtime);
  run("codesign", [
    "--force",
    "--sign",
    release ? identity : "-",
    ...(release
      ? ["--timestamp", "--options", "runtime", "--entitlements", entitlements]
      : []),
    join(runtime, "node"),
  ]);
  for (const binary of ["plotit-mcp", "PlotItMCP"])
    run("codesign", [
      "--force",
      "--sign",
      release ? identity : "-",
      ...(release ? ["--timestamp", "--options", "runtime"] : []),
      join(contents, "MacOS", binary),
    ]);
  run("codesign", [
    "--force",
    "--sign",
    release ? identity : "-",
    ...(release ? ["--timestamp", "--options", "runtime"] : []),
    app,
  ]);
  run("codesign", ["--verify", "--deep", "--strict", app]);
  if (!packageArchitectures.includes(arch)) {
    console.info(`Verified ${arch} input for the universal package: ${app}`);
    continue;
  }
  if (release) {
    // Exercise the signed runtime before uploading. Intel V8 needs its legacy JIT
    // entitlement as well as MAP_JIT; an ad-hoc smoke test cannot catch this.
    let crossArchitecture = false;
    if (process.arch === "arm64") {
      try { capture("/usr/bin/arch", ["-x86_64", "/usr/bin/true"]); crossArchitecture = true; } catch { /* Rosetta is optional. */ }
    }
    run(process.execPath, ["scripts/verify-mac.mjs", app, ...(crossArchitecture ? [] : ["--host-only"])]);
    verifySourceCommit();
    const zip = join(out, "notarization.zip");
    run("ditto", ["-c", "-k", "--keepParent", app, zip]);
    await notarize(zip, notary, join(out, "notarization-app.json"), false);
    run("xcrun", ["stapler", "staple", app]);
    run("xcrun", ["stapler", "validate", app]);
    run("spctl", ["--assess", "--type", "execute", "--verbose", app]);
    await rm(zip);
  }
  const dmg = resolve(
    "output",
    `PlotIt-MCP-${arch}${release ? "" : "-development"}.dmg`,
  );
  await rm(dmg, { force: true });
  const staging = join(out, "dmg");
  await mkdir(staging);
  // Preserve macOS metadata and stapled tickets when staging the signed bundle.
  run("ditto", [app, join(staging, "PlotIt MCP.app")]);
  await symlink("/Applications", join(staging, "Applications"));
  run("hdiutil", [
    "create",
    "-volname",
    "PlotIt MCP",
    "-srcfolder",
    staging,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ]);
  await rm(staging, { recursive: true });
  if (release) {
    run("codesign", ["--sign", identity, "--timestamp", dmg]);
    await notarize(dmg, notary, join(out, "notarization-dmg.json"));
  }
  const zipArtifact = resolve("output", `PlotIt-MCP-${arch}${release ? "" : "-development"}.zip`);
  await rm(zipArtifact, { force: true });
  run("ditto", ["-c", "-k", "--keepParent", app, zipArtifact]);
  const files = [];
  for (const file of [dmg, zipArtifact]) files.push({ name: file.split("/").at(-1), sha256: await hashFile(file), bytes: (await stat(file)).size });
  let update;
  if (release && arch === "universal") {
    const signer = `/tmp/plotit-swift-arm64/artifacts/sparkle/Sparkle/bin/sign_update`;
    const edSignature = capture(signer, ["--account", config.bundleIdentifier, "-p", zipArtifact]);
    const file = files.find(file => file.name.endsWith(".zip"));
    update = { ...file, edSignature, url: `https://github.com/thierryc/Plot-It/releases/download/${config.releaseTag}/${file.name}`, sparkleVersion: SPARKLE_VERSION };
    verifyUpdate(await readFile(zipArtifact), update);
    await writeFile(resolve("output/appcast-item.xml"), appcastItem({ ...info, update }, config.releaseTag) + "\n");
  }
  artifacts.push({ ...info, ...(update ? { update } : {}), notarized: release, app: `plotit-mcp-${arch}/PlotIt MCP.app`, files });
  console.info(
    `${release ? "Signed release" : "Ad-hoc development build"}: ${app}\n${dmg}`,
  );
}

verifySourceCommit();
const manifest = { name: config.displayName, version, build: buildNumber, channel: config.channel, distributionStatus: release ? "signed-and-notarized" : "development", artifacts };
await writeFile(resolve("output/PlotIt-MCP-release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(resolve("output/PlotIt-MCP-SHA256SUMS.txt"), artifacts.flatMap(a => a.files.map(f => `${f.sha256}  ${f.name}`)).join("\n") + "\n");
