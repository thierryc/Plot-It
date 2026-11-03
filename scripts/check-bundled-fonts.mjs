import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'scripts/font-bundle-policy.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(root, 'src/fonts/catalog.json'), 'utf8'));
const previews = JSON.parse(readFileSync(join(root, 'src/fonts/previews.json'), 'utf8'));
for (const font of catalog) {
  if (policy.excludedFontIds.includes(font.id) || !policy.allowedLicenses.includes(font.license)) {
    throw new Error(`Font ${font.id} is outside the reviewed bundle policy. Keep optional fonts outside public/ and review new licenses explicitly.`);
  }
}
for (const font of previews) {
  if (policy.excludedFontIds.includes(font.id)) throw new Error(`Excluded font preview: ${font.id}. Regenerate font previews.`);
}
for (const path of readdirSync(join(root, 'public'), { recursive: true, encoding: 'utf8' })) {
  if (policy.excludedFontIds.some(id => path.split(/[\\/]/).some(part => part === id || part.startsWith(`${id}.`) || part.startsWith(`${id}-`)))) {
    throw new Error(`Excluded optional font asset in public/: ${path}`);
  }
}
console.info(`Font bundle policy: ${catalog.length} reviewed catalog entries; optional GPL fonts excluded.`);
