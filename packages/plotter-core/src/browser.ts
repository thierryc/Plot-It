import type {ByteTransport,Clock} from './types.js';
export interface BrowserSerialPort {
  readable:ReadableStream<Uint8Array>|null;writable:WritableStream<Uint8Array>|null;
  open(options:{baudRate:number}):Promise<void>;close():Promise<void>;
  addEventListener?(type:'disconnect',listener:()=>void):void;
  removeEventListener?(type:'disconnect',listener:()=>void):void;
}
export const browserClock:Clock={now:()=>performance.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),schedule:(ms,callback)=>{const timer=setTimeout(callback,ms);return()=>clearTimeout(timer);}};
/** Port selection/permission belongs to the caller's user action. */
export async function openBrowserTransport(port:BrowserSerialPort):Promise<ByteTransport>{
  await port.open({baudRate:9600});
  if(!port.readable||!port.writable){await port.close();throw new Error('The serial port did not open correctly.');}
  const reader=port.readable.getReader(),writer=port.writable.getWriter();let closed=false;
  return{read:async()=>{const result=await reader.read();return result.done?null:result.value;},write:bytes=>writer.write(bytes),onDisconnect:listener=>{port.addEventListener?.('disconnect',listener);return()=>port.removeEventListener?.('disconnect',listener);},close:async()=>{if(closed)return;closed=true;await reader.cancel().catch(()=>{});reader.releaseLock();writer.releaseLock();await port.close();}};
}
