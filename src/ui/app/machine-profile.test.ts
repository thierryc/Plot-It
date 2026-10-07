// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initialState } from '../../model';
import { machineProfileFields } from './machine-profile';

describe('shared machine profile fields', () => {
  it.each(['data-setting','data-plot-setting'] as const)('renders NextDraw with native models and %s hooks', hook => {
    const host = document.createElement('div');
    host.innerHTML = machineProfileFields({...initialState.settings,profile:'nextdraw',nextdrawModel:'2234'},key=>({[hook]:key}));
    const profile = host.querySelector<HTMLSelectElement>(`[${hook}="profile"]`)!;
    expect(profile.value).toBe('nextdraw');
    expect([...profile.options].map(option=>option.textContent)).toEqual(['AxiDraw / EBB','Bantam Tools NextDraw','XyloDraw']);
    const model = host.querySelector<HTMLSelectElement>(`[${hook}="nextdrawModel"]`)!;
    expect(model.value).toBe('2234');
    expect([...model.options].map(option=>option.value)).toEqual(['8511','1117','2234']);
    expect(host.querySelector(`[${hook}="axidrawModel"]`)).toBeNull();
    expect(host.textContent).toContain('Requires EBB 3.0.2');
  });
});
