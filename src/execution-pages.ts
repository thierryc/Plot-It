import type {ExecutablePlan,ExecutionRecord} from '@thierryc/plotter-core';
/** Host transport limits, unrelated to the controller's FIFO or physical stops. */
export const EXECUTION_PAGE_RECORDS=256;
export const EXECUTION_PAGE_BYTES=64*1024;
export interface PlanHeader {recordCount:number;metadataBytes:number}
export interface MetadataPage {index:number;digest:string;bytes:ArrayBuffer}
export interface ExecutionPage {index:number;firstRecordId:number;count:number;digest:string;bytes:ArrayBuffer}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
async function digest(bytes:ArrayBuffer):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
function encodedMetadata(plan:ExecutablePlan):Uint8Array {
 const {records:_records,...metadata}=plan;
 return encoder.encode(JSON.stringify(metadata));
}
export function planHeader(plan:ExecutablePlan):PlanHeader {
 return {recordCount:plan.records.length,metadataBytes:encodedMetadata(plan).byteLength};
}
/** Metadata (including checkpoint previews) follows the same bounded ACK path. */
export async function* metadataPages(plan:ExecutablePlan):AsyncGenerator<MetadataPage> {
 const encoded=encodedMetadata(plan);
 for(let offset=0,index=0;offset<encoded.byteLength;offset+=EXECUTION_PAGE_BYTES,index++){
  const bytes=encoded.slice(offset,offset+EXECUTION_PAGE_BYTES).buffer;
  yield {index,digest:await digest(bytes),bytes};
 }
}
/** Snapshot each record before yielding. No queue drain or native accumulator reset. */
export async function* executionPages(records:readonly ExecutionRecord[]):AsyncGenerator<ExecutionPage>{
 let parts:string[]=[],size=2,index=0,firstRecordId=0;
 async function page():Promise<ExecutionPage>{const bytes=encoder.encode(`[${parts.join(',')}]`).buffer;return{index:index++,firstRecordId,count:parts.length,digest:await digest(bytes),bytes};}
 for(const record of records){
  const json=JSON.stringify(record),length=encoder.encode(json).byteLength;
  if(length+2>EXECUTION_PAGE_BYTES)throw new Error('One executable record exceeds the host page budget.');
  if(parts.length&&(parts.length===EXECUTION_PAGE_RECORDS||size+1+length>EXECUTION_PAGE_BYTES)){yield await page();parts=[];size=2;}
  if(!parts.length)firstRecordId=record.id;
  size+=length+(parts.length?1:0);parts.push(json);
 }
 if(parts.length)yield await page();
}
/** One assembly at a time; received bytes are released after each acknowledged page. */
export class PlanPageReceiver {
 private header:PlanHeader|null=null;private records:ExecutionRecord[]=[];private nextPage=0;
 private metadata:Omit<ExecutablePlan,'records'>|null=null;private metadataText='';private metadataReceived=0;private nextMetadataPage=0;
 private metadataDecoder=new TextDecoder('utf-8',{fatal:true});
 begin(header:PlanHeader):void {
  if(this.header)throw new Error('An executable transfer is already active.');
  if(!Number.isInteger(header.recordCount)||header.recordCount<1||header.recordCount>1e6||!Number.isSafeInteger(header.metadataBytes)||header.metadataBytes<1||encoder.encode(JSON.stringify(header)).byteLength>EXECUTION_PAGE_BYTES)throw new Error('Invalid executable header.');
  this.header={...header};
 }
 async appendMetadata(page:MetadataPage):Promise<void>{
  const header=this.header;
  const valid=()=>header!==null&&this.header===header&&page.index===this.nextMetadataPage&&this.records.length===0&&!this.metadata&&page.bytes instanceof ArrayBuffer&&page.bytes.byteLength>0&&page.bytes.byteLength<=EXECUTION_PAGE_BYTES&&this.metadataReceived+page.bytes.byteLength<=header.metadataBytes;
  if(!valid()||await digest(page.bytes)!==page.digest||!valid())throw new Error('Invalid executable metadata page order, budget or digest.');
  const complete=this.metadataReceived+page.bytes.byteLength===header!.metadataBytes;
  const text=this.metadataText+this.metadataDecoder.decode(page.bytes,{stream:!complete});
  if(complete){
   const metadata=JSON.parse(text);
   if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||'records' in metadata)throw new Error('Invalid executable metadata.');
   this.metadata=metadata;this.metadataText='';
  }else this.metadataText=text;
  this.metadataReceived+=page.bytes.byteLength;this.nextMetadataPage++;
 }
 async append(page:ExecutionPage):Promise<void>{
  const header=this.header;
  const valid=()=>header!==null&&this.header===header&&this.metadata!==null&&page.index===this.nextPage&&page.firstRecordId===this.records.length&&Number.isInteger(page.count)&&page.count>=1&&page.count<=EXECUTION_PAGE_RECORDS&&page.bytes instanceof ArrayBuffer&&page.bytes.byteLength<=EXECUTION_PAGE_BYTES;
  if(!valid()||await digest(page.bytes)!==page.digest||!valid())throw new Error('Invalid executable page order, budget or digest.');
  const records=JSON.parse(decoder.decode(page.bytes)) as ExecutionRecord[];
  if(!Array.isArray(records)||records.length!==page.count||this.records.length+records.length>header!.recordCount||records.some((r,i)=>r.id!==page.firstRecordId+i))throw new Error('Invalid executable record identity.');
  this.records.push(...records);this.nextPage++;
 }
 finish():ExecutablePlan {
  if(!this.header||!this.metadata||this.records.length!==this.header.recordCount)throw new Error('Incomplete executable transfer.');
  const plan={...this.metadata,records:this.records};this.clear();return plan;
 }
 clear():void{this.header=null;this.records=[];this.nextPage=0;this.metadata=null;this.metadataText='';this.metadataReceived=0;this.nextMetadataPage=0;this.metadataDecoder=new TextDecoder('utf-8',{fatal:true});}
}
