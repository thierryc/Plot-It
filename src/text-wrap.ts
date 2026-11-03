export function normalizeTextLineBreaks(content: string): string { return content.replace(/\r\n?|\u2028|\u2029/g, '\n'); }
export interface SourceLine { text: string; start: number; end: number }
/** Automatic breaks consume spaces without changing source coordinates. */
export function wrapTextLines(content: string, width: number, measure: (text: string, start: number) => number): SourceLine[] {
  content=normalizeTextLineBreaks(content);
  const result: SourceLine[]=[];
  let paragraphStart=0;
  for(const paragraph of content.split('\n')) {
    let line='', start=paragraphStart, cursor=paragraphStart;
    const cache=new Map<string,number>();
    const fits=(text:string,at:number)=>{if(!text.trim())return true;const key=`${at}:${text}`;if(!cache.has(key))cache.set(key,measure(text,at));return cache.get(key)!<=width+1e-8;};
    for(const token of paragraph.match(/ +|[^ ]+/gu)??[]) {
      if(fits(line+token,start)) {line+=token;cursor+=token.length;continue;}
      if(line.trim()) {const text=line.replace(/ +$/,'');result.push({text,start,end:start+text.length});line='';}
      start=cursor;
      if(/^ +$/.test(token)){cursor+=token.length;start=cursor;continue;}
      let remaining=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(token)].map(p=>p.segment);
      while(remaining.length && !fits(remaining.join(''),start)) {
        let low=1,high=remaining.length;
        while(low<high){const mid=Math.ceil((low+high)/2);if(fits(remaining.slice(0,mid).join(''),start))low=mid;else high=mid-1;}
        const text=remaining.slice(0,low).join('');result.push({text,start,end:start+text.length});start+=text.length;remaining=remaining.slice(low);
      }
      line=remaining.join('');cursor+=token.length;
    }
    if(line || !result.length || result.at(-1)!.end<paragraphStart) result.push({text:line,start,end:start+line.length});
    paragraphStart+=paragraph.length+1;
  }
  return result;
}
export function wrapText(content:string,width:number,measure:(text:string)=>number):string {return wrapTextLines(content,width,measure).map(l=>l.text).join('\n');}
