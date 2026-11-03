import { describe, expect, it } from 'vitest';
import { a3Zone, a3ThreeAs } from '../scripts/hardware-a3-fixture';
import { validateJob } from '../src/network-protocol';
import { compileMotion } from '../src/motion-plan';
import { validateMotionCommand } from '../src/motion-command';

describe('small A3 pen-synchronization comparison fixture', () => {
  it('moves the same three strokes to the unused left strip without changing their geometry', () => {
    const fixture = a3ThreeAs([{x:10,y:140},{x:10,y:180},{x:10,y:220}]);
    expect(fixture.paths).toHaveLength(6);
    expect(fixture.paths[0]!.points).toEqual([{x:10,y:164},{x:22,y:140},{x:34,y:164}]);
    for (const p of fixture.paths) for (const point of p.points) {
      expect(point.x).toBeGreaterThanOrEqual(10); expect(point.x).toBeLessThanOrEqual(34);
      expect(point.y).toBeGreaterThanOrEqual(140); expect(point.y).toBeLessThanOrEqual(244);
    }
    expect(fixture.document.document.items[0]!.viewBox).toEqual([0,0,24,104]);
    expect(() => a3ThreeAs([{x:280,y:280}])).toThrow(/zone/i);
  });
  it('reserves a fresh strip for three As with six separate down strokes and raised travels', () => {
    const fixture = a3ThreeAs();
    expect(fixture.paths).toHaveLength(6);
    expect(fixture.plan.events.filter(e => e.kind === 'pen' && e.penDown)).toHaveLength(6);
    for (const path of fixture.paths) for (const point of path.points) {
      expect(point.x).toBeGreaterThanOrEqual(170); expect(point.x).toBeLessThanOrEqual(274);
      expect(point.y).toBeGreaterThanOrEqual(130); expect(point.y).toBeLessThanOrEqual(154);
    }
    expect(fixture.paths.filter(p => p.points.length === 2).map(p => p.points)).toEqual([
      [{x:175,y:144},{x:189,y:144}], [{x:215,y:144},{x:229,y:144}], [{x:255,y:144},{x:269,y:144}],
    ]);
    let down = false, strokes = 0;
    for (const event of fixture.plan.events) {
      if (event.kind === 'pen') { down = event.penDown; if (down) strokes++; }
      if (event.kind === 'xy') expect(event.penDown).toBe(down);
    }
    expect(strokes).toBe(6);
    expect(fixture.plan.events.at(-1)?.to).toEqual({x:0,y:0});
    expect(validateJob({version:1,requestId:'three-a-reference',plan:fixture.plan}).plan).toBe(fixture.plan);
  });
  it('reserves disjoint small zones, with identical translated strokes and no connecting ink', () => {
    const a = a3Zone(10, 10, 'browser', 30, 40), b = a3Zone(90, 10, 'server', 30, 40);
    expect(a.paths.length).toBeGreaterThan(10);
    expect(b.paths.map(p => p.points.map(v => ({ x: v.x - 80, y: v.y })))).toEqual(a.paths.map(p => p.points));
    for (const p of a.paths) for (const v of p.points) {
      expect(v.x).toBeGreaterThanOrEqual(10); expect(v.x).toBeLessThanOrEqual(70);
      expect(v.y).toBeGreaterThanOrEqual(10); expect(v.y).toBeLessThanOrEqual(50);
    }
    expect(a.plan.events.filter(e => e.kind === 'pen' && e.penDown)).toHaveLength(a.paths.length);
    expect(a.plan.events.at(-1)?.to).toEqual({ x: 0, y: 0 });
    expect(a.document.document.settings.speed).toBe(50);
    expect(a.document.document.settings.travelSpeed).toBe(200);
  });
  it('produces valid complete jobs and bounded SM commands before hardware use', () => {
    const zone = a3Zone(90, 10, 'server', 30, 40);
    expect(validateJob({ version: 1, requestId: 'a3-server', plan: zone.plan }).plan).toBe(zone.plan);
    {
      let position = { x: 0, y: 0 };
      for (const event of zone.plan.events) for (const command of compileMotion(event, zone.plan.settings, position)) {
        expect(() => validateMotionCommand(command.command)).not.toThrow(); position = command.targetSteps;
      }
      expect(position).toEqual({ x: 0, y: 0 });
    }
    expect(() => a3Zone(270, 10, 'outside', 30, 40)).toThrow(/zone/i);
    expect(() => a3Zone(10, 410, 'outside', 30, 40)).toThrow(/zone/i);
  });
});
