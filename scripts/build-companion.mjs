import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
const out = "dist-companion";
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
});
await mkdir(`${out}/assets/src/fonts`, { recursive: true });
await cp("src/fonts/catalog.json", `${out}/assets/src/fonts/catalog.json`);
await mkdir(`${out}/assets/public`, { recursive: true });
await cp("public/fonts", `${out}/assets/public/fonts`, { recursive: true });
