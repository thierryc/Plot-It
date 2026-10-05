import type * as HB from 'harfbuzzjs';
import type { PlotGlyph, PlotContour } from './reader.js';
import type { PlotFont, PathCommand, GeometryOperation, LayoutOptions, TextGeometry } from './types.js';
import { fontState } from './state.js';

interface Placement { glyph: PlotGlyph; x: number; y: number; cluster: number }
export function layoutText(prepared: PlotFont, content: string, input: LayoutOptions = {}): TextGeometry {
  const state = fontState(prepared), data = state.data, hb = state.engine, font = state.shapingFont;
  const options: Required<LayoutOptions> = {
    capHeight: 1, letterSpacing: 0, wordSpacing: 0,
    lineHeight: (data.metrics.ascender - data.metrics.descender + data.metrics.lineGap) / data.metrics.capHeight,
    align: 'left', kerning: true, ligatures: true, contextual: true,
    features: '', direction: 'auto', language: '', script: '', ...input
  };
  if (typeof content !== 'string' || !content.trim()) throw new Error('Enter some text.');
  if (![options.capHeight, options.letterSpacing, options.wordSpacing, options.lineHeight].every(Number.isFinite) || options.capHeight <= 0 || options.lineHeight <= 0) throw new Error('PlotFont: cap height and line height must be positive; spacing must be finite.');
  if (!['left', 'center', 'right'].includes(options.align) || !['auto', 'ltr', 'rtl'].includes(options.direction)) throw new Error('PlotFont: invalid alignment or direction.');
  if (typeof options.features !== 'string' || typeof options.language !== 'string' || typeof options.script !== 'string' || ![options.kerning, options.ligatures, options.contextual].every(v => typeof v === 'boolean')) throw new Error('PlotFont: invalid layout options.');
  if (options.script && !/^[A-Za-z]{4}$/.test(options.script)) throw new Error('PlotFont: use a four-letter script code.');
  if (options.language && !/^[a-zA-Z0-9-]+$/.test(options.language)) throw new Error('PlotFont: use a language code such as en or tr.');
  if (content.length > 100000 || content.includes('\t') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)) throw new Error('PlotFont text must use Unicode scalars, explicit newlines, and no tabs.');
  if (!font && (options.features.trim() || options.direction === 'rtl' || (options.script && options.script !== 'Latn'))) throw new Error('This PlotFont has no OpenType layout data. Use left-to-right text without advanced features.');
  const drawings = new Map(data.glyphs.map(g => [g.name, g]));
  const mapping = new Map(data.glyphs.flatMap(g => g.unicodes.map(u => [parseInt(u, 16), g] as const)));
  const pairs = new Map((data.kerning ?? []).map(p => [JSON.stringify([p.left, p.right]), p.value]));
  const scale = options.capHeight / data.metrics.capHeight;
  const features: HB.Feature[] = [];
  if (data.layout) {
    for (const f of data.layout.features) if (f.recommendedValue !== undefined) features.push(new hb!.Feature(f.tag, f.recommendedValue));
    for (const [tag, value] of [['kern', +options.kerning], ['liga', +options.ligatures], ['clig', +options.ligatures], ['calt', +options.contextual]] as const) if (data.layout.features.some(f => f.tag === tag)) features.push(new hb!.Feature(tag, value));
    if (options.letterSpacing) { features.push(new hb!.Feature('liga', 0), new hb!.Feature('clig', 0)); }
    for (const token of options.features.split(',').map(s => s.trim()).filter(Boolean)) {
      const feature = hb!.Feature.fromString(token);
      if (!feature || !data.layout.features.some(f => f.tag === feature.tag)) throw new Error(`Invalid or unavailable PlotFont feature: ${token}.`);
      features.push(feature);
    }
  }
  const lines = content.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const placements: Placement[] = []; let x = 0, y = 0;
    if (font) {
      const buffer = new hb!.Buffer(); buffer.addText(line); buffer.setClusterLevel(hb!.ClusterLevel.MONOTONE_GRAPHEMES);
      if (options.direction !== 'auto') buffer.setDirection(options.direction === 'rtl' ? hb!.Direction.RTL : hb!.Direction.LTR);
      if (options.language) buffer.setLanguage(options.language); if (options.script) buffer.setScript(options.script);
      buffer.guessSegmentProperties(); hb!.shape(font, buffer, features);
      const infos = buffer.getGlyphInfos(), positions = buffer.getGlyphPositions();
      if (infos.length > 100000) throw new Error('PlotFont text produces too many glyphs.');
      if (infos.some(g => g.codepoint === 0)) throw new Error('This PlotFont is missing characters in the text.');
      const cursive = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mongolian}]/u.test(line);
      infos.forEach((info, i) => {
        const glyph = drawings.get(data.layout!.glyphOrder[info.codepoint]!); if (!glyph) throw new Error('PlotFont shaping returned an unmapped glyph.');
        const pos = positions[i]!; placements.push({ glyph, x: x + pos.xOffset, y: y + pos.yOffset, cluster: info.cluster });
        x += pos.xAdvance; y += pos.yAdvance;
        if (infos[i + 1]?.cluster !== info.cluster) {
          if (i + 1 < infos.length && !cursive) x += options.letterSpacing * data.unitsPerEm;
          if (line[info.cluster] === ' ' || line[info.cluster] === '\u00a0') x += options.wordSpacing * data.unitsPerEm;
        }
      });
    } else {
      // Reviewed symbol catalogs explicitly map drawings to private-use scalars.
      // These need direct glyph lookup, not complex-script shaping or inferred mappings.
      if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u.test(line)) throw new Error('This PlotFont only supports simple Latin layout and explicit private-use symbols; use a font with OpenType layout for this script.');
      let previous: PlotGlyph | undefined, cluster = 0; const chars = [...line];
      chars.forEach((scalar, i) => {
        const glyph = mapping.get(scalar.codePointAt(0)!); if (!glyph) throw new Error(`This PlotFont is missing character ${JSON.stringify(scalar)}.`);
        if (previous && options.kerning) x += pairs.get(JSON.stringify([previous.name, glyph.name])) ?? 0;
        placements.push({ glyph, x, y: 0, cluster }); x += glyph.advanceWidth;
        if (i + 1 < chars.length) x += options.letterSpacing * data.unitsPerEm;
        if (scalar === ' ' || scalar === '\u00a0') x += options.wordSpacing * data.unitsPerEm;
        previous = glyph; cluster += scalar.length;
      });
    }
    return { placements, width: x * scale };
  });
  const minimum = .01 * options.capHeight / 1.4;
  const maxWidth = Math.max(minimum, ...lines.map(l => l.width)), lineAdvance = options.lineHeight * options.capHeight;
  let minX = 0, maxX = maxWidth, minY = -data.metrics.ascender * scale, maxY = (lines.length - 1) * lineAdvance - data.metrics.descender * scale;
  const operations: GeometryOperation[] = []; let commandCount = 0;
  const transform = (contour: PlotContour, x: number, y: number): PathCommand[] => {
    commandCount += contour.commands.length; if (commandCount > 1000000) throw new Error('PlotFont text exceeds one million drawing commands.');
    const commands = contour.commands.map(([type, ...values]) => ({ type, values: values.map((v, i) => i % 2 ? -(v + y) * scale : (v + x) * scale) } as PathCommand));
    for (const c of commands) for (let i = 0; i < c.values.length; i += 2) {
      const x = c.values[i]!, y = c.values[i + 1]!; if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('PlotFont text coordinates overflow.');
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (contour.closed) commands.push({ type: 'Z', values: [] }); return commands;
  };
  lines.forEach((line, row) => {
    const dx = (maxWidth - line.width) * (options.align === 'right' ? 1 : options.align === 'center' ? .5 : 0) / scale;
    for (const p of line.placements) for (const op of p.glyph.strokes) {
      const y = p.y - row * lineAdvance / scale, x = p.x + dx;
      if (op.kind === 'fill') operations.push({ kind: 'fill', fillRule: op.fillRule, contours: op.contours.map(c => ({ closed: c.closed, commands: transform(c, x, y) })) });
      else operations.push({ kind: 'stroke', contour: { closed: op.closed, commands: transform(op, x, y) } });
    }
  });
  if (!operations.length) throw new Error('This text contains no drawable PlotFont geometry.');
  const width = Math.max(minimum, maxX - minX), height = Math.max(minimum, maxY - minY);
  if (![minX, minY, maxX, maxY, width, height].every(Number.isFinite)) throw new Error('PlotFont text coordinates overflow.');
  return { operations, bounds: { minX, minY, maxX, maxY }, viewBox: [minX, minY, width, height],
    lineAdvances: lines.map(line => line.width), capHeight: options.capHeight };
}
