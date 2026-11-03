import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
/** A service-wide lock prevents two startup processes from unlinking live sockets. */
export async function claimService(directory: string) {
  const path = join(directory, "service.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, "wx", 0o600);
      await file.writeFile(String(process.pid));
      await file.close();
      return async () => {
        if (
          (await readFile(path, "utf8").catch(() => "")) === String(process.pid)
        )
          await unlink(path).catch(() => undefined);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const content = await readFile(path, "utf8"),
        pid = Number(content);
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error(
          "PlotIt is starting or its service lock is invalid. Reopen the companion.",
        );
      try {
        process.kill(pid, 0);
        throw new Error("PlotIt companion is already running.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      if ((await readFile(path, "utf8")) === content) await unlink(path);
    }
  }
  throw new Error("Could not claim the PlotIt service.");
}
