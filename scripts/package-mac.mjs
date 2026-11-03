import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  chmod,
  symlink,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";

if (process.platform !== "darwin")
  throw new Error("Build the Mac app on macOS.");
const args = process.argv.slice(2),
  requested = args[args.indexOf("--arch") + 1] ?? process.arch;
const architectures =
  requested === "all"
    ? ["arm64", "x64"]
    : [args.includes("--arch") ? requested : process.arch];
if (architectures.some((a) => !["arm64", "x64"].includes(a)))
  throw new Error("Use --arch arm64, x64, or all.");
const release = args.includes("--release"),
  identity = process.env.PLOTIT_SIGN_IDENTITY,
  notary = process.env.PLOTIT_NOTARY_PROFILE;
if (release && (!identity || !notary))
  throw new Error(
    "Release packaging requires PLOTIT_SIGN_IDENTITY and PLOTIT_NOTARY_PROFILE.",
  );
const root = resolve("."),
  pin = (await readFile(".nvmrc", "utf8")).trim();
if (process.versions.node !== pin)
  throw new Error(`Build with the repository-pinned Node ${pin}.`);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
run(process.execPath, ["scripts/source-archive.mjs"]);
for (const arch of architectures) {
  const out = resolve("output", `plotit-mcp-${arch}`),
    app = join(out, "PlotIt MCP.app"),
    contents = join(app, "Contents"),
    resources = join(contents, "Resources"),
    runtime = join(resources, "runtime");
  await rm(out, { recursive: true, force: true });
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await mkdir(runtime, { recursive: true });
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
  await cp(join(bin, "PlotItMCP"), join(contents, "MacOS", "PlotItMCP"));
  await cp(join(bin, "plotit-mcp"), join(contents, "MacOS", "plotit-mcp"));
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
  await chmod(join(runtime, "node"), 0o755);
  const version = packageJson.version.replace(/-.*/, "");
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>cx.ap.plotit.mcp</string><key>CFBundleName</key><string>PlotIt MCP</string><key>CFBundleDisplayName</key><string>PlotIt MCP</string><key>CFBundleExecutable</key><string>PlotItMCP</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>CFBundleIconFile</key><string>AppIcon</string></dict></plist>`,
  );
  const iconset = join(out, "AppIcon.iconset");
  await mkdir(iconset);
  const logo =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="80" y="80" width="864" height="864" rx="192" fill="#137b75"/><path d="M284 700V324h240c170 0 170 234 0 234H388M388 700V324" fill="none" stroke="#fff" stroke-width="65" stroke-linecap="round" stroke-linejoin="round"/><circle cx="722" cy="700" r="32" fill="#afe2cc"/></svg>';
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      await writeFile(
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        new Resvg(logo, { fitTo: { mode: "width", value: size * scale } })
          .render()
          .asPng(),
      );
  run("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    join(resources, "AppIcon.icns"),
  ]);
  await rm(iconset, { recursive: true });
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
    await cp(file, join(resources, file));
  await cp(
    "public/plot-it-source.tar.gz",
    join(resources, "plot-it-source.tar.gz"),
  );
  await writeFile(
    join(resources, "COMPANION-NOTICES.txt"),
    "PlotIt MCP is Apache-2.0. Corresponding source is included as plot-it-source.tar.gz.\nMCP SDK: MIT; smol-toml: MIT; resvg-js: MPL-2.0; Node.js and npm dependencies retain their bundled LICENSE/NOTICE files in runtime/node_modules.\n",
  );
  const entitlements = join(out, "runtime.entitlements");
  await writeFile(
    entitlements,
    '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>',
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
  if (release) {
    const zip = join(out, "notarization.zip");
    run("ditto", ["-c", "-k", "--keepParent", app, zip]);
    run("xcrun", [
      "notarytool",
      "submit",
      zip,
      "--keychain-profile",
      notary,
      "--wait",
    ]);
    run("xcrun", ["stapler", "staple", app]);
    await rm(zip);
  }
  const dmg = resolve(
    "output",
    `PlotIt-MCP-${arch}${release ? "" : "-development"}.dmg`,
  );
  await rm(dmg, { force: true });
  const staging = join(out, "dmg");
  await mkdir(staging);
  await cp(app, join(staging, "PlotIt MCP.app"), {
    recursive: true,
    verbatimSymlinks: true,
  });
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
    run("xcrun", [
      "notarytool",
      "submit",
      dmg,
      "--keychain-profile",
      notary,
      "--wait",
    ]);
    run("xcrun", ["stapler", "staple", dmg]);
  }
  console.info(
    `${release ? "Signed release" : "Ad-hoc development build"}: ${app}\n${dmg}`,
  );
}
