import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { locations, VERSION, object } from "./common";
import { rpc } from "./rpc";
import { tools, instructions } from "./tools";

const socket = join(locations().socketDirectory, "mcp.sock"),
  id = randomUUID();
const server = new Server(
  { name: "plotit", version: VERSION },
  { capabilities: { tools: {}, resources: {} }, instructions },
);
const call = (action: string, params: unknown = {}) =>
  rpc(socket, action, params, action === "create_artwork" ? 125000 : 15000);
let timer: ReturnType<typeof setInterval> | undefined;
server.oninitialized = () => {
  const name = server.getClientVersion()?.name ?? "MCP client";
  const ping = () => {
    void call("agent_ping", { id, name }).catch(() => undefined);
  };
  ping();
  timer = setInterval(ping, 5000);
  timer.unref();
};
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const result = await call("read_resource", { uri: request.params.uri });
  return {
    contents: [
      { uri: request.params.uri, mimeType: result.mimeType, blob: result.data },
    ],
  };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const definition = tools.find((t) => t.name === request.params.name);
    if (!definition) throw new Error("Unknown PlotIt tool.");
    const args = object(request.params.arguments ?? {}),
      allowed = Object.keys(definition.inputSchema.properties ?? {});
    if (Object.keys(args).some((k) => !allowed.includes(k)))
      throw new Error("Unexpected tool argument.");
    const result = await call(definition.name, args);
    const content: CallToolResult["content"] = [
      { type: "text", text: JSON.stringify(result) },
    ];
    if (
      definition.name === "get_job" &&
      args.includePreview === true &&
      result.previewUri
    ) {
      const preview = await call("read_resource", { uri: result.previewUri });
      content.push({
        type: "image",
        data: preview.data,
        mimeType: preview.mimeType,
      });
    }
    return { content, structuredContent: result };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
});
let shuttingDown = false;
const close = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  void call("agent_disconnect", { id })
    .catch(() => undefined)
    .finally(() => server.close())
    .finally(() => process.exit(0));
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.stdin.on("end", close);
await server.connect(new StdioServerTransport());
