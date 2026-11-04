import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
// @ts-expect-error Build/publication helpers are plain Node modules.
import { appcast, appcastItem, nativeTag, verifyUpdate } from '../scripts/mac-update.mjs';
const bytes = Buffer.from('PlotIt update signature fixture\n');
const update = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), edSignature: 'yVeleIVRfYPX7EdeVPurn7IDVarK31QLB0M/KSnz8G2XZ175j80pjKoIh2Kwi/bxWAD0NAGylo4euJd3bLsjBQ==', url: 'https://github.com/thierryc/Plot-It/releases/download/plotit-mcp-v0.1.0-alpha.2/PlotIt-MCP-universal.zip' };
it('verifies a real Sparkle signature and rejects modified or forged bytes', () => {
  expect(() => verifyUpdate(bytes, update)).not.toThrow();
  expect(() => verifyUpdate(Buffer.from('modified'), update)).toThrow('checksum');
  expect(() => verifyUpdate(bytes, { ...update, edSignature: 'A'.repeat(86) + '==' })).toThrow('signature');
  expect(() => verifyUpdate(bytes, { ...update, sha256: '0'.repeat(64) })).toThrow('checksum');
});
it('publishes native builds with alpha channels and immutable release URLs only', () => {
  const artifact = { build: '7', version: '0.1.0', channel: 'alpha', update };
  const item = appcastItem(artifact, 'plotit-mcp-v0.1.0-alpha.2');
  expect(item).toContain('<sparkle:version>7</sparkle:version>');
  expect(item).toContain('<sparkle:channel>alpha</sparkle:channel>');
  expect(appcast([item])).toContain('xmlns:sparkle=');
  expect(() => appcastItem(artifact, 'plotit-mcp-v0.1.0')).toThrow('channel');
  expect(() => appcastItem({ ...artifact, update: { ...update, url: 'https://untrusted.example/update.zip' } }, 'plotit-mcp-v0.1.0-alpha.2')).toThrow('enclosure');
  for (const tag of ['v1.0.0', 'plotit-mcp-v0.1.0-dev.1', 'other-v0.1.0']) expect(nativeTag(tag)).toBe(false);
});
