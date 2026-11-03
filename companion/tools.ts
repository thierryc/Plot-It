import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { PROGRESS_URI } from "./progress";
import { SETUP_URI } from "./setup";
const id = {
  type: "string",
  description: "Artifact or job identity returned by PlotIt.",
};
const schema = (
  properties: Record<string, object>,
  required: string[] = [],
) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const tool = (
  name: string,
  description: string,
  inputSchema: Tool["inputSchema"],
  readOnlyHint = false,
  idempotentHint = false,
): Tool => ({
  name,
  description,
  inputSchema,
  annotations: {
    readOnlyHint,
    idempotentHint,
    destructiveHint: ["start_job", "control_job", "configure_plotter", "connect_plotter", "disconnect_plotter", "test_pen", "set_plotter_origin"].includes(name),
    openWorldHint: false,
  },
});
export const tools: Tool[] = [
  tool("get_setup", "Read plotter settings, supported machines, paper presets, detected USB devices and readiness. Does not connect or move hardware.", schema({}), true, true),
  { ...tool("show_plotter_setup", "Open the interactive plotter setup card in this conversation. Read settings, choose paper, connect USB, test the pen and set the current drawing origin. Opening the card never changes settings or moves hardware.", schema({}), true, true), _meta: { ui: { resourceUri: SETUP_URI } } },
  tool("configure_plotter", "Save selected machine settings on this Mac. Read get_setup first. Only supplied settings change; changing settings disconnects connected hardware and requires re-establishing origin. No drawing starts.", schema({
    settings: schema({
      profile: { enum: ["axidraw", "axidraw-a3", "xylodraw", "nextdraw-8511", "nextdraw-1117", "nextdraw-2234"] },
      rotation: { enum: [0, 90, 180, 270] }, servo: { enum: ["standard", "brushless"] },
      penUp: { type: "number", minimum: 0, maximum: 100 }, penDown: { type: "number", minimum: 0, maximum: 100 },
      speed: { type: "number", minimum: 1, maximum: 100 }, travelSpeed: { type: "number", minimum: 1, maximum: 150 },
      widthMm: { type: "number", minimum: 1, maximum: 1000 }, heightMm: { type: "number", minimum: 1, maximum: 1000 },
      firmware: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" }, device: { type: "string" },
    }),
    expectedConfigDigest: { type: "string", description: "configDigest from get_setup; prevents overwriting settings changed elsewhere." },
  }, ["settings"]), false, true),
  tool("connect_plotter", "Connect the selected local USB plotter using saved settings. Requires PlotIt MCP open and no active drawing. Does not start a drawing.", schema({}), false, true),
  tool("disconnect_plotter", "Disconnect the local plotter once all motion has settled. Does not cancel an active drawing; use control_job Stop and wait first.", schema({}), false, true),
  tool("test_pen", "Move the physical pen servo to its saved Up or Down height, only when requested. Requires a connected idle plotter and the native companion open. Does not move the carriage or start a drawing.", schema({ down: { type: "boolean" } }, ["down"])),
  tool("set_plotter_origin", "Capture the carriage’s current physical position as the drawing origin. Call only after the user confirms that the carriage is correctly positioned and the paper is secured. This does not home or move the carriage.", schema({ currentPositionConfirmed: { type: "boolean", const: true } }, ["currentPositionConfirmed"])),
  tool(
    "get_status",
    "Read the selected machine, firmware, paper, origin readiness, session control state and active drawing. Does not connect USB or move hardware.",
    schema({}),
    true,
    true,
  ),
  tool(
    "list_fonts",
    "List bundled OpenPlotFont stroke fonts. Use a returned font ID when creating text artwork.",
    schema({}),
    true,
    true,
  ),
  tool(
    "create_artwork",
    "Import SVG, normalized millimetre paths, or lay out stroke-font text as an immutable artifact. Does not move hardware. SVG text must be outlined; use kind:text for lettering.",
    schema(
      {
        name: { type: "string", maxLength: 100 },
        source: {
          type: "object",
          properties: {
            kind: { enum: ["svg", "paths", "text"] },
            svg: { type: "string" },
            path: {
              type: "string",
              description:
                "Explicit absolute local .svg path; mutually exclusive with svg.",
            },
            paths: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tool: { type: "string" },
                  points: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                      required: ["x", "y"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["points"],
                additionalProperties: false,
              },
            },
            text: { type: "string", maxLength: 10000 },
            fontId: { type: "string" },
            capHeightMm: { type: "number", minimum: 0.1, maximum: 200 },
            layout: {
              type: "object",
              properties: {
                letterSpacing: { type: "number" },
                wordSpacing: { type: "number" },
                lineHeight: { type: "number" },
                align: { enum: ["left", "center", "right"] },
                kerning: { type: "boolean" },
                ligatures: { type: "boolean" },
                contextual: { type: "boolean" },
                features: { type: "string" },
                direction: { enum: ["auto", "ltr", "rtl"] },
                language: { type: "string" },
                script: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      },
      ["source"],
    ),
  ),
  tool(
    "prepare_job",
    "Compile an immutable job using the saved machine settings. Returns a preparing job ID immediately; poll get_job until pending, inspect its preview before start_job. No motion.",
    schema(
      {
        artwork: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              id,
              xMm: { type: "number" },
              yMm: { type: "number" },
              scale: { type: "number", minimum: 0.001, maximum: 1000 },
              rotation: { type: "number", minimum: -360, maximum: 360 },
              pen: { type: "string" },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        copies: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["artwork"],
    ),
  ),
  tool(
    "simulate_job",
    "Start background virtual execution of a prepared job. Poll get_job for its simulation result. Never opens USB.",
    schema({ id }, ["id"]),
  ),
  tool(
    "start_job",
    "Start this exact prepared drawing on the physical plotter. Requires locally enabled agent control, connected matching hardware and established origin. Repeating the same job ID never draws twice.",
    schema({ id }, ["id"]),
    false,
    true,
  ),
  tool(
    "get_job",
    "Read prepared/physical job state, estimates, progress, simulation result and preview resources. Set includePreview to receive a PNG image for visual inspection.",
    schema({ id, includePreview: { type: "boolean" } }, ["id"]),
    true,
    true,
  ),
  {
    ...tool(
      "show_plot_progress",
      "Open one live drawing card with a preview, estimated progress, elapsed time and plotter state. Call once after start_job (or to inspect a prepared job). The card refreshes itself without conversation messages. In clients without cards, use get_job sparingly and report only meaningful milestones, attention requests and the final outcome.",
      schema({ id }, ["id"]),
      true,
      true,
    ),
    _meta: { ui: { resourceUri: PROGRESS_URI } },
  },
  tool(
    "control_job",
    "Pause, resume or stop the specified active drawing. A physical pen-change gate requires local Continue in the companion. Stop is a controlled stop; acceptance does not mean motion has settled.",
    schema({ id, action: { enum: ["pause", "resume", "stop"] } }, [
      "id",
      "action",
    ]),
  ),
];
export const instructions =
  "PlotIt controls a physical USB pen plotter. For setup, use get_setup or show_plotter_setup, then configure_plotter and connect_plotter when requested. Test the physical pen only when requested. Capture origin with set_plotter_origin only after the user confirms its current physical position; never infer physical placement from a preview. Setup tools require the native Mac companion open and an idle plotter. Use the latest configDigest when saving. Agent control is allowed automatically when ready unless the user turns it off; setup tools never change that preference. For drawing, read get_status, create artwork, prepare_job, poll get_job until pending, inspect its PNG preview, then start that job only when requested. Use millimetres. Physical pen changes require local Continue. After start_job, call show_plot_progress once to open its live card. Let the card refresh quietly; do not narrate routine polling or produce a message for every percentage. In clients without UI, poll get_job at a measured interval (at least five seconds) and report only meaningful milestones, attention requests and final outcome. Never claim acceptance, elapsed time, or queued-command percentage means motion completed: only finished confirms completion. Never retry with a new job ID after uncertain Start; query the existing ID. Simulation never proves physical support. Machine profiles are experimental pending physical acceptance.";
