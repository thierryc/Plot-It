/** PlotFont 0.3 data stays in font units; no machine settings belong here. */
export type PlotCommand = [string, ...number[]];
export interface PlotContour { closed: boolean; commands: PlotCommand[] }
export type PlotOperation = (PlotContour & { kind?: 'stroke' }) | { kind: 'fill'; fillRule: 'evenodd' | 'nonzero'; contours: PlotContour[] };
export interface PlotGlyph {
  name: string; unicodes: string[]; advanceWidth: number; strokes: PlotOperation[];
  anchors?: { name: string; x: number; y: number }[];
  connections?: Record<string, { strokeIndex: number; endpoint: string }>;
}
export interface PlotFontData {
  format: 'PlotFont'; version: '0.3'; id: string; familyName: string; styleName: string;
  unitsPerEm: number; missingGlyph: string;
  metrics: { ascender: number; descender: number; capHeight: number; xHeight: number; lineGap: number };
  metadata?: Record<string, unknown>;
  glyphs: PlotGlyph[]; kerning?: { left: string; right: string; value: number }[];
  layout?: {
    profile: string; font: { encoding: string; data: string; sha256: string }; glyphOrder: string[];
    features: { tag: string; label?: string; recommendedValue?: number }[];
    systems: { table: string; script: string; language: string; features: string[]; requiredFeature: string | null }[];
    source?: { format: string; content: unknown; sha256: string; compiledSha256: string };
  };
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`PlotFont: ${message}`); }
function object(value: unknown): Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value), 'expected an object.'); return value as Record<string, unknown>; }
function array(value: unknown): unknown[] { check(Array.isArray(value), 'expected an array.'); return value; }
function string(value: unknown): asserts value is string { check(typeof value === 'string' && value.length, 'expected a nonempty string.'); }
function number(value: unknown): asserts value is number { check(typeof value === 'number' && Number.isFinite(value), 'expected a finite number.'); }

/** JSON.parse discards duplicate keys. This bounded parser rejects them, including escaped keys. */
export function parseUniqueJson(source: string): unknown {
  check(source.length <= 32 * 1024 * 1024, 'file exceeds 32 MB.');
  let at = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(source[at] ?? '\0')) at++; };
  const readString = (): string => {
    const start = at++; let escaped = false;
    while (at < source.length) {
      const c = source[at++]!;
      if (c === '"' && !escaped) return JSON.parse(source.slice(start, at));
      escaped = c === '\\' && !escaped;
    }
    throw new Error('PlotFont: unterminated JSON string.');
  };
  const value = (depth: number): unknown => {
    check(depth <= 64, 'JSON nesting exceeds 64 levels.'); whitespace();
    if (source[at] === '"') return readString();
    if (source[at] === '{' || source[at] === '[') {
      const isObject = source[at++] === '{', end = isObject ? '}' : ']';
      const result: Record<string, unknown> = Object.create(null), items: unknown[] = [], keys = new Set<string>();
      whitespace(); if (source[at] === end) { at++; return isObject ? result : items; }
      while (true) {
        whitespace(); let key = '';
        if (isObject) {
          check(source[at] === '"', 'expected a JSON property.'); key = readString();
          check(!keys.has(key), `duplicate JSON property ${JSON.stringify(key)}.`); keys.add(key);
          whitespace(); check(source[at++] === ':', 'expected a colon.');
        }
        const item = value(depth + 1); if (isObject) result[key] = item; else items.push(item);
        whitespace(); if (source[at] === end) { at++; break; }
        check(source[at++] === ',', 'expected a comma.');
      }
      return isObject ? result : items;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at))?.[0];
    check(token, 'invalid JSON value.'); at += token.length; const result: unknown = JSON.parse(token);
    if (typeof result === 'number') number(result); return result;
  };
  const result = value(0); whitespace(); check(at === source.length, 'unexpected text after JSON.'); return result;
}

