import './check-runtime.mjs';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync,chmodSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Offline packaging only. This script never imports a transport, opens USB,
// launches a server or browser, or writes physical results.
const project=resolve('.'),build=join(project,'dist-browser');
if(!existsSync(join(build,'index.html')))throw new Error('Build the current browser distribution before packaging.');
const date=new Date().toISOString().slice(0,10),name='plot-it-dynamic-test-kit',directory=join(project,'output',name),archive=`${directory}.zip`;
const hash=data=>createHash('sha256').update(data).digest('hex');
function files(root){return readdirSync(root).sort().flatMap(name=>{const file=join(root,name);return statSync(file).isDirectory()?files(file):[file];});}
const buildFiles=files(build).map(file=>({file:relative(build,file).split('\\').join('/'),sha256:hash(readFileSync(file)),bytes:statSync(file).size}));
const buildFingerprint=hash(JSON.stringify(buildFiles));
const sourceFiles=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:project,encoding:'utf8'}).split('\0').filter(Boolean)
 .filter(file=>/^(src\/|packages\/|scripts\/|docs\/|public\/licenses\/)/.test(file)||/^(package(-lock)?\.json|index\.html|vite\.config\.ts|tsconfig[^/]*\.json|\.nvmrc|LICENSE|THIRD_PARTY_NOTICES\.md)$/.test(file))
 .filter(file=>existsSync(join(project,file))&&statSync(join(project,file)).isFile()).sort()
 .map(file=>({file,sha256:hash(readFileSync(join(project,file)))}));
const sourceFingerprint=hash(JSON.stringify(sourceFiles));
rmSync(directory,{recursive:true,force:true});mkdirSync(directory,{recursive:true});
cpSync(build,join(directory,'candidate'),{recursive:true});
// Keep the complete documentation tree so both sibling-fixture reuse links and
// ../../ compatibility/control references resolve inside the extracted kit.
cpSync(join(project,'docs'),join(directory,'docs'),{recursive:true});
mkdirSync(join(directory,'results'),{recursive:true});
for(const extension of ['md','csv'])cpSync(join(directory,'docs','validation',`results-template.${extension}`),join(directory,'results',`results-template.${extension}`));
writeFileSync(join(directory,'results','README.txt'),'Blank result forms only. Copy for each actual configuration and record every attempt. No physical test has been performed by packaging.\n');
const manifest={format:'plot-it-dynamic-test-kit-v1',preparedAt:new Date().toISOString(),plannedDate:date,timezone:'America/New_York',physicalStatus:'not-run',physicalCommandsSent:false,
 target:{machine:'XyloDraw',firmware:'3.1.7',backend:'t3',nativeCommands:['T3','TD'],strategies:['standard','dynamic']},
 gitRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:project,encoding:'utf8'}).trim(),
 sourceFingerprint,buildFingerprint,sourceFiles,buildFiles,
 limitations:'Fingerprints identify packaged files. Software verification is recorded separately; packaging does not establish contact, physical quality or support. Record the actual connected firmware and calibrated setup.'};
writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(directory,'run-tests.command'),`#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")/candidate"
printf '%s\\n' 'Plot-It modern T3 test app: http://127.0.0.1:8893/' 'Open manually in Chrome or Edge. No USB or browser opens automatically.' 'Keep this window open. Ctrl+C stops this server.'
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server 8893 --bind 127.0.0.1
fi
printf '%s\\n' 'Python3 is required for this optional launch helper. Serve candidate/ with your local static server instead.'
exit 1
`);
chmodSync(join(directory,'run-tests.command'),0o755);
writeFileSync(join(directory,'README.md'),`# Plot-It modern T3 / Dynamic test kit

Prepared for ${date}, America/New_York. **Physical status: not-run.**

This kit contains one browser app. Compare **Standard T3 versus Dynamic T3 in this
same build**, on EBB3.1.7. Standard remains the app default. Explicitly select
S-curve/EBB3.1.7 and Accelerated drawing for the modern session. Record the actual
connected firmware and working physical settings. Packaging opens no hardware.

1. Extract this archive to a local folder. Launch **run-tests.command**; it requires
   Python3, serves only localhost:8893 and opens neither USB nor a browser.
2. Open [the app](http://127.0.0.1:8893/) manually in desktop Chrome/Edge. Keep the
   terminal open; Ctrl+C stops it. If the port is busy, close the previous server.
3. Follow [the hardware procedure](docs/validation/README.md) and the
   [same-build comparison](docs/validation/dynamic-acceptance/README.md).
4. Restore each fixture’s documented size and use your actual calibrated settings.
   Save matched Standard/Dynamic documents and retain every log and photograph.
5. Record each run in the blank forms in results/. Packaging supplies no physical
   result or calibration preset.

Different browser origins have separate storage. Export/import editable documents
and verify all settings; do not assume another app's calibration follows this port.
Only one app/runner may own the board. Connect and start manually when ready.

Build fingerprint: ${buildFingerprint}

Source fingerprint: ${sourceFingerprint}

See manifest.json for the exact included build/source file hashes.
These fingerprints do not claim physical acceptance.
`);
rmSync(archive,{force:true});execFileSync('zip',['-q','-r',archive,name],{cwd:join(project,'output')});
const archiveSha256=hash(readFileSync(archive));writeFileSync(`${archive}.sha256`,`${archiveSha256}  ${name}.zip\n`);
console.info(JSON.stringify({directory,archive,archiveSha256,buildFingerprint,sourceFingerprint,physicalStatus:'not-run'},null,2));
