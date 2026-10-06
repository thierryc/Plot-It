import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app design-system boundaries',()=>{
  it('keeps primitives independent of application models and controllers',()=>{
    for(const file of readdirSync(new URL('.',import.meta.url)).filter(file=>file.endsWith('.ts')&&!file.endsWith('.test.ts'))){
      const source=readFileSync(new URL(file,import.meta.url),'utf8');
      const imports=[...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map(match=>match[1]);
      expect(imports.every(path=>path?.startsWith('./')), `${file} imported outside the design-system layer`).toBe(true);
    }
  });
  it('keeps the development showcase outside production route inputs',()=>{
    const config=readFileSync(new URL('../../../vite.config.ts',import.meta.url),'utf8');
    expect(config).not.toContain('ui-components');
    const site=readFileSync(new URL('../../../site/site.ts',import.meta.url),'utf8');
    expect(site).not.toContain('design-system');
    expect(site).not.toContain('ui/app');
  });
});
