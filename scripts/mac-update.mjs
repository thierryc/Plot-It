import { createPublicKey, verify, createHash } from 'node:crypto';

export const UPDATE_FEED = 'https://thierryc.github.io/Plot-It/macos/appcast.xml';
export const UPDATE_PUBLIC_KEY = 'QFrr+iH+H298YP/a6Pn0Aiy0jRKwYUBjl83FW4+b61U=';
export const SPARKLE_VERSION = '2.10.1';
export const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function nativeTag(tag) { return /^plotit-mcp-v\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(tag); }
export function verifyUpdate(bytes, update) {
  if (!Number.isSafeInteger(update.bytes) || update.bytes !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== update.sha256) throw new Error('Update archive size or checksum mismatch');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(UPDATE_PUBLIC_KEY, 'base64')]), format: 'der', type: 'spki' });
  if (!verify(null, bytes, key, Buffer.from(update.edSignature, 'base64'))) throw new Error('Invalid Sparkle Ed25519 signature');
}
export function appcastItem(artifact, tag) {
  const { update } = artifact;
  if (!nativeTag(tag) || !update || !/^\d+$/.test(artifact.build) || !/^\d+\.\d+\.\d+$/.test(artifact.version) || !['alpha', 'stable'].includes(artifact.channel)) throw new Error('Invalid update metadata');
  if ((tag.includes('-alpha.') ? 'alpha' : 'stable') !== artifact.channel || !tag.startsWith(`plotit-mcp-v${artifact.version}`)) throw new Error('Release tag does not match native version/channel');
  const url = `https://github.com/thierryc/Plot-It/releases/download/${tag}/PlotIt-MCP-universal.zip`;
  if (update.url !== url || !/^[A-Za-z0-9+/]{86}==$/.test(update.edSignature) || !Number.isSafeInteger(update.bytes) || update.bytes <= 0) throw new Error('Invalid update enclosure');
  return `<item><title>PlotIt MCP ${xml(artifact.version)} · build ${xml(artifact.build)}</title><link>https://github.com/thierryc/Plot-It/releases/tag/${xml(tag)}</link><sparkle:version>${xml(artifact.build)}</sparkle:version><sparkle:shortVersionString>${xml(artifact.version)}</sparkle:shortVersionString>${artifact.channel === 'alpha' ? '<sparkle:channel>alpha</sparkle:channel>' : ''}<sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion><enclosure url="${xml(url)}" length="${update.bytes}" type="application/octet-stream" sparkle:edSignature="${xml(update.edSignature)}" /></item>`;
}
export function appcast(items) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>PlotIt MCP updates</title><link>https://thierryc.github.io/Plot-It/macos/</link><description>Signed universal macOS releases</description><language>en</language>\n${items.join('\n')}\n</channel></rss>\n`;
}
