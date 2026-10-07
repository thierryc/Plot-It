import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
/** Host adapter only. The public client owns the job/control contract. */
export async function openRunnerTransport(address,origin){
 const base=new URL(address);origin??=base.origin;const url=new URL('/api/v1/ws',base);url.protocol=base.protocol==='https:'?'wss:':'ws:';
 const socket=new WebSocket(url,{headers:{Origin:origin}}),pending=new Map();let failure=null;
 const rejectAll=error=>{failure=error;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
 socket.on('error',rejectAll);socket.on('close',()=>rejectAll(new Error('Runner control disconnected; execution has not been cancelled')));
 socket.on('message',bytes=>{let result;try{result=JSON.parse(String(bytes));}catch{return;}if(result.type!=='result')return;const entry=pending.get(result.requestId);if(!entry)return;pending.delete(result.requestId);clearTimeout(entry.timer);result.ok?entry.resolve(result.value):entry.reject(new Error(result.error));});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{socket.terminate();reject(new Error('Runner connection timed out'));},5000);socket.once('open',()=>{clearTimeout(timeout);resolve();});socket.once('error',error=>{clearTimeout(timeout);reject(error);});});
 const control=request=>new Promise((resolve,reject)=>{if(failure){reject(failure);return;}const timer=setTimeout(()=>{pending.delete(request.requestId);reject(new Error('Runner request timed out; do not infer that a plot stopped'));},70000);pending.set(request.requestId,{resolve,reject,timer});socket.send(JSON.stringify(request));});
 const http=async(path,body)=>{const response=await fetch(new URL(path,base),{...(body===undefined?{}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error??`Runner HTTP ${response.status}`);return data;};
 try{await control({version:1,requestId:randomUUID(),action:'claim'});}catch(error){socket.close();throw error;}
 return{get:path=>http(path),post:(path,body)=>http(path,body),control,close:()=>socket.close()};
}
