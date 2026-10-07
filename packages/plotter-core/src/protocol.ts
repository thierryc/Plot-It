import { PlotterError, type ByteTransport, type Clock, type Firmware, type Observer } from './types.js';
export function firmwareFromReply(reply: string): Firmware {
  const m=reply.match(/^(?:V,)?(?:EBB|EBBv\d+_and_above EB) Firmware Version (\d+)\.(\d+)\.(\d+)(?:\b.*)?$/i);
  if(!m)throw new PlotterError('protocol','Invalid EBB firmware version.');
  const major=Number(m[1]),minor=Number(m[2]),patch=Number(m[3]);
  if([major,minor,patch].some(n=>!Number.isSafeInteger(n)||n>1000000))throw new PlotterError('protocol','Invalid EBB version component.');
  if(major!==2&&major!==3 || major===2&&(minor<8||minor===8&&patch<1))throw new PlotterError('unsupported-firmware','Plotter Core requires EBB firmware 2.8.1 through supported 3.x.');
  return {major,minor,patch,version:`${major}.${minor}.${patch}`,modern:major===3};
}
export function ascii(text: string): Uint8Array { return Uint8Array.from([...text].map(c=>c.charCodeAt(0))); }
export function text(bytes: Uint8Array): string { return Array.from(bytes,c=>String.fromCharCode(c)).join(''); }
/** Single exchange owner: queries cannot steal replies from motion commands. */
export class EbbProtocol {
  private buffer='';private pendingLf=false;
  get healthy():boolean{return !this.failed;} private chain:Promise<unknown>=Promise.resolve(); private failed=false;
  private rejectActive:((error:Error)=>void)|null=null;
  constructor(private transport:ByteTransport,private clock:Clock,private observe:Observer=()=>{}) {}
  private emit(command:string,phase:'requested'|'written'|'received'|'acknowledged'|'failed',response?:string,error?:string):void {
    try{const result=this.observe({kind:'exchange',timeMs:this.clock.now(),command,phase,response,error});if(result)void result.catch(()=>{});}catch{}
  }
  private async line(command:string,allowEmpty=false):Promise<string> {
    for(;;) {
      if(this.pendingLf&&this.buffer.length){if(this.buffer[0]==='\n')this.buffer=this.buffer.slice(1);this.pendingLf=false;}
      const separator=this.buffer.search(/[\r\n]/);
      if(separator>=0) {
        if(separator>4096)throw new PlotterError('protocol','EBB response limit exceeded.');
        const raw=this.buffer.slice(0,separator),line=command==='QT'?raw:raw.trim();this.pendingLf=this.buffer[separator]==='\r';this.buffer=this.buffer.slice(separator+1);
        if(!line&&!allowEmpty)continue;
        this.emit(command,'received',line);
        if(line.startsWith('!'))throw new PlotterError('rejected',`Plotter rejected ${command}: ${line}`);
        return line;
      }
      if(this.buffer.length>4096)throw new PlotterError('protocol','EBB response limit exceeded.');
      const chunk=await this.transport.read();
      if(chunk===null)throw new PlotterError('disconnected','The plotter disconnected.');
      this.buffer+=text(chunk);
    }
  }
  request(command:string):Promise<string> {
    const task=this.chain.then(async()=>{
      let cancel=()=>{};
      const timeoutMs=/^(SM|SP|T3|TD),/.test(command)?70000:5000;
      const timeout=new Promise<never>((_,reject)=>{cancel=this.clock.schedule(timeoutMs,()=>{this.failed=true;void this.transport.close().catch(()=>{});reject(new PlotterError('timeout',`EBB response timed out for ${command}.`));});});
      const disconnected=new Promise<never>((_,reject)=>{this.rejectActive=reject;});
      try{return await Promise.race([this.exchange(command),timeout,disconnected]);}finally{cancel();this.rejectActive=null;}
    }); this.chain=task.catch(()=>{}); return task;
  }
  private async exchange(command:string):Promise<string> {
    if(this.failed)throw new PlotterError('disconnected','The EBB connection needs reconnecting.');
    if(!/^[A-Z][A-Z0-9]*(?:,(?:[+-]?\d+|B))*$/.test(command)&&!/^ST,[A-Za-z0-9 _-]{0,16}$/.test(command))throw new PlotterError('protocol','Invalid serial command.');
    this.emit(command,'requested');
    try {
      await this.transport.write(ascii(`${command}\r`)); this.emit(command,'written');
      if(command==='CU,10,1'){
        // Legacy -> future transition may reply with only LF. Synchronize on V
        // within the same serial-owner exchange instead of waiting for an ACK.
        await this.transport.write(ascii('V\r'));let reply=await this.line(command),remaining=4;
        while(['CU','OK','CUOK'].includes(reply)&&remaining-->0)reply=await this.line(command);
        firmwareFromReply(reply);this.emit(command,'acknowledged');return reply;
      }
      const name=command.split(',')[0]!, first=await this.line(command,command==='QT');
      let result=first;
      if(name==='V') { if(!/^(?:V,)?EBB/.test(first))throw new PlotterError('protocol',`Unexpected V response: ${first}`); }
      else if(name==='QS'||name==='QC'||name==='QE') {
        if(!first.startsWith(`${name},`)) {
          if(!/^[+-]?\d+,[+-]?\d+$/.test(first))throw new PlotterError('protocol',`Unexpected ${name} response: ${first}`);
          const end=await this.line(command); if(end!=='OK')throw new PlotterError('protocol',`Unexpected ${name} terminator: ${end}`);
        }
      } else if(name==='QU'){
        if(!/^QU,\d+$/.test(first))throw new PlotterError('protocol',`Unexpected QU response: ${first}`);
      } else if(name==='PI'){
        if(!/^PI,[01]$/.test(first))throw new PlotterError('protocol',`Unexpected PI response: ${first}`);
      } else if(name==='QT'){
        if(!first.startsWith('QT,')){if(first.length>16||await this.line(command)!=='OK')throw new PlotterError('protocol','Invalid nickname reply.');}
      } else if(name==='QG') { if(!/^(?:QG,)?[a-f\d]{2}$/i.test(first))throw new PlotterError('protocol',`Unexpected QG response: ${first}`); }
      else if(name==='ES') {
        if(first==='OK') {
          // Some firmware paths acknowledge without an interruption payload. No reset
          // is necessary; synchronize on V before issuing another configuration write.
          await this.transport.write(ascii('V\r'));
          let marker=await this.line(command),limit=4;
          while(marker==='OK'&&limit-->0)marker=await this.line(command);
          if(/^[01](?:,[+-]?\d+){0,4}$/.test(marker)) {
            result=marker; if(await this.line(command)!=='OK')throw new PlotterError('protocol','Unexpected emergency-stop terminator.');
            marker=await this.line(command);
          }else throw new PlotterError('protocol','Unexpected emergency-stop response: missing ES status.');
          firmwareFromReply(marker);
        } else if(/^[01](?:,[+-]?\d+){0,4}$/.test(first)) {
          if(await this.line(command)!=='OK')throw new PlotterError('protocol','Unexpected emergency-stop terminator.');
        } else if(!/^ES(?:,[01])?$/.test(first))throw new PlotterError('protocol',`Unexpected emergency-stop response: ${first}`);
      } else if(first!=='OK'&&first!==name)throw new PlotterError('protocol',`Unexpected response to ${command}: ${first}`);
      this.emit(command,'acknowledged'); return result;
    } catch(error) { this.failed=!(error instanceof PlotterError&&error.code==='rejected');this.emit(command,'failed',undefined,String(error));if(this.failed)void this.transport.close().catch(()=>{});throw error; }
  }
  async close():Promise<void> {this.failed=true;this.rejectActive?.(new PlotterError('disconnected','The plotter disconnected.'));await this.transport.close();}
  settled(command:string):void{try{const result=this.observe({kind:'exchange',timeMs:this.clock.now(),command,phase:'settled'});if(result)void result.catch(()=>{});}catch{}}
}
