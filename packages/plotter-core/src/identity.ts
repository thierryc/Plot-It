import {PlotterError} from './types.js';
export function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
export function canonical(value:unknown):string {
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))throw new PlotterError('invalid-plan','Nonfinite snapshot value.');return JSON.stringify(value);}
 if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return`{${Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
 throw new PlotterError('invalid-plan','Snapshot contains unsupported data.');
}
const primes:number[]=[];for(let n=2;primes.length<64;n++){if(primes.every(p=>n%p))primes.push(n);}
const K=primes.map(p=>Math.floor((Math.cbrt(p)%1)*2**32)>>>0),initial=primes.slice(0,8).map(p=>Math.floor((Math.sqrt(p)%1)*2**32)>>>0);
const rotate=(v:number,n:number)=>(v>>>n)|(v<<(32-n));
/** Portable SHA-256. No WebCrypto/Node imports in the pure package. */
export function sha256(text:string):string {
 const bytes:number[]=[];for(const char of text){let c=char.codePointAt(0)!;if(c>=0xd800&&c<=0xdfff)c=0xfffd;if(c<128)bytes.push(c);else if(c<2048)bytes.push(192|(c>>6),128|(c&63));else if(c<65536)bytes.push(224|(c>>12),128|((c>>6)&63),128|(c&63));else bytes.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));}
 const bits=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);const high=Math.floor(bits/2**32),low=bits>>>0;for(const word of [high,low])for(let i=3;i>=0;i--)bytes.push((word>>>(8*i))&255);
 const hash=[...initial],w=new Array<number>(64);
 for(let start=0;start<bytes.length;start+=64){for(let i=0;i<16;i++)w[i]=((bytes[start+i*4]!<<24)|(bytes[start+i*4+1]!<<16)|(bytes[start+i*4+2]!<<8)|bytes[start+i*4+3]!)>>>0;
  for(let i=16;i<64;i++){const a=w[i-15]!,b=w[i-2]!;w[i]=(w[i-16]!+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]!+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,h]=hash as [number,number,number,number,number,number,number,number];
  for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]!+w[i]!)>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  for(const [i,v]of [a,b,c,d,e,f,g,h].entries())hash[i]=(hash[i]!+v)>>>0;
 }
 return hash.map(v=>v.toString(16).padStart(8,'0')).join('');
}
export function digest(value:unknown):string{return sha256(canonical(value));}
