import { mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = new URL('./dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'signal.css', 'signal.js', 'sw.js', 'logo.svg', 'manifest.webmanifest']) {
  await copyFile(new URL('../' + file, import.meta.url), new URL(file, output));
}
console.log('Signal static site built in ' + fileURLToPath(output));
