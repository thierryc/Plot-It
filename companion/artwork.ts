import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import {
  loadOpenPlotFont,
  layoutText,
  toSVG,
  type LayoutOptions,
} from "@thierryc/openplotfont";
import {
  executionSvg,
  preparePaths,
  validatePreparedJob,
  JobSequence,
  PlotterSession,
  type Path,
  type PreparedJob,
} from "@thierryc/plotter-core";
import { VirtualClock, VirtualEbb } from "@thierryc/plotter-core/virtual";
import { Resvg } from "@resvg/resvg-js";
import { readSvgScene, svgScenePaths } from "../src/svg-scene";
import { coreOptions } from "../src/core-settings";
import { JobStore, atomicJson } from "../server/jobs";
import {
  MAX_BYTES,
  object,
  text,
  finite,
  identity,
  fingerprint,
  settings,
  type MachineConfig,
} from "./common";

export interface Artifact {
  id: string;
  paths: Path[];
  name: string;
}
export interface JobInfo {
  id: string;
  status: string;
  createdAt: string;
  configDigest: string;
  previewPath?: string;
  svgPath?: string;
  durationMs?: number;
  drawingMm?: number;
  travelMm?: number;
  passes?: string[];
  error?: string;
  simulation?: { status: string; elapsedMs: number; commands: number };
}
export async function fonts(resources: string) {
  const catalog = JSON.parse(
    await readFile(join(resources, "src/fonts/catalog.json"), "utf8"),
  ) as {
    id: string;
    name: string;
    kind: string;
    url: string;
    license: string;
    coverageHint?: string;
  }[];
  return catalog.filter((f) => f.kind === "openplotfont");
}
function svgPaths(svg: string): Path[] {
  if (Buffer.byteLength(svg) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(svg))
    throw new Error(
      "SVG exceeds limits or contains unsupported entity declarations.",
    );
  const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
  try {
    return svgScenePaths(
      readSvgScene(
        dom.window.document.documentElement as unknown as Parameters<
          typeof readSvgScene
        >[0],
        0.05,
      ),
    );
  } finally {
    dom.window.close();
  }
}
function checkedPaths(value: unknown): Path[] {
  if (!Array.isArray(value) || !value.length || value.length > 100000)
    throw new Error("Supply 1–100,000 paths.");
  let count = 0;
  return value.map((value) => {
    const p = object(value);
    if (!Array.isArray(p.points) || p.points.length < 2)
      throw new Error("Each path requires at least two points.");
    count += p.points.length;
    if (count > 1_000_000)
      throw new Error("Artwork exceeds one million points.");
    return {
      tool: p.tool === undefined ? "black" : text(p.tool, "pen name", 100),
      points: p.points.map((v) => {
        const p = object(v);
        return {
          x: finite(p.x, "x", -1e6, 1e6),
          y: finite(p.y, "y", -1e6, 1e6),
        };
      }),
    };
  });
}
export async function createArtwork(
  directory: string,
  resources: string,
  input: Record<string, unknown>,
) {
  const source = object(input.source);
  let paths: Path[];
  if (source.kind === "svg") {
    if ((source.svg !== undefined) === (source.path !== undefined))
      throw new Error(
        "Supply either SVG content or an absolute local SVG path.",
      );
    if (source.path !== undefined) {
      const p = text(source.path, "SVG path", 4096);
      if (!isAbsolute(p) || !p.toLowerCase().endsWith(".svg"))
        throw new Error("Supply an absolute .svg file path.");
      const bytes = await readFile(p);
      if (bytes.length > MAX_BYTES) throw new Error("SVG exceeds 32 MiB.");
      paths = svgPaths(bytes.toString("utf8"));
    } else paths = svgPaths(text(source.svg, "SVG", MAX_BYTES));
  } else if (source.kind === "paths") paths = checkedPaths(source.paths);
  else if (source.kind === "text") {
    const font = (await fonts(resources)).find((f) => f.id === source.fontId);
    if (!font) throw new Error("Choose a font ID from list_fonts.");
    const content = text(source.text, "text", 10000),
      capHeight = finite(source.capHeightMm, "cap height", 0.1, 200, 5);
    const o = object(source.layout ?? {}),
      allowed = [
        "letterSpacing",
        "wordSpacing",
        "lineHeight",
        "align",
        "kerning",
        "ligatures",
        "contextual",
        "features",
        "direction",
        "language",
        "script",
      ];
    if (Object.keys(o).some((k) => !allowed.includes(k)))
      throw new Error("Unsupported text layout option.");
    for (const k of ["letterSpacing", "wordSpacing"] as const)
      if (o[k] !== undefined) finite(o[k], k, -10, 100);
    if (o.lineHeight !== undefined)
      finite(o.lineHeight, "line height", 0.1, 100);
    for (const k of ["kerning", "ligatures", "contextual"])
      if (o[k] !== undefined && typeof o[k] !== "boolean")
        throw new Error(`Invalid ${k}.`);
    if (
      o.align !== undefined &&
      !["left", "center", "right"].includes(String(o.align))
    )
      throw new Error("Invalid alignment.");
    if (
      o.direction !== undefined &&
      !["auto", "ltr", "rtl"].includes(String(o.direction))
    )
      throw new Error("Invalid direction.");
    for (const k of ["features", "language", "script"])
      if (o[k] !== undefined && typeof o[k] !== "string")
        throw new Error(`Invalid ${k}.`);
    const loaded = await loadOpenPlotFont(
      await readFile(join(resources, "public", font.url)),
    );
    paths = svgPaths(
      toSVG(layoutText(loaded, content, { ...o, capHeight } as LayoutOptions), {
        unit: "mm",
      }),
    );
    // Text begins at the artifact origin, regardless of the font's baseline.
    let x = Infinity,
      y = Infinity;
    for (const path of paths)
      for (const p of path.points) {
        x = Math.min(x, p.x);
        y = Math.min(y, p.y);
      }
    paths = paths.map((p) => ({
      ...p,
      points: p.points.map((p) => ({ x: p.x - x, y: p.y - y })),
    }));
  } else throw new Error("Source kind must be svg, paths, or text.");
  paths = checkedPaths(paths);
  const id = randomUUID(),
    name =
      typeof input.name === "string"
        ? input.name.slice(0, 100)
        : "Untitled drawing";
  await mkdir(join(directory, "artwork"), { recursive: true, mode: 0o700 });
  await atomicJson(join(directory, "artwork", `${id}.json`), {
    id,
    name,
    paths,
  } satisfies Artifact);
  return { id, name, pathCount: paths.length };
}
export async function prepareJob(
  directory: string,
  id: string,
  requestId: string,
  input: Record<string, unknown>,
  config: MachineConfig,
): Promise<JobInfo> {
  if (
    !Array.isArray(input.artwork) ||
    !input.artwork.length ||
    input.artwork.length > 100
  )
    throw new Error("Supply 1–100 artwork placements.");
  const paths: Path[] = [];
  for (const raw of input.artwork) {
    const p = object(raw),
      artifact = JSON.parse(
        await readFile(
          join(directory, "artwork", `${identity(p.id)}.json`),
          "utf8",
        ),
      ) as Artifact;
    const x = finite(p.xMm, "x position", -1000, 1000, 0),
      y = finite(p.yMm, "y position", -1000, 1000, 0),
      scale = finite(p.scale, "scale", 0.001, 1000, 1),
      angle = (finite(p.rotation, "rotation", -360, 360, 0) * Math.PI) / 180;
    for (const path of artifact.paths)
      paths.push({
        ...path,
        ...(p.pen === undefined ? {} : { tool: text(p.pen, "pen", 100) }),
        points: path.points.map((v) => ({
          x: x + scale * (v.x * Math.cos(angle) - v.y * Math.sin(angle)),
          y: y + scale * (v.x * Math.sin(angle) + v.y * Math.cos(angle)),
        })),
      });
  }
  if (paths.length > 100000) throw new Error("Job exceeds path limit.");
  for (const path of paths)
    for (const p of path.points)
      if (p.x < 0 || p.y < 0 || p.x > config.widthMm || p.y > config.heightMm)
        throw new Error(
          "Drawing exceeds the configured paper area. Adjust placement or paper size.",
        );
  const copies = finite(input.copies, "copies", 1, 100, 1);
  if (!Number.isInteger(copies))
    throw new Error("Copies must be a whole number.");
  const job = preparePaths(paths, coreOptions(settings(config)), {
    copies,
    intervalMs: 0,
    requireContinue: false,
  });
  const jobBytes = JSON.stringify(job);
  if (Buffer.byteLength(jobBytes) > MAX_BYTES)
    throw new Error("Prepared job exceeds 32 MiB.");
  await new JobStore(join(directory, "jobs")).accept({
    version: 2,
    requestId,
    prepared: job,
  });
  const svg = executionSvg(job.program, "draw"),
    svgPath = join(directory, "jobs", `${id}.svg`),
    previewPath = join(directory, "jobs", `${id}.png`);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number);
  const png = new Resvg(svg, {
    background: "#ffffff",
    fitTo: {
      mode: viewBox[3]! > viewBox[2]! ? "height" : "width",
      value: 1000,
    },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  await writeFile(svgPath, svg, { mode: 0o600 });
  await writeFile(previewPath, png, { mode: 0o600 });
  const info: JobInfo = {
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
    configDigest: fingerprint(config),
    previewPath,
    svgPath,
    durationMs: job.program.durationMs * copies,
    drawingMm: job.program.drawingMm * copies,
    travelMm: job.program.travelMm * copies,
    passes: paths.reduce<string[]>((a, p) => {
      if (a.at(-1) !== p.tool) a.push(p.tool);
      return a;
    }, []),
  };
  await atomicJson(join(directory, "jobs", `${id}.meta.json`), info);
  return info;
}
export async function simulateJob(directory: string, id: string) {
  const record = await new JobStore(join(directory, "jobs")).get(id),
    job = validatePreparedJob(record.prepared);
  const clock = new VirtualClock(),
    board = new VirtualEbb(clock, { firmware: job.target.firmware as "2.8.1" }),
    session = new PlotterSession(
      board.createTransport(),
      clock,
      job.options.profile,
    );
  const sequence = new JobSequence(session, clock);
  sequence.onStatus = (s) => {
    if (s.state === "continue") sequence.continue();
  };
  session.subscribe((event) => {
    if (event.kind === "state" && event.state === "tool-change")
      session.resume();
  });
  try {
    await session.connect();
    await session.setOrigin();
    const state = await sequence.run(
      job.segments ?? [{ id: "drawing", plan: job.program }],
      job.repeat,
    );
    return {
      status: state,
      elapsedMs: clock.now(),
      commands: board.commandCount,
    };
  } finally {
    if (session.connected) await session.disconnect();
  }
}
export async function readPrepared(
  directory: string,
  id: string,
): Promise<PreparedJob> {
  return (await new JobStore(join(directory, "jobs")).get(identity(id)))
    .prepared!;
}
