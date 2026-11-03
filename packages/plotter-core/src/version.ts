/** Shared admission/capability identity; changes require fresh preparation. */
export const COMPILER_VERSION='native-v5';
/** Preserve the existing T3 and compatibility-SM executable identity. */
export const PLANNING_MODEL='axi-ca-junction-v1';
export const SM_CRUISE_MODEL='axi-ca-sm-cruise100-v1';
export const DYNAMIC_PLANNING_MODEL='dynamic-scurve-flow-v1';
export function planningModelFor(backend:'sm'|'t3'|undefined,firmware?:string,strategy?:'standard'|'dynamic'):string {
  if(strategy==='dynamic')return DYNAMIC_PLANNING_MODEL;
  return backend!=='t3'&&firmware==='3.1.7'?SM_CRUISE_MODEL:PLANNING_MODEL;
}
export const PEN_TIMING_MODEL='ebb-pulse-v1';
