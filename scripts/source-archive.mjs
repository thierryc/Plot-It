import './check-bundled-fonts.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
// Include all corresponding source and build instructions, excluding generated archives.
const publicFiles=readdirSync('public').filter(name=>name!=='plot-it-source.tar.gz').map(name=>`public/${name}`);
execFileSync('tar',['--exclude=private-fonts','--exclude=*/private-fonts','--exclude=packages/*/node_modules','--exclude=packages/*/dist','--exclude=macos/.build','--exclude=macos/.swiftpm','--exclude=.DS_Store','--exclude=._*','--exclude=*.tsbuildinfo','-czf','public/plot-it-source.tar.gz','packages','src','server','companion','macos','site','deploy','.github','.gitignore','.nvmrc','tsconfig.server.json','tsconfig.companion.json','docs','scripts','README.md','CONTRIBUTING.md','CONTRIBUTORS.md','CHANGELOG.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','virtual.html',...publicFiles],{env:{...process.env,COPYFILE_DISABLE:'1'}});
