import {describe,expect,it} from 'vitest';
import {penTransition,servoPosition,servoSetup,PEN_UP_SETTLE_MS,PEN_DOWN_SETTLE_MS} from './pen-control';

describe('protocol pen adapter',()=>{
 it('preserves physical calibration and validates height',()=>{
  expect([0,30,50,60,100].map(servoPosition)).toEqual([28000,21850,17750,15700,7500]);
  for(const value of [-1,101,NaN,Infinity])expect(()=>servoPosition(value)).toThrow('between 0 and 100');
 });
 it('preserves effective independent rates and semantic endpoints',()=>{
  expect(servoSetup(20,42)).toEqual(['SC,4,23900','SC,5,19390','SC,11,1845','SC,12,1230','SC,8,8','SC,9,3']);
  expect(servoSetup(42,20).slice(0,2)).toEqual(['SC,4,19390','SC,5,23900']);
 });
 it('uses rounded pulse distance and controller refreshes, then adds explicit settling',()=>{
  const lower=penTransition(20,42,false),raise=penTransition(42,20,true),difference=4510,refresh=24;
  expect(lower.duration).toBe((Math.ceil(difference/1230)+1)*refresh+PEN_DOWN_SETTLE_MS);
  expect(raise.duration).toBe((Math.ceil(difference/1845)+1)*refresh+PEN_UP_SETTLE_MS+150);
  expect(lower.command).toBe(`SP,0,${lower.duration},1`);expect(raise.command).toBe(`SP,1,${raise.duration},1`);
  expect(lower).not.toHaveProperty('hostWaitMs');
 });
 it.each([true,false])('initializes an unknown pulse with refresh guard and explicit startup allowance (%s)',up=>{
  expect(penTransition(null,50,up).duration).toBe(2*24+250+100+(up?150:0));
  expect(penTransition(50,50.1,up).duration).toBe(2*24+100+(up?150:0));
 });
 it('keeps unchanged energized output distinct and validates the queue bound',()=>{
  expect(penTransition(50,50,true)).toEqual({position:17750,duration:250,command:'SP,1,250,1'});
  for(const value of [-1,NaN,65536])expect(()=>penTransition(50,60,false,value)).toThrow('settling time');
 });
 it('treats a prepared total as a minimum and never adds it twice',()=>{
  for(const up of [true,false]){const move=penTransition(20,42,up);expect(penTransition(20,42,up,move.duration).duration).toBe(move.duration);expect(penTransition(20,42,up,500).duration).toBe(500);}
 });
 it('uses the selected brushless calibration and pin',()=>{
  const move=penTransition(60,30,false,0,{profile:'nextdraw',nextdrawServo:'brushless'});
  expect(move.position).toBe(7560);expect(move.command.endsWith(',2')).toBe(true);
 });
});
