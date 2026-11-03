import { parentPort, workerData } from "node:worker_threads";
import { createArtwork, prepareJob, simulateJob } from "./artwork";
const { action, directory, resources, id, requestId, input, config } =
  workerData;
try {
  const value =
    action === "create"
      ? await createArtwork(directory, resources, input)
      : action === "prepare"
        ? await prepareJob(directory, id, requestId, input, config)
        : await simulateJob(directory, id);
  parentPort!.postMessage({ ok: true, value });
} catch (error) {
  parentPort!.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
