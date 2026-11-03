import type { PlotSettings } from '../../src/model';
import { buildMotionPlan } from '../../src/motion-plan';

/** Clockwise A5 paper edge from the confirmed upper-left origin. */
export function a5PerimeterPlan(settings: PlotSettings, orientation: 'portrait' | 'landscape') {
  const [width, height] = orientation === 'portrait' ? [148, 210] : [210, 148];
  return buildMotionPlan([{ tool: '#000000', points: [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height },
    { x: 0, y: height }, { x: 0, y: 0 },
  ] }], { ...settings, speed: 10, travelSpeed: 20, drawAcceleration: 75,
    travelAcceleration: 100, returnToOrigin: true, reorderMode: 'preserve',
    pauseOnToolChange: true, maxPenDownMm: 0 });
}

/** One pen, inside both A5 orientations. The origin is the paper's upper left. */
export function a5SmokePlan(settings: PlotSettings) {
  const tool = '#000000';
  const circle = Array.from({ length: 129 }, (_, i) => ({
    x: 74 + 22 * Math.cos(i * 2 * Math.PI / 128),
    y: 74 + 22 * Math.sin(i * 2 * Math.PI / 128),
  }));
  const wave = Array.from({ length: 161 }, (_, i) => ({
    x: 34 + i / 2, y: 109 + 4 * Math.sin(i * 4 * Math.PI / 160),
  }));
  const paths = [
    [{ x: 24, y: 24 }, { x: 124, y: 24 }, { x: 124, y: 124 }, { x: 24, y: 124 }, { x: 24, y: 24 }],
    circle,
    [{ x: 44, y: 74 }, { x: 104, y: 74 }],
    [{ x: 74, y: 44 }, { x: 74, y: 104 }],
    wave,
  ].map(points => ({ tool, points }));
  return buildMotionPlan(paths, { ...settings, speed: 15, travelSpeed: 25,
    drawAcceleration: 100, travelAcceleration: 150, returnToOrigin: true,
    reorderMode: 'preserve', pauseOnToolChange: true, maxPenDownMm: 0 });
}
