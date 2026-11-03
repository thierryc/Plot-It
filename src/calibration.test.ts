import { describe, expect, it } from 'vitest';
import { calibrationSheet } from './calibration';
import { PAPERS } from './model';
describe('surface calibration grid', () => {
  it.each([PAPERS[0]!,PAPERS[1]!,{name:'Custom',width:400,height:400}])('covers $name with uniformly spaced crossing lines inside the margin', paper => {
    const item = calibrationSheet(paper,10,20);
    expect(item.x).toBe(10.5); expect(item.y).toBe(10.5);
    expect(item.x+item.width).toBe(paper.width-10.5); expect(item.y+item.height).toBe(paper.height-10.5);
    const columns = [...item.markup.matchAll(/M([\d.]+) 0V([\d.]+)/g)].map(match => Number(match[1]));
    const rows = [...item.markup.matchAll(/M0 ([\d.]+)H([\d.]+)/g)].map(match => Number(match[1]));
    for (const positions of [columns,rows]) { expect(positions.length).toBeGreaterThan(1); positions.slice(1).forEach((value,i) => expect(value-positions[i]!).toBeCloseTo(20)); }
    expect(columns[0]).toBeCloseTo(item.width-columns.at(-1)!); expect(rows[0]).toBeCloseTo(item.height-rows.at(-1)!);
    expect(item.stroke).toBe('#000000'); expect(item.fillSettings).toBeUndefined();
  });
  it('uses the requested spacing without modifying other artwork or paper', () => {
    const paper = {...PAPERS[0]!}, before = {...paper}; const grid = calibrationSheet(paper,5,10);
    expect(grid.name).toContain('10 mm'); expect(paper).toEqual(before);
  });
  it.each([0,1,101,NaN,Infinity])('rejects unusable spacing %s', spacing => expect(() => calibrationSheet(PAPERS[0]!,10,spacing)).toThrow('spacing'));
  it('explains paper/margin combinations too small for a sheet', () => {
    expect(() => calibrationSheet(PAPERS[0]!,110,20)).toThrow('too small');
    expect(() => calibrationSheet(PAPERS[0]!,-1,20)).toThrow('margin');
  });
});
