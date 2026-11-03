import type { SerialTransport } from '../../src/plotter-core';
import { EventTarget, Event } from '../transport-events';
export function fakeTransport(version = '2.8.1', onCommand?: (command: string) => Promise<void> | void, replyFor?: (command: string) => string | undefined): { transport: SerialTransport; commands: string[]; disconnect(): void } {
  const commands: string[] = [];
  let disconnected = false;
  let m1=0,m2=0,penUp=true;
  let upPulse=21850;
  let future=false,fifoCapacity=1;
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const port = {
    readable: new ReadableStream<Uint8Array>({ start(c) { input = c; } }),
    writable: new WritableStream<Uint8Array>({ async write(bytes) {
      const command = new TextDecoder().decode(bytes).trim(); commands.push(command);
      await onCommand?.(command);
      if (disconnected) throw new Error('USB disconnected');
      if(command==='CS'){m1=m2=0;}if(command.startsWith('SM,')){const parts=command.split(',').map(Number);m1+=parts[2]!;m2+=parts[3]!;}
      if(command.startsWith('SP,'))penUp=Number(command.split(',')[1])!==0;
      if(command.startsWith('SC,4,'))upPulse=Number(command.split(',')[2]);
      if(command.startsWith('S2,')&&Number(command.split(',')[1])>0)penUp=Number(command.split(',')[1])===upPulse;
      const name=command.split(',')[0]!,wasFuture=future;
      if(command==='CU,10,1')future=true;
      if(command==='CU,10,0')future=false;
      if(command.startsWith('CU,4,'))fifoCapacity=Math.min(32,Math.max(1,Number(command.split(',')[2])));
      const query=(payload:string,terminator=false)=>future?`${name},${payload}`:payload+(terminator?'\r\nOK':'');
      const defaultResponse=command==='CU,10,1'?(wasFuture?'CU':'')
        :command==='CU,10,0'?(wasFuture?'CUOK':'OK')
        :command==='V'?query(`EBB Firmware Version ${version}`)
        :command==='QC'?query('0394,0300',true)
        :command==='QS'?query(`${m1},${m2}`,true)
        :command==='QG'?query(penUp?'10':'00')
        :command==='QM'?'QM,0,0,0,0'
        :command==='QU,2'?'QU,32'
        :command==='QU,3'?`QU,${fifoCapacity}`
        :command.startsWith('QU,')?'!unsupported utility query'
        :command==='ES,1'?query('1',true)
        :/^(ES|ES,0)$/.test(command)?query('0',true)
        :future?name:'OK';
      const response = replyFor?.(command) ?? defaultResponse;
      // Fragment both legacy CR/LF and modern LF reply endings.
      for (const chunk of [response,...(future?['\n']:['\r','\n'])]) input.enqueue(new TextEncoder().encode(chunk));
    } }),
    async open() {}, async close() {}, getInfo: () => ({ usbVendorId: 0x04d8, usbProductId: 0xfd92 }),
  };
  const transport = Object.assign(new EventTarget(), { supported: true, requestPort: async () => port });
  return { commands, transport, disconnect() { disconnected = true; input.error(new Error('USB disconnected')); transport.dispatchEvent(new Event('disconnect', port)); } };
}