export function parsePlotFont(source: string): PlotFontData {
  const font = object(parseUniqueJson(source));
  check(font.format === 'PlotFont', 'expected format PlotFont.');
  check(font.version === '0.3', 'unsupported version; this library accepts PlotFont 0.3 only.');
  check(!('layout' in font) || font.version === '0.3', 'layout requires version 0.3.');
  for (const key of ['id', 'familyName', 'styleName', 'missingGlyph']) string(font[key]);
  check(Number.isInteger(font.unitsPerEm) && (font.unitsPerEm as number) > 0, 'unitsPerEm must be a positive integer.');
  const m = object(font.metrics);
  for (const key of ['ascender', 'descender', 'capHeight', 'xHeight', 'lineGap']) number(m[key]);
  check((m.ascender as number) > 0 && (m.capHeight as number) > 0 && (m.descender as number) <= 0 && (m.xHeight as number) >= 0 && (m.lineGap as number) >= 0, 'invalid font metrics.');
  const names = new Set<string>(), scalars = new Set<number>(); let count = 0, operations = 0;
  const glyphs = array(font.glyphs); check(glyphs.length > 0 && glyphs.length <= 100000, 'invalid glyph count.');
  const contour = (input: unknown, filled: boolean) => {
    const path = object(input); check(typeof path.closed === 'boolean' && (!filled || path.closed), 'fill contours must be explicitly closed.');
    const commands = array(path.commands); check(commands.length >= 2 && commands.length <= 100000, 'invalid command count.');
    count += commands.length; check(count <= 1000000, 'font exceeds one million commands.');
    commands.forEach((input, i) => {
      const c = array(input), arities: Record<string, number> = { M: 3, L: 3, Q: 5, C: 7 };
      check(typeof c[0] === 'string' && Object.hasOwn(arities, c[0]) && c.length === arities[c[0]], 'unsupported command or wrong arity.');
      check((c[0] === 'M') === (i === 0), 'M must occur exactly once, first.'); c.slice(1).forEach(number);
    });
  };
  for (const input of glyphs) {
    const g = object(input); string(g.name); check(!names.has(g.name), 'duplicate glyph name.'); names.add(g.name);
    for (const u of array(g.unicodes)) {
      check(typeof u === 'string' && /^[0-9A-F]{4,6}$/.test(u), 'invalid Unicode mapping.');
      const n = parseInt(u, 16); check(n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n.toString(16).toUpperCase().padStart(4, '0') === u, 'Unicode must be a canonical scalar.');
      check(!scalars.has(n), 'duplicate Unicode mapping.'); scalars.add(n);
    }
    number(g.advanceWidth); check(g.advanceWidth >= 0, 'negative advanceWidth.');
    const strokes = array(g.strokes); operations += strokes.length; check(operations <= 1000000, 'too many drawing operations.');
    for (const input of strokes) {
      const op = object(input), kind = op.kind ?? 'stroke';
      check(kind === 'stroke' || kind === 'fill', 'unsupported operation kind.');
      if (kind === 'stroke') { check(!('contours' in op) && !('fillRule' in op), 'mixed stroke/fill fields.'); contour(op, false); }
      else {
        check(!('commands' in op) && !('closed' in op) && (op.fillRule === 'evenodd' || op.fillRule === 'nonzero'), 'invalid fill operation.');
        const contours = array(op.contours); check(contours.length > 0, 'fill needs contours.'); contours.forEach(c => contour(c, true));
      }
    }
    const anchors = new Set<string>();
    for (const input of array(g.anchors ?? [])) {
      const a = object(input); string(a.name); check(!anchors.has(a.name), 'duplicate anchor.'); anchors.add(a.name); number(a.x); number(a.y);
      if ('userData' in a) object(a.userData);
    }
    for (const [side, input] of Object.entries(object(g.connections ?? {}))) {
      const ref = object(input), index = side === 'entry' ? 0 : strokes.length - 1;
      check((side === 'entry' || side === 'exit') && strokes.length && ref.strokeIndex === index && ref.endpoint === (side === 'entry' ? 'start' : 'end'), 'invalid script connection reference.');
      const op = object(strokes[index]); check((op.kind ?? 'stroke') === 'stroke' && op.closed === false, 'connections require open strokes.');
      if ('userData' in ref) object(ref.userData);
    }
    if ('userData' in g) object(g.userData);
  }
  check(names.has(font.missingGlyph as string), 'missingGlyph does not exist.');
  const pairs = new Set<string>();
  for (const input of array(font.kerning ?? [])) {
    const p = object(input); string(p.left); string(p.right); number(p.value);
    const key = JSON.stringify([p.left, p.right]); check(names.has(p.left) && names.has(p.right) && !pairs.has(key), 'invalid or duplicate kerning pair.'); pairs.add(key);
  }
  if ('metadata' in font) object(font.metadata);
  if ('layout' in font) {
    const l = object(font.layout); check(l.profile === 'opentype-static-v1', 'unsupported layout profile.');
    const payload = object(l.font); check(payload.encoding === 'base64', 'expected base64 layout data.'); string(payload.data); string(payload.sha256);
    const order = array(l.glyphOrder); check(order.length === names.size && order.length <= 65535 && new Set(order).size === order.length && order.every(n => typeof n === 'string' && names.has(n)) && order[0] === font.missingGlyph, 'invalid glyph ID mapping.');
    const tags = new Set<string>();
    for (const input of array(l.features)) {
      const e = object(input); check(typeof e.tag === 'string' && /^[ -~]{4}$/.test(e.tag) && !tags.has(e.tag), 'invalid feature manifest.'); tags.add(e.tag);
      if ('label' in e) string(e.label);
      if ('recommendedValue' in e) check(Number.isInteger(e.recommendedValue) && (e.recommendedValue as number) >= 0 && (e.recommendedValue as number) <= 0xffffffff, 'invalid feature value.');
    }
    array(l.systems);
    if ('source' in l) {
      const s = object(l.source); check(s.format === 'fea' || s.format === 'glyphs-feature-source-v1', 'unsupported feature source.');
      if (s.format === 'fea') check(typeof s.content === 'string', 'invalid feature source.');
      else {
        const content = object(s.content);
        for (const group of ['prefixes', 'classes', 'features']) for (const input of array(content[group])) {
          const block = object(input); string(block.name);
          check(typeof block.code === 'string' && typeof block.notes === 'string' && typeof block.automatic === 'boolean' && typeof block.disabled === 'boolean', 'invalid Glyphs feature source block.');
        }
      }
      string(s.sha256); check(s.compiledSha256 === payload.sha256, 'source/payload binding mismatch.');
    }
  }
  return font as unknown as PlotFontData;
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Verify the embedded font before giving it to WASM; enforce the static-profile binding. */
export async function plotFontLayoutBytes(font: PlotFontData): Promise<ArrayBuffer | undefined> {
  const l = font.layout; if (!l) return;
  check(l.font.data.length <= 4 * Math.ceil(8 * 1024 * 1024 / 3), 'layout exceeds 8 MB.');
  let binary: string; try { binary = atob(l.font.data); } catch { throw new Error('PlotFont: invalid base64 layout data.'); }
  check(btoa(binary) === l.font.data, 'noncanonical base64 layout data.');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), raw = bytes.buffer;
  check(await sha256(raw) === l.font.sha256, 'layout digest mismatch.');
  if (l.source) {
    const content = new TextEncoder().encode(canonical(l.source.content)); check(content.length <= 1024 * 1024, 'feature source exceeds 1 MB.');
    check(await sha256(content.buffer) === l.source.sha256, 'feature source digest mismatch.');
  }
  const view = new DataView(raw); check(bytes.length >= 12, 'invalid OpenType layout.');
  check([0x00010000, 0x4f54544f].includes(view.getUint32(0)), 'layout must be static TTF or OTF.');
  const count = view.getUint16(4); check(count >= 1 && count <= 128 && 12 + 16 * count <= bytes.length, 'invalid OpenType directory.');
  const tables = new Map<string, DataView>(), ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(...bytes.slice(at, at + 4)), offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    check(!tables.has(tag) && offset >= 12 + count * 16 && offset + length <= bytes.length && (!length || ranges.every(([a, b]) => offset + length <= a || offset >= b)), 'invalid, duplicate or overlapping OpenType table.');
    if (length) ranges.push([offset, offset + length]); tables.set(tag, new DataView(raw, offset, length));
  }
  const table = (tag: string, size: number) => { const v = tables.get(tag); check(v && v.byteLength >= size, `missing or truncated ${tag} table.`); return v; };
  for (const tag of ['fvar', 'gvar', 'HVAR', 'VVAR', 'MVAR', 'avar', 'morx', 'mort', 'kerx']) check(!tables.has(tag), 'variable/AAT layout is unsupported.');
  check((tables.has('glyf') && tables.has('loca')) || tables.has('CFF '), 'layout lacks static outline tables.');
  check(table('head', 54).getUint16(18) === font.unitsPerEm, 'layout unitsPerEm mismatch.');
  check(table('maxp', 6).getUint16(4) === l.glyphOrder.length, 'layout glyph count mismatch.');
  const metricCount = table('hhea', 36).getUint16(34); check(metricCount > 0 && metricCount <= l.glyphOrder.length, 'invalid layout metrics.');
  const metrics = table('hmtx', metricCount * 4 + (l.glyphOrder.length - metricCount) * 2);
  const glyphs = new Map(font.glyphs.map(g => [g.name, g]));
  l.glyphOrder.forEach((name, gid) => check(metrics.getUint16(Math.min(gid, metricCount - 1) * 4) === glyphs.get(name)!.advanceWidth, `layout advance mismatch for ${name}.`));
  // Validate every Unicode subtable, including unencoded alternate identity through the explicit map.
  const expected = new Map(font.glyphs.flatMap(g => g.unicodes.map(u => [parseInt(u, 16), g.name] as const))), mapped = new Set<number>();
  const cmap = table('cmap', 4), n = cmap.getUint16(2); check(n <= 64 && cmap.byteLength >= 4 + n * 8, 'invalid or excessive cmap subtables.');
  let decodedMappings = 0;
  const mapping = (scalar: number, gid: number) => { check(++decodedMappings <= 2000000, 'layout cmap exceeds the complexity limit.'); if (!gid) return; check(expected.get(scalar) === l.glyphOrder[gid], 'layout Unicode mapping mismatch.'); mapped.add(scalar); };
  for (let i = 0; i < n; i++) {
    const platform = cmap.getUint16(4 + 8 * i), encoding = cmap.getUint16(6 + 8 * i), offset = cmap.getUint32(8 + 8 * i);
    if (!(platform === 0 || (platform === 3 && [1, 10].includes(encoding)))) continue;
    check(offset + 2 <= cmap.byteLength, 'invalid cmap offset.'); const format = cmap.getUint16(offset);
    check([0, 4, 6, 12, 13].includes(format), `unsupported Unicode cmap format ${format}.`);
    const length = format >= 12 ? cmap.getUint32(offset + 4) : cmap.getUint16(offset + 2); check(offset + length <= cmap.byteLength, 'truncated cmap subtable.');
    const v = new DataView(raw, cmap.byteOffset + offset, length);
    if (format === 4) {
      check(length >= 16, 'truncated cmap format 4.'); const segments = v.getUint16(6) / 2; check(Number.isInteger(segments) && 16 + segments * 8 <= length, 'invalid cmap segments.');
      for (let j = 0; j < segments; j++) {
        const end = v.getUint16(14 + j * 2), start = v.getUint16(16 + segments * 2 + j * 2), delta = v.getInt16(16 + segments * 4 + j * 2), rangeAt = 16 + segments * 6 + j * 2, range = v.getUint16(rangeAt);
        check(start <= end, 'invalid cmap range.');
        for (let scalar = start; scalar <= end && scalar < 0xffff; scalar++) {
          let gid = (scalar + delta) & 0xffff;
          if (range) { const index = rangeAt + range + (scalar - start) * 2; check(index + 2 <= length, 'invalid cmap glyph offset.'); gid = v.getUint16(index); if (gid) gid = (gid + delta) & 0xffff; }
          mapping(scalar, gid);
        }
      }
    } else if (format >= 12) {
      check(length >= 16, 'truncated cmap groups.'); const groups = v.getUint32(12); check(16 + groups * 12 <= length, 'invalid cmap groups.'); let total = 0;
      for (let j = 0; j < groups; j++) { const a = v.getUint32(16 + j * 12), b = v.getUint32(20 + j * 12), first = v.getUint32(24 + j * 12); total += b - a + 1; check(a <= b && b <= 0x10ffff && total <= 0x110000, 'invalid cmap range.'); for (let scalar = a; scalar <= b; scalar++) mapping(scalar, first + (format === 12 ? scalar - a : 0)); }
    } else if (format === 0) { check(length >= 262, 'truncated cmap format 0.'); for (let scalar = 0; scalar < 256; scalar++) mapping(scalar, v.getUint8(6 + scalar)); }
    else { check(length >= 10, 'truncated cmap format 6.'); const first = v.getUint16(6), num = v.getUint16(8); check(10 + num * 2 <= length, 'truncated cmap format 6.'); for (let j = 0; j < num; j++) mapping(first + j, v.getUint16(10 + j * 2)); }
  }
  check(mapped.size === expected.size, 'layout cmap lacks PlotFont mappings.');
  const tags = new Set<string>(), systems: NonNullable<PlotFontData['layout']>['systems'] = [];
  for (const tag of ['GSUB', 'GPOS']) {
    const v = tables.get(tag); if (!v) continue;
    const tagAt = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
    check(v.byteLength >= 10, 'truncated layout table.'); const scriptsAt = v.getUint16(4), featuresAt = v.getUint16(6), lookupsAt = v.getUint16(8);
    const featureTags: string[] = [], lookupCount = lookupsAt ? v.getUint16(lookupsAt) : 0;
    for (let i = 0; featuresAt && i < v.getUint16(featuresAt); i++) {
      const at = featuresAt + 2 + i * 6, feature = tagAt(at), record = featuresAt + v.getUint16(at + 4); featureTags.push(feature); tags.add(feature);
      for (let j = 0; j < v.getUint16(record + 2); j++) check(v.getUint16(record + 4 + j * 2) < lookupCount, 'invalid feature lookup reference.');
    }
    for (let i = 0; scriptsAt && i < v.getUint16(scriptsAt); i++) {
      const at = scriptsAt + 2 + i * 6, script = tagAt(at), base = scriptsAt + v.getUint16(at + 4), languages: [string, number][] = [];
      const defaultAt = v.getUint16(base); if (defaultAt) languages.push(['dflt', base + defaultAt]);
      for (let j = 0; j < v.getUint16(base + 2); j++) { const at = base + 4 + j * 6; languages.push([tagAt(at), base + v.getUint16(at + 4)]); }
      for (const [language, offset] of languages) {
        const required = v.getUint16(offset + 2), indices: number[] = [];
        for (let j = 0; j < v.getUint16(offset + 4); j++) indices.push(v.getUint16(offset + 6 + j * 2));
        if (required !== 0xffff) indices.push(required); check(indices.every(i => i < featureTags.length), 'invalid language feature reference.');
        systems.push({ table: tag, script, language, features: [...new Set(indices.map(i => featureTags[i]!))].sort(), requiredFeature: required === 0xffff ? null : featureTags[required]! });
      }
    }
  }
  systems.sort((a, b) => { const left = `${a.table}/${a.script}/${a.language}`, right = `${b.table}/${b.script}/${b.language}`; return left < right ? -1 : left > right ? 1 : 0; });
  check(JSON.stringify([...tags].sort()) === JSON.stringify(l.features.map(f => f.tag).sort()), 'feature manifest differs from compiled layout.');
  check(canonical(systems) === canonical(l.systems), 'script/language manifest differs from compiled layout.');
  return raw;
}
