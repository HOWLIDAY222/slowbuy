import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const core=readFileSync(resolve(root,'dist/core.mjs'),'utf8').replace(/^export /gm,'');
const app=readFileSync(resolve(root,'dist/app.js'),'utf8').replace(/^import[^\n]+\n/,'');
const script='(()=>{\n"use strict";\n'+core+'\n'+app+'\n})();\n';
writeFileSync(resolve(root,'dist/script.js'),script);
if(process.argv[2]){
  const css=readFileSync(resolve(root,'dist/styles.css'),'utf8');
  const favicon=readFileSync(resolve(root,'dist/favicon.svg'),'utf8');
  let html=readFileSync(resolve(root,'dist/index.html'),'utf8');
  html=html.replace('<link rel="stylesheet" href="./styles.css">',()=>'<style>\n'+css+'\n</style>');
  html=html.replace('<script defer src="./script.js"></script>',()=>'<script defer>\ndocument.addEventListener("DOMContentLoaded",()=>{\n'+script.replace(/<\/script/gi,'<\\/script')+'\n});\n</script>');
  html=html.replace('href="./favicon.svg"','href="data:image/svg+xml,'+encodeURIComponent(favicon)+'"');
  const output=resolve(process.argv[2]);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);console.log('Standalone HTML: '+output);
}
console.log('Built static app.');
