// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlotterBackground } from './plotter-background';
import { initialState } from './model';
import { machinePoint } from './motion';
import { PLOTTER_POSITIONS, setupAngle, setupSize } from './plotter-setup';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('plotter arm placement', () => {
  it('hides the AxiDraw illustration for a NextDraw setup', () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    document.body.innerHTML = '<main><div id="stage"><svg id="paper"></svg></div></main>';
    const background = new PlotterBackground(document.querySelector<SVGSVGElement>('#paper')!, () => ({...initialState.settings,profile:'nextdraw'}));
    try { frame(0); expect(document.querySelector<HTMLDivElement>('.plotter-background')!.hidden).toBe(true); }
    finally { background.destroy(); }
  });
  for (const axidrawModel of ['v3-a4', 'v3-a3'] as const) {
    it.each(PLOTTER_POSITIONS)(`${axidrawModel}: keeps the pen on the paper with $label`, ({ rotation }) => {
      let frame!: FrameRequestCallback;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
      document.body.innerHTML = '<main><div id="stage"><svg id="paper"></svg></div></main>';
      const paper = document.querySelector<SVGSVGElement>('#paper')!;
      Object.defineProperty(paper, 'getScreenCTM', { value: () => ({ a: 1, d: 1, e: 100, f: 200 }) });
      const settings = { ...initialState.settings, axidrawModel, machineRotation: rotation };
      const background = new PlotterBackground(paper, () => settings);
      try {
        frame(0);
        const arm = document.querySelector<HTMLElement>('[data-rig="arm"]')!;
        const rig = document.querySelector<HTMLElement>('[data-rig="rig"]')!;
        const rest = Number(arm.style.translate.split(' ')[0]!.replace('px', ''));
        const mirrored = document.querySelector<HTMLElement>('[data-rig="stationary"]')!.style.transform === 'scaleY(-1)';
        expect(mirrored).toBe(rotation === 270);
        if (rotation === 270) {
          const baseY = 20 + 123.227/2;
          const stationaryY = 2*256.8636 - baseY;
          const baseOffset = machinePoint({x:0,y:(stationaryY-256.8636)*setupSize(settings).height/1091.773},180);
          expect(baseOffset.y).toBeLessThan(0); // The stationary base is above the paper origin.
        }

        const size = setupSize(settings);
        const symbolScale = (size.height / 1091.773) / (size.width / 968.182);
        if (rotation === 180 || rotation === 270) {
          // The head's right edge meets the carriage's left edge at rest.
          expect(50.4546 + rest + 20.4546).toBeCloseTo(571.364 + 131.818 / 2 * (1 - symbolScale));
        } else expect(rest).toBe(0);
        const anchor = /translate\((-?[\d.]+)px,(-?[\d.]+)px\)$/.exec(rig.style.transform)!;
        expect(50.4546 + rest + Number(anchor[1])).toBeCloseTo(0);
        expect(256.8636 + Number(anchor[2])).toBeCloseTo(0);
        background.setPosition({ x: 17, y: 31 }); frame(16);
        const [x, y] = arm.style.translate.split(' ').map(value => Number(value.replace('px', '')));
        const local = { x: (x! - rest) * size.width / 968.182, y: y! * size.height / 1091.773 };
        const angle = ((setupAngle(settings) + 360) % 360) as typeof rotation;
        const position = machinePoint(local, angle);
        expect(position.x).toBeCloseTo(17); expect(position.y).toBeCloseTo(31);
      } finally { background.destroy(); }
    });
  }
});
