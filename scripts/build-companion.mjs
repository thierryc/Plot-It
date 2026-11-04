import { build } from "esbuild";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
const out = "dist-companion";
const nativeRelease = JSON.parse(await readFile("macos/release.json", "utf8"));
const appIcon = `data:image/png;base64,${(await readFile("macos/Sources/PlotItApp/Resources/PlotItAppIcon.png")).toString("base64")}`;
await mkdir(out, { recursive: true });
await build({
  entryPoints: [
    "companion/service.ts",
    "companion/stdio.ts",
    "companion/ui-client.ts",
    "companion/runner-entry.ts",
    "companion/worker.ts",
  ],
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  define: { "process.env.PLOTIT_MAC_VERSION": JSON.stringify(process.env.PLOTIT_MAC_VERSION ?? nativeRelease.version) },
});
await mkdir(`${out}/assets/src/fonts`, { recursive: true });
for (const name of ["plot-progress", "plotter-setup"]) {
  const widget = await build({
    entryPoints: [`companion/ui/${name}.ts`],
    bundle: true, platform: "browser", format: "esm", target: "es2022", minify: true, write: false,
  });
  const html = (await readFile(`companion/ui/${name}.html`, "utf8"))
    .replaceAll("PLOTIT_APP_ICON_DATA_URL", appIcon)
    .replace("/* PLOTIT_APP_SCRIPT */", () => widget.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
  await writeFile(`${out}/assets/${name}.html`, html);
}
await cp("src/fonts/catalog.json", `${out}/assets/src/fonts/catalog.json`);
await mkdir(`${out}/assets/public`, { recursive: true });
await cp("public/fonts", `${out}/assets/public/fonts`, { recursive: true });
