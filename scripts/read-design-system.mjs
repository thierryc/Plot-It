/** Read-only handoff for explicit Figma refreshes. Never generates application CSS. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function readDesignSystem() {
  const css=readFileSync(new URL('../src/ui/design-system/tokens.css',import.meta.url),'utf8');
  const blocks=[...css.matchAll(/(:root[^{}]*)\{([^{}]*)\}/g)];
  const declarations=body=>Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([,key,value])=>[key,value.trim()]));
  const light=declarations(blocks[0][2]);
  const dark={...light,...declarations(blocks.find(([all])=>all.includes('data-theme="dark"'))[2])};
  const touch=declarations(blocks.find(([,selector,body])=>!selector.includes('data-theme')&&body.includes('--slider-hit-size:var(--touch-target)'))[2]);
  const resolve=(values,key,seen=new Set())=>{
    if(seen.has(key)||!(key in values))throw new Error(`Unresolved design token: ${key}`);
    const value=values[key],alias=value.match(/^var\((--[\w-]+)\)$/);
    if(!alias)return value;
    return resolve(values,alias[1],new Set([...seen,key]));
  };
  const colors=Object.keys(light).filter(key=>/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(resolve(light,key))).map(key=>({css:key,light:resolve(light,key),dark:resolve(dark,key)}));
  const metrics=Object.keys(light).filter(key=>!key.startsWith('--layer-')&&!key.startsWith('--motion-')&&!key.startsWith('--plotter-backdrop-')&&/^-?\d+(?:\.\d+)?(?:px)?$/.test(resolve(light,key))).map(key=>({css:key,desktop:Number.parseFloat(resolve(light,key)),touch:Number.parseFloat(resolve({...light,...touch},key))}));
  const motion=Object.keys(light).filter(key=>key.startsWith('--motion-')).map(key=>({css:key,value:resolve(light,key)}));
  const effects=Object.keys(light).filter(key=>key.startsWith('--plotter-backdrop-')).map(key=>({css:key,light:resolve(light,key),dark:resolve(dark,key)}));
  return {source:'src/ui/design-system/tokens.css',font:{css:'var(--font-ui)',family:'SF Pro',styles:['Regular','Medium','Semibold']},colors,metrics,motion,effects};
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(readDesignSystem(),null,2)+'\n');
