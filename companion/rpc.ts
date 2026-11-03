import { request, createServer, type Server } from "node:http";
import { join } from "node:path";
import { connect } from "node:net";
import { chmod, unlink } from "node:fs/promises";
import { MAX_BYTES, object, privateDirectory } from "./common";

export async function rpc(
  socketPath: string,
  action: string,
  params: unknown = {},
  timeout = 15000,
): Promise<any> {
  const body = JSON.stringify({ action, params });
  if (Buffer.byteLength(body) > MAX_BYTES)
    throw new Error("Request exceeds 32 MiB.");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            req.destroy(new Error("Response exceeds limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString());
            res.statusCode === 200
              ? resolve(result)
              : reject(new Error(result.error ?? "Companion request failed."));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(timeout, () =>
      req.destroy(
        new Error(
          "Companion request timed out; check job state before retrying.",
        ),
      ),
    );
    req.on("error", reject);
    req.end(body);
  });
}
export async function listenRpc(
  directory: string,
  name: string,
  handler: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
): Promise<Server> {
  await privateDirectory(directory);
  const path = join(directory, name);
  const live = await new Promise<boolean>((resolve) => {
    const s = connect(path);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
  if (live) throw new Error("PlotIt companion is already running.");
  await unlink(path).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "POST" || req.url !== "/") {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          res.writeHead(413);
          res.end(JSON.stringify({ error: "Request exceeds 32 MiB." }));
          return;
        }
        chunks.push(chunk);
      }
      const { action, params } = object(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      if (typeof action !== "string") throw new Error("Missing action.");
      const result = await handler(action, object(params ?? {}));
      const body = JSON.stringify(result ?? {});
      if (Buffer.byteLength(body) > MAX_BYTES)
        throw new Error("Response exceeds limit.");
      res.end(body);
    })().catch((e) => {
      if (!res.headersSent) res.writeHead(400);
      res.end(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      );
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxConnections = 24;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
  return server;
}
