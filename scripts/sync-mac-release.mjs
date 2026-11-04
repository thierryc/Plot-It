// Public release ingestion uses only public-key verification. No signing secret is needed in CI.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appcast, appcastItem, nativeTag, verifyUpdate, UPDATE_FEED, UPDATE_PUBLIC_KEY } from './mac-update.mjs';

const repository = 'thierryc/Plot-It';
const token = process.env.GH_TOKEN;
async function get(url, json = false) {
  const response = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { Accept: 'application/vnd.github+json' } : {}) } });
  if (!response.ok) throw new Error(`Release download failed (${response.status}): ${url}`);
  return json ? response.json() : Buffer.from(await response.arrayBuffer());
}
const releases = [];
for (let page = 1; ; page++) {
  const batch = await get(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, true);
  releases.push(...batch);
  if (batch.length < 100) break;
}
const verified = [], builds = new Set();
for (const release of releases.filter(release => !release.draft && release.published_at && nativeTag(release.tag_name))) {
  const asset = name => release.assets.find(asset => asset.name === name);
  if (!asset('release-manifest.json')) continue; // Earlier manual releases have no updater.
  const manifest = JSON.parse((await get(asset('release-manifest.json').browser_download_url)).toString());
  if (!/^\d+$/.test(manifest.build)) throw new Error('Invalid native build');
  if (Number(manifest.build) < 7) continue;
  const artifact = manifest.artifacts.find(artifact => artifact.architecture === 'universal');
  if (manifest.distributionStatus !== 'signed-and-notarized' || !artifact?.notarized || artifact.sourceDirty || artifact.build !== manifest.build || !artifact.update || !asset('appcast-item.xml')) throw new Error(`Incomplete signed update: ${release.tag_name}`);
  const item = appcastItem(artifact, release.tag_name);
  const suppliedItem = (await get(asset('appcast-item.xml').browser_download_url)).toString().trim();
  if (suppliedItem !== item || !asset(artifact.update.name) || artifact.update.name !== 'PlotIt-MCP-universal.zip') throw new Error('Release enclosure mismatch');
  const bytes = await get(asset(artifact.update.name).browser_download_url);
  verifyUpdate(bytes, artifact.update);
  const directory = await mkdtemp(join(tmpdir(), 'plotit-feed-'));
  try {
    const archive = join(directory, 'update.zip'); await writeFile(archive, bytes);
    const entry = path => execFileSync('unzip', ['-p', archive, `PlotIt MCP.app/Contents/${path}`], { maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    const info = JSON.parse(entry('Resources/BUILD-INFO.json'));
    for (const key of ['build', 'version', 'channel', 'sourceCommit', 'sourceArchiveSha256']) if (info[key] !== artifact[key]) throw new Error(`Archive/manifest mismatch: ${key}`);
    if (info.architecture !== 'universal' || info.sourceDirty || info.signingMode !== 'developer-id') throw new Error('Invalid release provenance');
    const plist = entry('Info.plist');
    // Read the signed archive's plist rather than trusting release metadata.
    const value = key => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1];
    if (value('CFBundleVersion') !== info.build || value('CFBundleShortVersionString') !== info.version || value('CFBundleIdentifier') !== 'cx.ap.plotit.mcp' || value('SUPublicEDKey') !== UPDATE_PUBLIC_KEY || value('SUFeedURL') !== UPDATE_FEED) throw new Error('Signed app update settings mismatch');
  } finally { await rm(directory, { recursive: true, force: true }); }
  if (builds.has(artifact.build)) throw new Error('Duplicate native build numbers');
  builds.add(artifact.build);
  if (!asset('PlotIt-MCP-universal.dmg') || !asset('SHA256SUMS.txt')) throw new Error('Incomplete website downloads');
  const dmg = artifact.files.find(file => file.name === 'PlotIt-MCP-universal.dmg');
  const dmgBytes = await get(asset('PlotIt-MCP-universal.dmg').browser_download_url);
  const sums = (await get(asset('SHA256SUMS.txt').browser_download_url)).toString();
  if (!dmg || dmgBytes.length !== dmg.bytes || createHash('sha256').update(dmgBytes).digest('hex') !== dmg.sha256 || !sums.split('\n').includes(`${dmg.sha256}  ${dmg.name}`) || !sums.split('\n').includes(`${artifact.update.sha256}  ${artifact.update.name}`)) throw new Error('Release download checksum mismatch');
  verified.push({ artifact, item, release });
}
verified.sort((a, b) => Number(b.artifact.build) - Number(a.artifact.build));
// All validation completes before either tracked publication file is changed.
await writeFile('public/macos/appcast.xml', appcast(verified.map(value => value.item)));
if (verified.length) {
  const { artifact, release } = verified[0];
  const base = `https://github.com/${repository}/releases/download/${release.tag_name}`;
  await writeFile('site/macos/release.json', JSON.stringify({ available: true, version: artifact.version, build: artifact.build, channel: artifact.channel, appleSiliconUrl: '', universalUrl: `${base}/PlotIt-MCP-universal.dmg`, checksumsUrl: `${base}/SHA256SUMS.txt`, releaseNotesUrl: release.html_url }, null, 2) + '\n');
} else if (JSON.parse(await readFile('site/macos/release.json', 'utf8')).build) {
  // A withdrawn updater-enabled release must no longer be offered on the site.
  await writeFile('site/macos/release.json', JSON.stringify({ available: false, version: '', channel: 'alpha', appleSiliconUrl: '', universalUrl: '', checksumsUrl: '', releaseNotesUrl: `https://github.com/${repository}/releases` }, null, 2) + '\n');
}
console.info(`Verified ${verified.length} signed universal updates.`);
