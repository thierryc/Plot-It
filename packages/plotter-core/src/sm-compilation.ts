import type {ExecutablePlan} from './types.js';
// Internal, ephemeral compiler evidence. External/serialized executable plans
// never acquire a certificate, and admission never consults this map.
type Evidence=Readonly<{certified:boolean;baseline:ExecutablePlan}>;
const evidence=new WeakMap<ExecutablePlan,Evidence>();
export function smCompilation(plan:ExecutablePlan):Evidence|undefined{return evidence.get(plan);}
export function rememberSMCompilation(plan:ExecutablePlan,certified:boolean,baseline:ExecutablePlan):void{evidence.set(plan,Object.freeze({certified,baseline}));}
