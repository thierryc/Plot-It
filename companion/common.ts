import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, lstat, chmod } from "node:fs/promises";
import type { PlotSettings } from "../src/model";
import { initialState } from "../src/model";
import { coreOptions } from "../src/core-settings";
import { validateSettings } from "../src/network-protocol";
import nativeRelease from "../macos/release.json";

export const VERSION = process.env.PLOTIT_MAC_VERSION ?? nativeRelease.version;
export const MAX_BYTES = 32 * 1024 * 1024;
export const PROFILES = [
  "axidraw",
  "axidraw-a3",
  "xylodraw",
  "nextdraw-8511",
  "nextdraw-1117",
  "nextdraw-2234",
] as const;
export interface MachineConfig {
  profile: (typeof PROFILES)[number];
  rotation: 0 | 90 | 180 | 270;
  servo: "standard" | "brushless";
  penUp: number;
  penDown: number;
  speed: number;
  travelSpeed: number;
  widthMm: number;
  heightMm: number;
  firmware: string;
  device: string;
}
export const defaultMachine: MachineConfig = {
  profile: "axidraw",
  rotation: 90,
  servo: "standard",
  penUp: 50,
  penDown: 60,
  speed: 35,
  travelSpeed: 60,
  widthMm: 210,
  heightMm: 297,
  firmware: "2.8.1",
  device: "",
};
export function locations() {
  return {
    directory:
      process.env.PLOTIT_DATA_DIR ??
      join(homedir(), "Library", "Application Support", "PlotIt MCP"),
    socketDirectory:
      process.env.PLOTIT_SOCKET_DIR ??
      `/tmp/plotit-mcp-${process.getuid?.() ?? "user"}`,
    resources: process.env.PLOTIT_RESOURCES ?? process.cwd(),
  };
}
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (process.getuid && s.uid !== process.getuid())
  )
    throw new Error(
      "PlotIt directory must be owned by the current user and cannot be a symbolic link.",
    );
  await chmod(path, 0o700);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 10000): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new Error(`Invalid ${name}.`);
  return value;
}
export function finite(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Invalid ${name}.`);
  return value;
}
export function identity(value: unknown): string {
  const id = text(value, "identity", 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid identity.");
  return id;
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function machine(value: unknown): MachineConfig {
  const v = object(value);
  if (!PROFILES.includes(v.profile as MachineConfig["profile"]))
    throw new Error("Select a supported machine profile.");
  if (
    ![0, 90, 180, 270].includes(v.rotation as number) ||
    !["standard", "brushless"].includes(v.servo as string)
  )
    throw new Error("Invalid machine orientation or servo.");
  const c: MachineConfig = {
    profile: v.profile as MachineConfig["profile"],
    rotation: v.rotation as MachineConfig["rotation"],
    servo: v.servo as MachineConfig["servo"],
    penUp: finite(v.penUp, "pen up", 0, 100),
    penDown: finite(v.penDown, "pen down", 0, 100),
    speed: finite(v.speed, "drawing speed", 1, 100),
    travelSpeed: finite(v.travelSpeed, "travel speed", 1, 150),
    widthMm: finite(v.widthMm, "paper width", 1, 1000),
    heightMm: finite(v.heightMm, "paper height", 1, 1000),
    firmware: text(v.firmware, "firmware", 30),
    device: typeof v.device === "string" ? v.device : "",
  };
  if (!/^\d+\.\d+\.\d+$/.test(c.firmware))
    throw new Error("Firmware must be a version such as 2.8.1.");
  if (c.device && !/^\/dev\/(cu\.|tty|serial\/)[\w./-]+$/.test(c.device))
    throw new Error("Select a local serial device.");
  settings(c);
  return c;
}
export function settings(c: MachineConfig): PlotSettings {
  const s: PlotSettings = {
    ...initialState.settings,
    profile: c.profile.startsWith("nextdraw")
      ? "nextdraw"
      : c.profile.startsWith("axidraw")
        ? "axidraw"
        : "xylodraw",
    axidrawHardwareModel: c.profile === "axidraw-a3" ? "v3-a3" : "v3-a4",
    nextdrawModel: c.profile.split("-")[1] as PlotSettings["nextdrawModel"],
    nextdrawServo: c.servo,
    machineRotation: c.rotation,
    penUp: c.penUp,
    penDown: c.penDown,
    speed: c.speed,
    travelSpeed: c.travelSpeed,
    motionFirmware: c.firmware,
    motionPreference: "compatibility",
    motionStrategy: "standard",
    workloadMode: "continuous",
    handling: "custom",
    copies: 1,
    repeatIntervalMs: 0,
    repeatRequireContinue: false,
    pauseOnToolChange: true,
    returnToOrigin: true,
  };
  validateSettings(s);
  coreOptions(s);
  return s;
}
