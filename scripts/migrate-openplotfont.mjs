import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadOpenPlotFont } from '@thierryc/openplotfont';
import { parseUniqueJson } from '../packages/openplotfont/dist/reader.js';

// Explicit, offline conversion only. The application has no legacy aliases.
const oldName = 'PlotFont', oldKey = 'plotfont', oldNamespace = 'org.plotfont';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function metadata(value) {
  if (Array.isArray(value)) return value.map(metadata);
  if (!value || typeof value !== 'object') return value;
  const result = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    const target = key === oldNamespace || key.startsWith(oldNamespace + '.')
      ? key.replace(oldNamespace, 'org.openplotfont') : key;
    if (Object.hasOwn(result, target) || (target !== key && Object.hasOwn(value, target)))
      throw new Error(`Conflicting metadata key: ${target}`);
    result[target] = metadata(child);
  }
  return result;
}
async function font(source) {
  const data = parseUniqueJson(source);
  if (data.format !== oldName && data.format !== 'OpenPlotFont') throw new Error('Expected a font JSON object.');
  data.format = 'OpenPlotFont';
  const migrated = metadata(data);
  // Update only project-owned identity, retaining third-party font names and geometry.
  if (migrated.id?.startsWith(oldNamespace + '.')) migrated.id = migrated.id.replace(oldNamespace, 'org.openplotfont');
  if (migrated.familyName?.startsWith(oldName)) migrated.familyName = migrated.familyName.replace(oldName, 'OpenPlotFont');
  const bytes = Buffer.from(JSON.stringify(migrated, null, 2) + '\n');
  await loadOpenPlotFont(bytes);
  return bytes;
}
export async function migrateOpenPlotFont(source) {
  const data = parseUniqueJson(source);
  if (data.format !== 'plot-it') return font(source);
  if (data.version !== 1 || !Array.isArray(data.fonts) || !Array.isArray(data.document?.items))
    throw new Error('Unsupported Plot-it document.');
  const ids = new Map([[oldKey + '-layout-demo', 'openplotfont-layout-demo']]);
  for (const entry of data.fonts) {
    if (entry.format !== oldKey) continue;
    if (entry.encoding !== 'base64') throw new Error('Unsupported embedded font encoding.');
    const original = Buffer.from(entry.data, 'base64');
    if (original.toString('base64') !== entry.data || entry.id !== oldKey + '-' + hash(original))
      throw new Error('Embedded font encoding or identity does not match.');
    const bytes = await font(new TextDecoder('utf-8', { fatal: true }).decode(original));
    const id = 'openplotfont-' + hash(bytes);
    ids.set(entry.id, id); entry.id = id; entry.format = 'openplotfont'; entry.data = bytes.toString('base64');
    entry.name = entry.name.replace(/\.plotfont\.json$/i, '.opf.json');
  }
  for (const item of data.document.items) {
    if (item.text?.format === oldKey) item.text.format = 'openplotfont';
    const id = item.text?.options?.fontId;
    if (ids.has(id)) item.text.options.fontId = ids.get(id);
    if (id?.startsWith(oldKey + '-') && !ids.has(id)) throw new Error('Embed the custom font before migrating this document.');
    if (typeof item.markup === 'string') item.markup = item.markup.replaceAll('data-' + oldKey + '-kind', 'data-openplotfont-kind');
  }
  return Buffer.from(JSON.stringify(data, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node scripts/migrate-openplotfont.mjs INPUT [OUTPUT]');
  const bytes = await migrateOpenPlotFont(await readFile(input, 'utf8'));
  const target = output ?? (/\.plit(?:\.json)?$/i.test(input)
    ? input.replace(/\.plit(?:\.json)?$/i, '.openplotfont.plit.json')
    : input.replace(/(?:\.plotfont\.json|\.opf(?:\.json)?|\.json)$/i, '') + '.opf.json');
  await writeFile(target, bytes, { flag: 'wx' });
  console.info(`Saved ${target}`);
}
