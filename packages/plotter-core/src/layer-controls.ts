import {PlotterError} from './types.js';
/** Documented layer annotations. +S uses vendor percentages, typed speed uses mm/s. */
export interface LayerControls {number:number|null;documentation:boolean;pause:boolean;delayMs:number;speedPercent?:number;penDown?:number;optimization?:0|1|2|3|4;handlingMetadata?:1|2|3|4;label:string}
export function parseLayerControls(label:string):LayerControls {
 if(label.length>4096)throw new PlotterError('invalid-plan','Layer label is too long.');let rest=label.trim(),pause=false;
 if(rest.startsWith('%'))return{number:null,documentation:true,pause:false,delayMs:0,label:rest.slice(1)};
 if(rest.startsWith('!')){pause=true;rest=rest.slice(1);}const number=rest.match(/^\d+/);if(number)rest=rest.slice(number[0].length);
 const result:LayerControls={number:number?Number(number[0]):null,documentation:false,pause,delayMs:0,label:''};
 for(;;){const token=rest.match(/^\+([hSdMg])(\d+)/i);if(!token)break;rest=rest.slice(token[0].length);const value=Number(token[2]);switch(token[1]!.toLowerCase()){
  case'd':if(value>86400000)throw new PlotterError('invalid-plan','Layer delay exceeds one day.');result.delayMs=value;break;
  case'h':if(value>100)throw new PlotterError('invalid-plan','Invalid layer height.');result.penDown=value;break;
  case's':if(value<1||value>110)throw new PlotterError('invalid-plan','Invalid layer speed percent.');result.speedPercent=value;break;
  case'g':if(value>4)throw new PlotterError('invalid-plan','Invalid layer optimization.');result.optimization=value as 0|1|2|3|4;break;
  case'm':if(value<1||value>4)throw new PlotterError('invalid-plan','Invalid layer handling metadata.');result.handlingMetadata=value as 1|2|3|4;break;
 }}result.label=rest;return result;
}
