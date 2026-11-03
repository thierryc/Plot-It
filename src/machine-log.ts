import {digest, type ExecutablePlan} from '@thierryc/plotter-core';
import type {PlotterJobTrace} from './plotter-core';

/** Version 7 stores each executable once, referenced by its verified program digest. */
export function compactMachineLog(input: Record<string, unknown> & {job: PlotterJobTrace | null}) {
  const programs: Record<string, ExecutablePlan> = {};
  const reference = (program: ExecutablePlan) => {
    const key = digest(program);
    programs[key] ??= program;
    return key;
  };
  if (!input.job) return {...input, version: 7, programs};
  const {plan, executable, variants, ...journal} = input.job;
  const executableRef = reference(executable);
  return {...input, version: 7, programs, job: {
    ...journal, executableRef,
    // Events and passes are derived views of this executable, not separate programs.
    plan: {duration: plan.duration, settings: plan.settings, sourcePaths: plan.sourcePaths, layers: plan.layers, executableRef},
    variants: variants?.map(({copy, program}) => ({copy, executableRef: reference(program)})),
  }};
}

