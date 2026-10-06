import { describe, expect, it } from 'vitest';
import { EbbPen } from './ebb-pen';
import { PenState } from './pen-control';

describe('documented EBB pen execution', () => {
  it('configures endpoints before SP and holds the caller until host pacing resolves', async () => {
    const state = new PenState(), commands: string[] = [];
    state.configure({ penUp: 30, penDown: 44 });
    let release!: () => void, reached!: () => void;
    const holding = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const pen = new EbbPen(state, {
      command: async command => { commands.push(command); }, queued: () => {}, now: () => 0,
      sleep: async ms => { expect(ms).toBeGreaterThan(0); reached(); await holding; },
    });
    let completed = false;
    const moving = pen.move(30, 0, true).then(() => { completed = true; });
    await waiting;
    expect(completed).toBe(false); expect(state.acknowledged).toBe(30); expect(state.settled).toBeNull();
    expect(commands.slice(0, 4)).toEqual(['SC,4,21850','SC,5,18980','SC,11,1845','SC,12,1230']);
    expect(commands.at(-1)).toMatch(/^SP,1,\d+,1$/);
    expect(commands.some(command => /^(S2|TP),|^SC,1,/.test(command))).toBe(false);
    release(); await moving; expect(completed).toBe(true);
  });

  it('restores the plot calibration after a manual intermediate height', async () => {
    const state = new PenState(), commands: string[] = [];
    const pen = new EbbPen(state, { command: async command => { commands.push(command); }, queued: () => {}, now: () => 0, sleep: async () => {} });
    await pen.move(67, 120, true);
    expect(commands).toContain('SC,5,14265'); expect(commands.at(-1)).toMatch(/^SP,0,/);
    const before = commands.length; await pen.move(60, 0, true);
    expect(commands.slice(before)).toContain('SC,5,15700'); expect(commands.at(-1)).toMatch(/^SP,0,/);
    await pen.move(50, 0, true); expect(commands.at(-1)).toMatch(/^SP,1,/);
  });

  it('does not acknowledge a rejected SP target and reissues it on retry', async () => {
    const state = new PenState(); let reject = true, sent = 0;
    const pen = new EbbPen(state, { queued: () => {}, now: () => 0, sleep: async () => {}, command: async command => {
      if (command.startsWith('SP,')) { sent++; if (reject) { reject = false; throw new Error('rejected'); } }
    } });
    await expect(pen.move(50, 0, true)).rejects.toThrow('rejected'); expect(state.acknowledged).toBeNull();
    await pen.move(50, 0, true); expect(state.acknowledged).toBe(50); expect(sent).toBe(2);
  });
});
