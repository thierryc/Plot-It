import type {PlotSettings} from './model';
/** Shared file/network/worker admission of the new optional controls. */
export function validateExtendedSettings(s:PlotSettings):void {
 for(const key of ['automaticPlacement','pageClipping','hiddenLineRemoval','strictOrder','synchronizedB3','varyClosedStarts'] as const)if(s[key]!==undefined&&typeof s[key]!=='boolean')throw new Error(`Invalid ${key}`);
 if(s.servoTimeoutMs!==undefined&&(!Number.isInteger(s.servoTimeoutMs)||s.servoTimeoutMs<0||s.servoTimeoutMs>65535))throw new Error('Invalid servo timeout');
 if(s.jogStepMm!==undefined&&(!Number.isFinite(s.jogStepMm)||s.jogStepMm<.01||s.jogStepMm>10))throw new Error('Invalid jog distance');
 if(s.axidrawHardwareModel!==undefined&&!['v3-a4','v3-a3'].includes(s.axidrawHardwareModel))throw new Error('Invalid AxiDraw hardware model');
 if(s.nextdrawServo!==undefined&&!['standard','brushless'].includes(s.nextdrawServo))throw new Error('Invalid pen servo');
 if(s.previewFilter!==undefined&&!['draw','travel','all'].includes(s.previewFilter))throw new Error('Invalid preview filter');
 if(s.startAtMm!==undefined&&(!Number.isFinite(s.startAtMm)||s.startAtMm<0||s.startAtMm>1e12))throw new Error('Invalid drawing start distance');
 if(s.curveToleranceMm!==undefined&&(!Number.isFinite(s.curveToleranceMm)||s.curveToleranceMm<.001||s.curveToleranceMm>10))throw new Error('Invalid curve accuracy');
 if(s.varyClosedStarts&&s.startAtMm)throw new Error('Varied closed starts cannot be combined with resume distance');
 if(s.layerOverrides!==undefined){if(!s.layerOverrides||typeof s.layerOverrides!=='object'||Array.isArray(s.layerOverrides)||Object.keys(s.layerOverrides).length>10000)throw new Error('Invalid layer controls');for(const [id,o]of Object.entries(s.layerOverrides)){if(id.length>256||!o||typeof o!=='object')throw new Error('Invalid layer identity');for(const key of ['included','pause']as const)if(o[key]!==undefined&&typeof o[key]!=='boolean')throw new Error('Invalid layer flag');for(const [key,min,max]of [['speedPercent',1,110],['penDown',0,100],['delayMs',0,86400000]]as const){const n=o[key];if(n!==undefined&&(!Number.isFinite(n)||n<min||n>max||key==='delayMs'&&!Number.isInteger(n)))throw new Error(`Invalid layer ${key}`);}}}
}
