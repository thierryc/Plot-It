import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createArtwork, prepareJob, simulateJob } from "./artwork";
import { defaultMachine } from "./common";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function directory() {
  const d = await mkdtemp("/tmp/pi-art-");
  dirs.push(d);
  return d;
}
describe("headless artwork pipeline", () => {
  it("lays out multiline text, composes it with SVG, compiles previews and simulates without USB", async () => {
    const d = await directory();
    const label = await createArtwork(d, resolve("."), {
      source: {
        kind: "text",
        fontId: "hershey-futural",
        text: "Hello\nPlotIt",
        capHeightMm: 4,
        layout: { align: "center", letterSpacing: 0.1 },
      },
    });
    const svg = await createArtwork(d, resolve("."), {
      source: {
        kind: "svg",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><path d="M1 1L10 1L10 10" fill="none" stroke="black"/></svg>',
      },
    });
    const requestId = "test-request",
      id = createHash("sha256").update(requestId).digest("hex");
    const info = await prepareJob(
      d,
      id,
      requestId,
      {
        artwork: [
          { id: label.id, xMm: 10, yMm: 10 },
          { id: svg.id, xMm: 10, yMm: 40 },
        ],
      },
      defaultMachine,
    );
    expect(info.drawingMm).toBeGreaterThan(10);
    expect(
      (await readFile(info.previewPath!)).subarray(0, 8).toString("hex"),
    ).toBe("89504e470d0a1a0a");
    const simulation = await simulateJob(d, id);
    expect(simulation.status).toBe("finished");
    expect(simulation.commands).toBeGreaterThan(0);
    expect(
      JSON.parse(await readFile(join(d, "jobs", `${id}.json`), "utf8"))
        .startRequestId,
    ).toBeUndefined();
  });
  it("rejects remote SVG references, entities, unsupported content and out-of-paper geometry", async () => {
    const d = await directory();
    for (const svg of [
      '<!DOCTYPE svg [<!ENTITY test SYSTEM "file:///etc/passwd">]><svg/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/image.png"/></svg>',
    ])
      await expect(
        createArtwork(d, resolve("."), { source: { kind: "svg", svg } }),
      ).rejects.toThrow();
    const artwork = await createArtwork(d, resolve("."), {
      source: {
        kind: "paths",
        paths: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      },
    });
    await expect(
      prepareJob(
        d,
        "not-written",
        "bounds-request",
        { artwork: [{ id: artwork.id, xMm: 500 }] },
        defaultMachine,
      ),
    ).rejects.toThrow("paper area");
    await expect(
      createArtwork(d, resolve("."), {
        source: { kind: "text", fontId: "../../etc/passwd", text: "Hi" },
      }),
    ).rejects.toThrow("font ID");
  });
});
