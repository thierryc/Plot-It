import {SerialPort} from 'serialport';
import type {ByteTransport,Clock} from './types.js';
export const nodeClock:Clock={now:()=>performance.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),schedule:(ms,callback)=>{const timer=setTimeout(callback,ms);return()=>clearTimeout(timer);}};
export async function listEbbPorts():Promise<{path:string;serialNumber?:string}[]>{return(await SerialPort.list()).filter(p=>p.vendorId?.toLowerCase()==='04d8'&&p.productId?.toLowerCase()==='fd92').map(p=>({path:p.path,serialNumber:p.serialNumber}));}
/** Explicit path avoids silently taking another user's connected plotter. */
export async function openNodeTransport(path:string):Promise<ByteTransport>{
  const port=new SerialPort({path,baudRate:9600,autoOpen:false,lock:true});
  const chunks:Uint8Array[]=[];let waiting:{resolve:(bytes:Uint8Array|null)=>void;reject:(error:Error)=>void}|null=null,bytes=0,closed=false,failure:Error|null=null;
  const listeners=new Set<()=>void>();
  port.on('data',(chunk:Buffer)=>{if(waiting){const reader=waiting;waiting=null;reader.resolve(new Uint8Array(chunk));}else{chunks.push(new Uint8Array(chunk));bytes+=chunk.length;if(bytes>65536)port.pause();}});
  port.on('error',(error:Error)=>{failure=error;waiting?.reject(error);waiting=null;});
  port.on('close',()=>{closed=true;waiting?.resolve(null);waiting=null;for(const listener of listeners)listener();});
  await new Promise<void>((resolve,reject)=>port.open(error=>error?reject(error):resolve()));
  return{
    read:async()=>{if(failure)throw failure;if(chunks.length){const chunk=chunks.shift()!;bytes-=chunk.length;if(bytes<32768)port.resume();return chunk;}if(closed)return null;return new Promise((resolve,reject)=>{if(waiting)throw new Error('Only one reader may own the transport.');waiting={resolve,reject};});},
    write:chunk=>new Promise<void>((resolve,reject)=>{if(closed){reject(new Error('USB disconnected'));return;}port.write(chunk,error=>error?reject(error):resolve());}),
    onDisconnect:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    close:async()=>{if(!closed&&port.isOpen)await new Promise<void>((resolve,reject)=>port.close(error=>error?reject(error):resolve()));},
  };
}
