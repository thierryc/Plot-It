import type { Tool } from "@modelcontextprotocol/sdk/types.js";
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
    destructiveHint: ["start_job", "control_job"].includes(name),
    openWorldHint: false,
  },
});
export const tools: Tool[] = [
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
  "PlotIt controls a physical USB pen plotter. Read get_status, create artwork, prepare_job, poll get_job until pending, inspect its PNG preview, then start that job only when requested. Use millimetres. Local setup/arming and physical pen changes belong to the Mac companion. Never claim acceptance means motion completed. Poll job state. Never retry with a new job ID after uncertain Start; query the existing ID. Simulation never proves physical support. Machine profiles are experimental pending physical acceptance.";
