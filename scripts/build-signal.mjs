import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'signal-dist');
await mkdir(output,{recursive:true});
for(const file of ['index.html','signal.css','signal.js','sw.js','logo.svg','manifest.webmanifest']) await copyFile(path.join(root,file),path.join(output,file));
console.log('Signal static build ready in signal-dist');
