import { describe, expect, it } from 'vitest';
import { canonicalColor, defaultPens, discoverPens, preparePenPaths, restorePens } from './pens';
import { initialState } from './model';
import { buildMotionPlan } from './motion-plan';
import type { PlotPath } from './svg';
const settings = { ...initialState.settings, returnToOrigin: false };
const path = (tool: string, x: number, orderGroup?: string): PlotPath => ({ tool, points: [{ x, y: 10 }, { x: x + 3, y: 10 }], width: .5, orderGroup });
const black = '#000000', red = '#FF0000', blue = '#0000FF';

describe('physical pen palette', () => {
  it.each(['red', '#f00', '#FF0000', '#f008', '#FF000022', 'rgb(255, 0, 0)', 'rgba(255, 0, 0, .4)', 'rgb(100% 0% 0% / 20%)', 'color(srgb 1 0 0 / .1)'])('normalizes %s to one RGB pen', input => { expect(canonicalColor(input)).toBe(red); });
  it('rounds percentages consistently and rejects invalid paints', () => {
    expect(canonicalColor('rgb(50% 0% 0%)')).toBe('#800000');
    expect(() => canonicalColor('#xyz')).toThrow();
    expect(() => canonicalColor('url(#gradient)')).toThrow('flat RGB');
  });
  it('shares pens across imports, merges assignments, and leaves source paths untouched', () => {
    const source = [path(black, 1), path(red, 30), path(black, 10)];
    const before = structuredClone(source), preferences = defaultPens();
    preferences.assignments[red] = { color: black, name: 'Fineliner' };
    const prepared = preparePenPaths(source, settings, preferences);
    expect(prepared.pens).toEqual([{ color: black, name: 'Fineliner', sources: [black, red], included: true }]);
    expect(prepared.paths.every(p => p.tool === black)).toBe(true);
    expect(source).toEqual(before);
    expect(prepared.paths.map(p => p.width)).toEqual([.5, .5, .5]);
    expect(buildMotionPlan(prepared.paths, settings).passes).toHaveLength(1);
  });
  it('supports subsets and returns the full available palette when all pens are excluded', () => {
    const preferences = defaultPens(); preferences.excluded = [red];
    const source = [path(red, 1), path(black, 20)];
    expect(preparePenPaths(source, settings, preferences).paths.map(p => p.tool)).toEqual([black]);
    preferences.excluded.push(black);
    const result = preparePenPaths(source, settings, preferences);
    expect(result.paths).toEqual([]); expect(result.pens).toHaveLength(2); expect(result.pens.every(p => !p.included)).toBe(true);
  });
  it('discovers colors only from paths retained inside safe bounds', () => {
    const preferences = defaultPens();
    const result = preparePenPaths([path(red, 300), path(black, 20)], settings, preferences, { width: 210, height: 297 });
    expect(result.pens.map(p => p.color)).toEqual([black]);
  });
  it('restores legacy/default preferences and ignores invalid assignments', () => {
    expect(restorePens()).toEqual(defaultPens());
    const restored = restorePens({ assignments: { [red]: { color: 'bad', name: 'bad' }, [black]: { color: '#ABC', name: 'Pencil' } } });
    expect(restored.assignments).toEqual({ [black]: { color: '#AABBCC', name: 'Pencil' } });
  });
  it('appends new colors in source order without overriding manual pen order', () => {
    const preferences = defaultPens(); preferences.order = [red, black];
    expect(discoverPens([path(black, 1), path(blue, 20), path(red, 30)], preferences).map(p => p.color)).toEqual([red, black, blue]);
  });
});

describe('pen order versus path order', () => {
  it('groups colors before optimizing paths and respects manual pen rank', () => {
    const source = [path(red, 30), path(black, 40), path(red, 10), path(black, 20)];
    const preferences = defaultPens(); preferences.order = [black, red];
    const result = preparePenPaths(source, settings, preferences);
    expect(result.paths.map(p => p.tool)).toEqual([black, black, red, red]);
    expect(result.paths.map(p => p.points[0]!.x)).toEqual([20, 40, 10, 30]);
  });
  it('preserves source order independently of travel optimization', () => {
    const source = [path(red, 30), path(black, 10), path(red, 20)], preferences = defaultPens(); preferences.mode = 'source';
    const paths = preparePenPaths(source, settings, preferences).paths;
    expect(paths).toEqual(source); expect(buildMotionPlan(paths, settings).passes.map(p => p.tool)).toEqual([red, black, red]);
  });
  it('keeps protected text/fill blocks intact, including repeated pens', () => {
    const source = [path(black, 20, 'text'), path(red, 2, 'text'), path(black, 10, 'text'), path(red, 40)];
    const paths = preparePenPaths(source, settings, defaultPens()).paths;
    expect(paths.slice(0, 3).map(p => p.points)).toEqual(source.slice(0, 3).map(p => p.points));
    expect(buildMotionPlan(paths, settings).passes.map(p => p.tool)).toEqual([black, red, black, red]);
  });
  it('retains protected operation direction and order after filtering and splitting', () => {
    const source = [path(red, 30, 'text'), path(black, 25, 'text'), path(black, 3, 'text')];
    const preferences = defaultPens(); preferences.excluded = [red];
    const paths = preparePenPaths(source, { ...settings, maxPenDownMm: 2 }, preferences).paths;
    expect(paths.map(p => p.points[0]!.x)).toEqual([25, 27, 3, 5]);
    expect(paths.every(p => p.orderGroup === 'text')).toBe(true);
  });
});

describe('mandatory color boundaries', () => {
  it('returns to origin before every tool event even with legacy pauses disabled', () => {
    const plan = buildMotionPlan([path(black, 20), path(red, 50), path(black, 30)], { ...settings, pauseOnToolChange: false });
    const changes = plan.events.filter(event => event.kind === 'tool');
    expect(changes).toHaveLength(2);
    expect(changes.every(event => event.from.x === 0 && event.from.y === 0 && !event.penDown)).toBe(true);
    expect(plan.settings.pauseOnToolChange).toBe(true);
    for (const pass of plan.passes.slice(1)) {
      expect(plan.events[pass.startEvent]!.kind).toBe('tool');
      const travel = plan.events[pass.startEvent - 1]!;
      expect(travel.kind).toBe('xy'); expect(travel.to).toEqual({ x: 0, y: 0 }); expect(travel.penDown).toBe(false);
    }
    expect(plan.duration).toBeGreaterThan(buildMotionPlan([path(black, 20), path(black, 50), path(black, 30)], settings).duration);
  });
});
