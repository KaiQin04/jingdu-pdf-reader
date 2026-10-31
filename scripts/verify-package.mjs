import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root,'SHA256SUMS.json'),'utf8'));
let checked = 0;
for (const [name, expected] of Object.entries(manifest)) {
  if (isAbsolute(name) || name.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid checksum manifest entry');
  const target = await realpath(resolve(root,name));
  const child = relative(root,target);
  if (isAbsolute(child) || child === '..' || child.startsWith('..'+sep)) throw new Error('Checksum target escapes package');
  const actual = createHash('sha256').update(await readFile(target)).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch: ${name}`);
  checked++;
}
console.log(`Verified ${checked} packaged file hashes. This verifies integrity, not safety or host compatibility.`);
