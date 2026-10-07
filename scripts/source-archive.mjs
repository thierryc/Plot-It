import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
// Include all corresponding source and build instructions, excluding generated archives.
const publicFiles=readdirSync('public').filter(name=>name!=='plot-it-source.tar.gz').map(name=>`public/${name}`);
execFileSync('tar',['--exclude=packages/*/node_modules','--exclude=packages/*/dist','-czf','public/plot-it-source.tar.gz','packages','src','server','site','deploy','.github','.nvmrc','tsconfig.server.json','docs','scripts','README.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','virtual.html',...publicFiles]);
