import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { capture, hashFile, run } from "./mac-bundle.mjs";

const manifest = JSON.parse(await readFile("output/PlotIt-MCP-release-manifest.json", "utf8"));
assert.equal(manifest.distributionStatus, "signed-and-notarized");
const artifact = manifest.artifacts.find(item => item.architecture === "universal");
assert(artifact && !artifact.sourceDirty, "A clean universal release is required");
for (const file of artifact.files) {
  assert.match(file.name, /^[A-Za-z0-9._-]+$/);
  assert.equal(await hashFile(join("output", file.name)), file.sha256);
}
const dmg = resolve("output", artifact.files.find(file => file.name.endsWith(".dmg")).name);
const zip = resolve("output", artifact.files.find(file => file.name.endsWith(".zip")).name);
const temporary = await mkdtemp("/tmp/plotit-release-containers-");
const mount = join(temporary, "volume");
await mkdir(mount);

async function verify(app) {
  run("codesign", ["--verify", "--deep", "--strict", app]);
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose", app]);
  assert.equal(capture("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleVersion", join(app, "Contents/Info.plist")]), manifest.build);
  const info = JSON.parse(await readFile(join(app, "Contents/Resources/BUILD-INFO.json"), "utf8"));
  assert.equal(info.sourceCommit, artifact.sourceCommit);
  assert.equal(info.sourceDirty, false);
  assert.equal(await hashFile(join(app, "Contents/Resources/plot-it-source.tar.gz")), artifact.sourceArchiveSha256);
}

run("hdiutil", ["verify", dmg]);
run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose", dmg]);
let attached = false;
try {
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  attached = true;
  assert.equal(await readlink(join(mount, "Applications")), "/Applications");
  await verify(join(mount, "PlotIt MCP.app"));
} finally {
  // If detach fails, keep the temporary directory rather than deleting a mounted volume.
  if (attached) run("hdiutil", ["detach", mount]);
}
const extracted = join(temporary, "zip");
await mkdir(extracted);
run("ditto", ["-x", "-k", zip, extracted]);
await verify(join(extracted, "PlotIt MCP.app"));
const appNotarization = JSON.parse(await readFile("output/plotit-mcp-universal/notarization-app.json", "utf8"));
const dmgNotarization = JSON.parse(await readFile("output/plotit-mcp-universal/notarization-dmg.json", "utf8"));
assert.equal(appNotarization.status, "Accepted");
assert.equal(dmgNotarization.status, "Accepted");
await writeFile("output/plotit-release-container-validation.json", JSON.stringify({
  version: manifest.version, build: manifest.build, architecture: "universal", sourceCommit: artifact.sourceCommit,
  dmgChecksum: true, dmgGatekeeper: true, mountedAppSignature: true, mountedAppStapledTicket: true,
  mountedAppGatekeeper: true, installationSymlink: true, extractedZipSignature: true,
  extractedZipStapledTicket: true, extractedZipGatekeeper: true, sourceArchiveVerified: true,
  appNotarization, dmgNotarization,
}, null, 2) + "\n");
await rm(temporary, { recursive: true, force: true });
console.info("DMG and extracted ZIP passed signatures, stapled tickets, Gatekeeper and source provenance checks.");
