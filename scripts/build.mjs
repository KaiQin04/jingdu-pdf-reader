import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ICON_DATA_URI } from '../src/brand.mjs';
import { bundlePdfWorker } from './pdf-worker.mjs';
const root = new URL('../', import.meta.url);
const at = p => new URL(p, root);
await mkdir(at('dist'), { recursive: true });
// Vendor data is fixed at build time. A PDF can never supply a path or URL to fetch.
const binary = {};
for (const [dir, kind] of [['cmaps','cMapUrl'],['standard_fonts','standardFontDataUrl']]) {
  for (const file of (await readdir(at(`node_modules/pdfjs-dist/${dir}`))).sort()) {
    if (!/\.(bcmap|pfb|ttf)$/.test(file)) continue;
    binary[`${kind}/${file}`] = (await readFile(at(`node_modules/pdfjs-dist/${dir}/${file}`))).toString('base64');
  }
}
// No document-derived diagnostics from the parser worker reach browser logs.
const worker = `for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};\n${await bundlePdfWorker()}`;
const result = await build({entryPoints:[at('src/reader.mjs').pathname],outfile:'reader.js',bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'external',define:{PDF_WORKER_SOURCE:JSON.stringify(worker),PDF_BINARY_DATA:JSON.stringify(binary)}});
const js = result.outputFiles.find(f=>f.path.endsWith('.js') || f.path === '<stdout>').text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(at('src/styles.css'),'utf8');
const hash = s => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const bootstrap = `const showInitError=()=>{if(document.documentElement.dataset.readerReady==='true')return;const status=document.getElementById('status');if(status){status.textContent='The reader could not start. Close and reopen it. No document has been opened.';status.dataset.error='true';}};window.addEventListener('error',showInitError);window.addEventListener('unhandledrejection',showInitError);window.addEventListener('securitypolicyviolation',event=>{if(event.violatedDirective.startsWith('script-src'))showInitError();});`;
const csp = `default-src 'none'; script-src ${hash(js)} ${hash(bootstrap)}; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
let html = (await readFile(at('src/reader.html'),'utf8')).replace('<!--CSP-->',`<meta http-equiv="Content-Security-Policy" content="${csp}">`).replaceAll('<!--ICON-URI-->',ICON_DATA_URI).replace('/*STYLE*/',css).replace('/*BOOTSTRAP*/',()=>bootstrap).replace('/*SCRIPT*/',()=>js);
await writeFile(at('dist/reader.html'),html);
await writeFile(at('dist/csp.txt'),csp);
await writeFile(at('dist/build.json'),JSON.stringify({sha256:createHash('sha256').update(html).digest('hex'),bytes:Buffer.byteLength(html),pdfjs:'6.4.299'},null,2));
await mkdir(at('dist/licenses'), { recursive: true });
for (const [source, name] of [
  ['pdfjs-dist/LICENSE','PDFJS-LICENSE'],
  ['pdfjs-dist/cmaps/LICENSE','CMAPS-LICENSE'],
  ['pdfjs-dist/standard_fonts/LICENSE_FOXIT','FONT-LICENSE-FOXIT'],
  ['pdfjs-dist/standard_fonts/LICENSE_LIBERATION','FONT-LICENSE-LIBERATION'],
  ['pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2','PDFJS-JBIG2-LICENSE'],
  ['pdfjs-dist/wasm/LICENSE_JBIG2','JBIG2-LICENSE'],
  ['pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG','PDFJS-OPENJPEG-LICENSE'],
  ['pdfjs-dist/wasm/LICENSE_OPENJPEG','OPENJPEG-LICENSE'],
  ['@modelcontextprotocol/ext-apps/LICENSE','MCP-APPS-LICENSE'],
  ['@modelcontextprotocol/core/LICENSE','MCP-CORE-LICENSE'],
  ['@modelcontextprotocol/server/LICENSE','MCP-SERVER-LICENSE'],
  ['@modelcontextprotocol/client/LICENSE','MCP-CLIENT-LICENSE'],
  ['@modelcontextprotocol/node/LICENSE','MCP-NODE-LICENSE'],
  ['zod/LICENSE','ZOD-LICENSE'],
]) await copyFile(at(`node_modules/${source}`),at(`dist/licenses/${name}`));
await copyFile(at('LICENSE'),at('dist/licenses/JINGDU-LICENSE'));
await copyFile(at('licenses/CONTENT-TYPE-LICENSE'),at('dist/licenses/CONTENT-TYPE-LICENSE'));
for (const output of result.outputFiles.filter(f=>f.path.endsWith('.LEGAL.txt'))) await writeFile(at('dist/THIRD-PARTY-NOTICES.txt'),output.contents);
console.log(`Built offline reader: ${Buffer.byteLength(html)} bytes`);
const notices = ['THIRD-PARTY-NOTICES.txt', ...(await readdir(at('dist/licenses'))).sort().map(n=>'licenses/'+n)];
const licenseText=(await Promise.all(notices.map(async n=>`\n===== ${n} =====\n`+await readFile(at('dist/'+n),'utf8')))).join('\n');
const documents={'/privacy':await readFile(at('docs/privacy.txt'),'utf8'),'/help':await readFile(at('docs/help.txt'),'utf8'),'/licenses':licenseText};
await writeFile(at('dist/documents.json'),JSON.stringify(documents));
