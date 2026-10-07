import {it,expect} from 'vitest';
import {machineProfile} from './profiles.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import {PlotterSession} from './session.js';
import {defaultPen} from './pen.js';
it.each([{x:0,y:0},{x:25,y:0},{x:20,y:40},{x:200,y:150}])('homes NextDraw with independent freewheel/limit mechanics from %o',async point=>{
 const clock=new VirtualClock(),profile=machineProfile('nextdraw-8511',0,8),board=new VirtualEbb(clock,{firmware:'3.1.7',homingMechanics:{...point,stepsPerMm:profile.stepsPerMm}}),session=new PlotterSession(board.createTransport(),clock,profile);await session.connect();session.configure({...defaultPen,up:60,down:30});await session.home();expect(session.origin.source).toBe('explicit');expect(board.mechanical!.x).toBeCloseTo(0,1);expect(board.mechanical!.y).toBeCloseTo(0,1);expect(board.penUp).toBe(true);expect(board.position).toEqual({m1:0,m2:0});
});
it('rejects a missing homing switch and keeps origin uncertain',async()=>{const clock=new VirtualClock(),profile=machineProfile('nextdraw-8511'),board=new VirtualEbb(clock,{firmware:'3.1.7',homingMechanics:{x:20,y:20,stepsPerMm:40,switchMissing:true}}),session=new PlotterSession(board.createTransport(),clock,profile);await session.connect();await expect(session.home()).rejects.toThrow(/switch/);expect(session.origin.source).toBe('unset');});
it('does not infer automatic homing from modern firmware alone',async()=>{const clock=new VirtualClock(),profile=machineProfile('xylodraw'),board=new VirtualEbb(clock,{firmware:'3.1.7'}),session=new PlotterSession(board.createTransport(),clock,profile);await session.connect();await expect(session.home()).rejects.toThrow(/NextDraw/);expect(board.commands.filter(c=>c.startsWith('SM'))).toHaveLength(0);});

it.each([90,180,270] as const)('homes to the canvas origin corner at rotation %i',async rotation=>{const clock=new VirtualClock(),profile=machineProfile('nextdraw-8511',rotation),board=new VirtualEbb(clock,{firmware:'3.1.7',homingMechanics:{x:20,y:40,stepsPerMm:40}}),session=new PlotterSession(board.createTransport(),clock,profile);await session.connect();await session.home();expect(board.mechanical!.x).toBeCloseTo(rotation===270?0:profile.bounds!.width,1);expect(board.mechanical!.y).toBeCloseTo(rotation===90?0:profile.bounds!.height,1);expect(board.position).toEqual({m1:0,m2:0});expect(board.penUp).toBe(true);});
