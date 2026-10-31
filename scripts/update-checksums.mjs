import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const ignored=new Set(['.git','node_modules','.sites-runtime','outputs','test-results']);
async function walk(dir,rel='') { let out=[]; for(const entry of await readdir(dir,{withFileTypes:true})) { if(ignored.has(entry.name)||entry.name.startsWith('.env')||entry.name.startsWith('.dev.vars')) continue; const name=rel?rel+'/'+entry.name:entry.name; if(entry.isSymbolicLink()) throw new Error('Unexpected symlink '+name); if(entry.isDirectory()) out.push(...await walk(path.join(dir,entry.name),name)); else if(entry.isFile()&&name!=='SHA256SUMS.json') out.push(name); } return out; }
const manifest={}; for(const name of (await walk(root)).sort()) manifest[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
await writeFile(path.join(root,'SHA256SUMS.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Updated deployment checksums for '+Object.keys(manifest).length+' files; original ZIP audit remains separate.');
