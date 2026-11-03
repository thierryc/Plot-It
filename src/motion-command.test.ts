import { describe, expect, it } from 'vitest';
import { validateMotionCommand } from './motion-command';

describe('preflight EBB command bounds', () => {
  it('accepts documented timed mixed-axis commands', () => {
    expect(() => validateMotionCommand('XM,15,10,-10')).not.toThrow();
  });
  it('rejects firmware ranges and mixed-axis speed before execution', () => {
    for (const command of ['XM,0,1,1', 'XM,15,400,400', 'XM,1000,1,0', 'XM,16777215,16777215,16777215', 'XM,1,16777216,0', 'LM,-1,1,0,0,0,0', 'LM,2147483648,1,0,0,0,0', 'LM,0,1,2147483648,0,0,0', 'LM,NaN,1,0,0,0,0']) {
      expect(() => validateMotionCommand(command), command).toThrow();
    }
  });
});
