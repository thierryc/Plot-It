import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { capture, hashFile } from "./mac-bundle.mjs";

const completeManifest = JSON.parse(await readFile("output/PlotIt-MCP-release-manifest.json", "utf8"));
const args = process.argv.slice(2);
const architecture = args.includes("--arch") ? args[args.indexOf("--arch") + 1] : null;
if (args.includes("--arch") && !["arm64", "x64", "universal"].includes(architecture)) throw new Error("Use --arch arm64, x64, or universal.");
const manifest = { ...completeManifest, artifacts: completeManifest.artifacts.filter(artifact => !architecture || artifact.architecture === architecture) };
if (!manifest.artifacts.length) throw new Error("No packaged artifacts match the requested architecture.");
const destination = resolve(`output/plotit-mcp-release${architecture ? "-" + architecture : ""}`);
const files = manifest.artifacts.flatMap(artifact => artifact.files);
for (const file of files) {
  if (!/^[A-Za-z0-9._-]+$/.test(file.name)) throw new Error("Unexpected release filename.");
  if (await hashFile(join("output", file.name)) !== file.sha256) throw new Error(`Artifact changed since packaging: ${file.name}`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
if (manifest.artifacts.some(artifact => artifact.update)) {
  await cp("output/appcast-item.xml", join(destination, "appcast-item.xml"));
  const artifact = manifest.artifacts.find(artifact => artifact.update);
  await cp(join("output", artifact.app, "Contents/Resources/SPARKLE-LICENSE"), join(destination, "SPARKLE-LICENSE"));
}
for (const file of files) await cp(join("output", file.name), join(destination, file.name));
const sourceName = `PlotIt-MCP-source-v${manifest.version}.tar.gz`;
const outputRoot = resolve("output");
const bundledSource = artifact => {
  const app = resolve(outputRoot, artifact.app);
  if (!app.startsWith(outputRoot + "/") || !app.endsWith(".app")) throw new Error("Unexpected application path in release manifest.");
  return join(app, "Contents/Resources/plot-it-source.tar.gz");
};
const sourceHash = await hashFile(bundledSource(manifest.artifacts[0]));
for (const artifact of manifest.artifacts) {
  if (await hashFile(bundledSource(artifact)) !== sourceHash || (artifact.sourceArchiveSha256 && artifact.sourceArchiveSha256 !== sourceHash)) throw new Error("Packaged source archives do not match release provenance.");
}
await cp(bundledSource(manifest.artifacts[0]), join(destination, sourceName));
await writeFile(join(destination, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const [from, to] of [["docs/MAC_RELEASE.md", "RELEASE-CHECKLIST.md"], ["docs/PLOTIT_MCP.md", "INSTALL-AND-USAGE.md"], ["docs/PLOTIT_MCP_PRIVACY.md", "PRIVACY.md"], [`docs/releases/plotit-mcp-${manifest.version}.md`, "RELEASE-NOTES.md"], ["LICENSE", "LICENSE"], ["NOTICE", "NOTICE"], ["THIRD_PARTY_NOTICES.md", "THIRD-PARTY-NOTICES.md"]]) {
  if (from.endsWith(".md")) {
    const content = (await readFile(from, "utf8")).replaceAll("(MAC_RELEASE.md)", "(RELEASE-CHECKLIST.md)").replaceAll("(PLOTIT_MCP_PRIVACY.md)", "(PRIVACY.md)").replaceAll("(../PLOTIT_MCP.md)", "(INSTALL-AND-USAGE.md)");
    await writeFile(join(destination, to), content);
  } else await cp(from, join(destination, to));
}
let developerIdAvailable = false;
try { developerIdAvailable = capture("security", ["find-identity", "-v", "-p", "codesigning"]).includes("Developer ID Application:"); } catch { /* No local signing keychain. */ }
const blockers = [];
if (manifest.artifacts.some(artifact => !artifact.finalIcon)) blockers.push("Supply the final app icon and rebuild.");
if (manifest.distributionStatus !== "signed-and-notarized") blockers.push("Create Developer ID-signed and notarized release artifacts; these are development candidates.");
if (!developerIdAvailable && manifest.distributionStatus !== "signed-and-notarized") blockers.push("Install a Developer ID Application certificate and its private key in the signing keychain.");
if (!process.env.PLOTIT_NOTARY_PROFILE && manifest.distributionStatus !== "signed-and-notarized") blockers.push("Select the notarization keychain profile through PLOTIT_NOTARY_PROFILE.");
if (manifest.artifacts.some(artifact => artifact.sourceDirty)) blockers.push("Commit reviewed source and rebuild to record a clean source commit.");
const report = { version: manifest.version, build: manifest.build, distributionStatus: manifest.distributionStatus, checksumsVerified: true, developerIdAvailable, blockers, manualAcceptance: ["Clean Apple Silicon and Intel installation/update/Gatekeeper checks", "Actual agent clients and card-capability checks", "Physical testing for each advertised machine/profile"], publicationPerformed: false };
await writeFile(join(destination, "READINESS.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(destination, "README.md"), `# PlotIt MCP ${manifest.version} · build ${manifest.build}\n\nDistribution: **${manifest.distributionStatus}**. No release was published.\n\nThis folder contains the app DMGs/ZIPs, corresponding source, checksums, installation guide, privacy statement, release notes and release checklist. Read READINESS.json before distribution. Development files are not notarized public releases.\n\nRemaining gates:\n${blockers.map(value => `- ${value}`).join("\n")}\n\nRun shasum -a 256 -c SHA256SUMS.txt in this folder to verify the artifacts.\n`);
for (const artifact of manifest.artifacts) if (artifact.notarized) {
  for (const kind of ["app", "dmg"]) {
    const path = join(outputRoot, `plotit-mcp-${artifact.architecture}`, `notarization-${kind}.json`);
    if (JSON.parse(await readFile(path, "utf8")).status !== "Accepted") throw new Error("Release notarization receipt is not Accepted.");
    await cp(path, join(destination, `NOTARIZATION-${artifact.architecture}-${kind}.json`));
  }
}
if (manifest.distributionStatus === "signed-and-notarized" && manifest.artifacts.some(item => item.architecture === "universal")) {
  const path = join(outputRoot, "plotit-release-container-validation.json");
  const validation = JSON.parse(await readFile(path, "utf8"));
  const universal = manifest.artifacts.find(item => item.architecture === "universal");
  if (validation.build !== manifest.build || validation.sourceCommit !== universal.sourceCommit || !validation.sourceArchiveVerified) throw new Error("Verify the current release containers before preparing public materials.");
  await cp(path, join(destination, "CONTAINER-VALIDATION.json"));
}
// Seal the complete review kit, including receipts and documentation.
const checksums = [];
for (const entry of (await readdir(destination, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.isFile() && entry.name !== "SHA256SUMS.txt") checksums.push(`${await hashFile(join(destination, entry.name))}  ${entry.name}`);
}
await writeFile(join(destination, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.info(`Prepared release materials: ${destination}\n${blockers.length} remaining release gates. No publication performed.`);
