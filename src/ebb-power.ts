export interface PowerStatus {
  state: 'ok' | 'low' | 'unavailable';
  supplyRaw: number | null;
  referenceRaw: number | null;
  checkedAt: number;
  message: string;
}
export const POWER_LOW_THRESHOLD = 250;
/** QC reports raw ADC values; board revisions have different dividers, so do not invent volts. */
export function parsePowerStatus(response: string, checkedAt = Date.now()): PowerStatus {
  const match = response.match(/^(?:QC,)?(\d{1,4}),(\d{1,4})$/);
  if (!match || [match[1],match[2]].some(value=>Number(value)>1023)) return unavailablePower('Supply reading unavailable.',checkedAt);
  const referenceRaw=Number(match[1]), supplyRaw=Number(match[2]), low=supplyRaw<POWER_LOW_THRESHOLD;
  return {state:low?'low':'ok',referenceRaw,supplyRaw,checkedAt,message:low?'Motor supply is low or missing. Check the power adapter and cable before plotting.':'Motor supply detected.'};
}
export function unavailablePower(message = 'Supply has not been checked.',checkedAt=0): PowerStatus {
  return {state:'unavailable',referenceRaw:null,supplyRaw:null,checkedAt,message};
}
export function powerStatusLabel(power: PowerStatus): string {
  return `${power.message}${power.supplyRaw===null?'':` Supply ADC ${power.supplyRaw}/1023.`}`;
}
