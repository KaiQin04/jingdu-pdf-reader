import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import worker from '../dist/server/index.js';
import { createCloudWorker } from '../src/cloud-handler.mjs';
const ORIGIN='https://synthetic.example';
const env={PDF_READER_SITE_ORIGIN:ORIGIN};
const RESOURCE='ui://jingdu-reader/v1/reader.html';
const auth={'oai-authenticated-user-id':'synthetic-owner'};
function req(path='/mcp',options={}){return new Request(ORIGIN+path,options);}
function rpc(method,params={},extra={}){
  return req('/mcp',{method:'POST',headers:{...auth,'Content-Type':'application/json','Accept':'application/json, text/event-stream',...extra.headers},body:JSON.stringify({jsonrpc:'2.0',id:extra.id??1,method,params})});
}
function modern(method,params={}){
  return rpc(method,{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'synthetic-test',version:'1'}}},{headers:{'MCP-Protocol-Version':'2026-07-28','MCP-Method':method,...(params.name||params.uri?{'MCP-Name':params.name||params.uri}:{})}});
}
test('cloud configuration fails closed before identity or document input',async()=>{
  for(const value of [undefined,'http://synthetic.example','https://synthetic.example/path','https://user:pass@synthetic.example','https://synthetic.example:444']){
    assert.equal((await worker.fetch(rpc('tools/list'),{PDF_READER_SITE_ORIGIN:value})).status,503);
  }
});
test('anonymous UI and MCP ignore credentials and identity headers',async()=>{
 for(const headers of [{},{Authorization:'Bearer synthetic',Cookie:'owner=true'},{'oai-authenticated-user-email':'not-valid','oai-authenticated-user-id':'pretend'}]){
  for(const path of ['/','/reader','/privacy','/help','/licenses'])assert.equal((await worker.fetch(req(path,{headers}),env)).status,200);
 }
 assert.equal((await worker.fetch(new Request('https://other.invalid/mcp'),env)).status,403);
 assert.equal((await worker.fetch(req('/',{headers:{'Sec-Fetch-Site':'cross-site'}}),env)).status,200);
});
test('configured public alias serves the same reader and MCP without allowing other hosts',async()=>{
 const alias='https://reader.synthetic.example',configured={...env,PDF_READER_PUBLIC_ORIGIN:alias};
 const instance=createCloudWorker({html:'<!doctype html><html lang="en">synthetic reader</html>',csp:"default-src 'none'"});
 for(const origin of [ORIGIN,alias]){
  assert.equal((await instance.fetch(new Request(origin+'/reader'),configured)).status,200);
  const request=rpc('tools/list');
  const response=await instance.fetch(new Request(origin+'/mcp',{method:'POST',headers:request.headers,body:await request.text()}),configured);
  assert.equal(response.status,200);assert.equal((await response.json()).result.tools[0].name,'open_pdf_reader');
 }
 for(const origin of ['https://other.invalid','https://reader.synthetic.example.evil.invalid'])assert.equal((await instance.fetch(new Request(origin+'/reader'),configured)).status,403);
 assert.equal((await instance.fetch(new Request(alias+'/reader'),env)).status,403);
});
test('invalid public alias configuration fails closed while an omitted alias remains valid',async()=>{
 const instance=createCloudWorker({html:'synthetic reader',csp:"default-src 'none'"});
 for(const alias of [null,'',false,'http://reader.synthetic.example','https://reader.synthetic.example/','https://user@reader.synthetic.example','https://reader.synthetic.example:444','https://reader.synthetic.example/path','https://reader.synthetic.example?x=1','https://reader.synthetic.example#fragment']){
  assert.equal((await instance.fetch(req('/reader'),{...env,PDF_READER_PUBLIC_ORIGIN:alias})).status,503);
 }
 assert.equal((await instance.fetch(req('/reader'),env)).status,200);
});
test('anonymous browser MCP preflight exposes no credentials',async()=>{
 const r=await worker.fetch(req('/mcp',{method:'OPTIONS',headers:{Origin:'https://any.example'}}),env);
 assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(r.headers.get('Access-Control-Allow-Credentials'),null);
});
test('authenticated cloud shell and reader retain sandbox, CSP and no-store',async()=>{
  const shell=await worker.fetch(req('/',{headers:auth}),env);assert.equal(shell.status,200);assert.match(await shell.text(),/sandbox="allow-scripts"/);
  const r=await worker.fetch(req('/reader',{headers:auth}),env);assert.equal(r.status,200);
  const html=await r.text(),csp=r.headers.get('Content-Security-Policy');
  assert.match(csp,/sandbox allow-scripts/);assert.match(csp,/connect-src 'none'/);assert.match(r.headers.get('Cache-Control'),/no-store/);
  assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
  const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];assert.ok(csp.includes(`sha256-${createHash('sha256').update(js).digest('base64')}`));
});
test('fixed routes reject uploads, URL queries, unknown paths and session methods',async()=>{
  for(const path of ['/upload','/etc/passwd','/reader?url=https://example.invalid'])assert.equal((await worker.fetch(req(path,{headers:auth}),env)).status,404);
  for(const method of ['GET','DELETE'])assert.equal((await worker.fetch(req('/mcp',{method,headers:auth}),env)).status,405);
});
test('body type, declared and streamed size, depth and batch are rejected',async()=>{
  assert.equal((await worker.fetch(req('/mcp',{method:'POST',headers:{...auth,'Content-Type':'text/plain'},body:'x'}),env)).status,415);
  for(const raw of ['x'.repeat(32769),'[{},{}]','['.repeat(18)+'0'+']'.repeat(18)]){
    const r=await worker.fetch(req('/mcp',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:raw}),env);assert.ok([400,413].includes(r.status));
  }
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(20000));c.enqueue(new Uint8Array(20000));c.close();}});
  assert.equal((await worker.fetch(req('/mcp',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:stream,duplex:'half'}),env)).status,413);
  assert.equal((await worker.fetch(rpc('tools/list',{}, {headers:{'Content-Length':'40000'}}),env)).status,413);
});
test('Sites plain discovery is JSON and advertises the current MCP revision',async()=>{
  const r=await worker.fetch(rpc('server/discover'),env);assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/application\/json/);
  const d=await r.json();assert.deepEqual(d.result.supportedVersions,['2026-07-28']);assert.ok(d.result.capabilities.tools);
});
test('modern SDK discovery, tools, call and UI resource round trip',async()=>{
  for(const [method,params] of [['server/discover',{}],['tools/list',{}],['tools/call',{name:'open_pdf_reader',arguments:{}}],['resources/read',{uri:RESOURCE}]]){
    const r=await worker.fetch(modern(method,params),env);assert.equal(r.status,200);const d=await r.json();assert.equal(d.error,undefined);assert.ok(d.result);
  }
});
test('legacy initialize/list/call are stateless JSON with no session cookie',async()=>{
  for(const [method,params] of [['initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-test',version:'1'}}],['tools/list',{}],['tools/call',{name:'open_pdf_reader',arguments:{}}]]){
    const r=await worker.fetch(rpc(method,params),env);assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/application\/json/);assert.equal(r.headers.get('Mcp-Session-Id'),null);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal((await r.json()).error,undefined);
  }
});
test('native sidebar/thread metadata and zero-input schema survive Worker bundling',async()=>{
  const d=await(await worker.fetch(modern('tools/list'),env)).json();assert.equal(d.result.tools.length,1);const t=d.result.tools[0];
  assert.equal(t.title,'PDF 閱讀器');assert.deepEqual(t._meta['openai/ui'].entrypoints,[{type:'global'},{type:'thread'}]);assert.equal(t.inputSchema.additionalProperties,false);assert.deepEqual(Object.keys(t.inputSchema.properties),[]);
  const resource=await(await worker.fetch(modern('resources/read',{uri:RESOURCE}),env)).json();const item=resource.result.contents[0];assert.equal(item.mimeType,'text/html;profile=mcp-app');assert.deepEqual(item._meta.ui.csp.connectDomains,[]);assert.deepEqual(item._meta['openai/ui'].availableDisplayModes,['inline','fullscreen']);
});
test('PDF bytes, filenames, URLs, paths and arbitrary resource input never enter tools',async()=>{
  for(const args of [{data:'SYNTHETIC-PRIVATE'},{url:'http://169.254.169.254/'},{path:'/etc/passwd'},{filename:'SYNTHETIC-PRIVATE.pdf'},{'SYNTHETIC-PRIVATE':'x'}]){
    const r=await worker.fetch(rpc('tools/call',{name:'open_pdf_reader',arguments:args}),env);assert.equal(r.status,400);assert.ok(!(await r.text()).includes('SYNTHETIC-PRIVATE'));
  }
  assert.equal((await worker.fetch(rpc('resources/read',{uri:'file:///etc/passwd'}),env)).status,400);
});
test('per-isolate concurrency bound rejects a fifth request and releases slots',async()=>{
  const instance=createCloudWorker({html:'synthetic',csp:"default-src 'none'"});const controllers=[];
  const pending=Array.from({length:4},()=>instance.fetch(req('/mcp',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:new ReadableStream({start(c){controllers.push(c);}}),duplex:'half'}),env));
  assert.equal((await instance.fetch(rpc('server/discover'),env)).status,429);
  for(const c of controllers){c.enqueue(new TextEncoder().encode(JSON.stringify({jsonrpc:'2.0',id:1,method:'server/discover'})));c.close();}
  for(const r of await Promise.all(pending))assert.equal(r.status,200);
  assert.equal((await instance.fetch(rpc('server/discover'),env)).status,200);
});
test('identity is not reflected or retained in cross-request responses',async()=>{
  const values=await Promise.all(['synthetic-owner','synthetic-other'].map(identity=>worker.fetch(rpc('tools/call',{name:'open_pdf_reader',arguments:{}},{headers:{'oai-authenticated-user-id':identity}}),env).then(r=>{assert.equal(r.status,200);return r.text();})));
  assert.equal(values[0],values[1]);for(const value of values)assert.ok(!value.includes('synthetic-owner')&&!value.includes('synthetic-other'));
  // This does not simulate or prove the external owner-only Sites ACL.
});
test('unknown tools, methods, batches and malformed messages fail without echo',async()=>{
  for(const [method,params] of [['SYNTHETIC-PRIVATE',{}],['tools/call',{name:'SYNTHETIC-PRIVATE',arguments:{}}],['tools/list',{cursor:'SYNTHETIC-PRIVATE'}]]){
    const r=await worker.fetch(rpc(method,params),env);assert.equal(r.status,400);assert.equal(await r.text(),'Request rejected');
  }
});
test('cloud source manifest requests only MCP and no local plugin or persistent storage',async()=>{
  const m=JSON.parse(await readFile(new URL('../.openai/hosting.json',import.meta.url),'utf8'));
  assert.deepEqual(m.capabilities,['mcp']);assert.equal(m.d1,null);assert.equal(m.r2,null);assert.equal(m.static,undefined);assert.equal(m.connectors,undefined);assert.equal(m.plugins,undefined);
});

test('opaque sandbox UI keeps classic offline worker and avoids blocked form submission',async()=>{
  const reader=await readFile(new URL('../src/reader.mjs',import.meta.url),'utf8');
  const template=await readFile(new URL('../src/reader.html',import.meta.url),'utf8');
  const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
  const csp=await readFile(new URL('../dist/csp.txt',import.meta.url),'utf8');
  assert.match(reader,/new Worker\(state\.workerUrl,\{name:'private-pdf-parser'\}\)/);
  assert.match(build,/await bundlePdfWorker\(\)/);
  const {bundlePdfWorker}=await import('../scripts/pdf-worker.mjs');
  const {Script}=await import('node:vm');
  const parserSource=await bundlePdfWorker();
  assert.doesNotThrow(()=>new Script(parserSource));
  assert.match(reader,/\$\('search'\)\.addEventListener\('click',searchDocument\)/);
  assert.match(reader,/event\.key==='Enter'/);
  assert.doesNotMatch(template,/<form\b/i);
  assert.match(csp,/connect-src 'none'/);assert.match(csp,/form-action 'none'/);
  assert.match(csp,/worker-src blob:/);assert.doesNotMatch(csp,/unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(reader,/dataset\.readerReady/);
});

test('fixed local PNG icon survives MCP discovery, initialize, tools, resources and page bundling',async()=>{
  const {ICONS,ICON_DATA_URI}=await import('../src/brand.mjs');
  const {IconSchema}=await import('@modelcontextprotocol/core');
  assert.ok(IconSchema.safeParse(ICONS[0]).success);
  const bytes=Buffer.from(ICON_DATA_URI.split(',')[1],'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'512cb13580475c82f29a3848dcdc0e7137664afb0a2732bff957cef22fd47247');
  assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(bytes.readUInt32BE(16),256);assert.equal(bytes.readUInt32BE(20),256);
  const discover=await(await worker.fetch(rpc('server/discover'),env)).json();
  assert.deepEqual(discover.result._meta['io.modelcontextprotocol/serverInfo'].icons,ICONS);
  const init=await(await worker.fetch(rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),env)).json();
  assert.deepEqual(init.result.serverInfo.icons,ICONS);
  const tools=await(await worker.fetch(modern('tools/list'),env)).json();assert.deepEqual(tools.result.tools[0].icons,ICONS);
  const resources=await(await worker.fetch(modern('resources/list'),env)).json();assert.deepEqual(resources.result.resources[0].icons,ICONS);
  for(const path of ['/','/reader']){
    const page=await worker.fetch(req(path,{headers:auth}),env);assert.ok((await page.text()).includes(ICON_DATA_URI));
  }
  assert.equal((await worker.fetch(req('/icon.png'),env)).status,404);
  assert.equal((await worker.fetch(req('/icon.png',{headers:auth}),env)).status,404);
});

test('reader owns opaque backgrounds and has accessible paired light/dark text tokens',async()=>{
  const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
  const source=await readFile(new URL('../src/reader.mjs',import.meta.url),'utf8');
  assert.match(css,/body\{[^}]*background:var\(--reader-bg\);color:var\(--reader-text\)/);
  assert.match(css,/main\{[^}]*background:var\(--reader-bg\);color:var\(--reader-text\)/);
  assert.match(source,/applyDocumentTheme\(context.theme\)/);
  assert.match(css,/:root\[data-theme="dark"\]/);
  assert.match(css,/:root:not\(\[data-theme="light"\]\)/);
  const lum=hex=>{const rgb=hex.match(/[0-9a-f]{2}/g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const selector of [':root',':root[data-theme="dark"]']){
    const body=css.slice(css.indexOf(selector+'{')+selector.length+1).split('}')[0];
    const vars=Object.fromEntries([...body.matchAll(/--reader-([\w-]+):#([0-9a-f]{6})/g)].map(m=>[m[1],m[2]]));
    for(const fg of ['text','muted'])for(const bg of ['bg','panel','status','viewport']){
      const a=lum(vars[fg]),b=lum(vars[bg]);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${selector} ${fg}/${bg}`);
    }
  }
  // PDF paper/text layer remains document-coloured, not inverted by the app theme.
  assert.match(css,/#page\{[^}]*background:white/);assert.match(css,/\.textLayer :is\(span,br\)\{color:transparent/);
});

test('PDF-first layout keeps a compact toolbar and opt-in overlay tools with keyboard dismissal',async()=>{
 const html=await readFile(new URL('../src/reader.html',import.meta.url),'utf8');
 const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
 const js=await readFile(new URL('../src/reader.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(html,/<header>|<footer>|class="privacy"/);
 assert.match(html,/<aside id="tools-panel"[^>]* hidden>/);
 assert.match(html,/aria-expanded="false" aria-controls="tools-panel"/);
 assert.match(css,/#tools-panel\{position:absolute/);
 assert.match(css,/height:100dvh/);assert.match(css,/\.workspace\{flex:1;min-height:0/);
 assert.match(css,/#viewport\{scrollbar-gutter:stable\}/);
 assert.match(js,/event.key==='Escape'/);assert.match(js,/setToolsOpen\(false,false\);void renderPage\(i(?:,state.scale,\{history:true\})?\)/);
 assert.match(js,/\$\('tools-toggle'\)\.focus\(\)/);
 for(const id of ['file','close','page-number','prev','next','zoom-in','zoom-out','fit','query','search','cite','copy'])assert.ok(html.includes(`id="${id}"`));
});
test('book reader uses local sliced ranges and resumable cancellable search without whole-file copying',async()=>{
 const js=await readFile(new URL('../src/reader.mjs',import.meta.url),'utf8');
 const html=await readFile(new URL('../src/reader.html',import.meta.url),'utf8');
 assert.doesNotMatch(js,/file\.arrayBuffer\(/);
 assert.match(js,/localRangeTransport/);assert.match(js,/searchBatchPages/);
 assert.ok(html.includes('id="search-cancel"'));assert.ok(html.includes('id="search-next"'));
 assert.match(html,/500 MiB/);assert.match(html,/5,000/);
});
test('page number Enter explicitly commits navigation for large-book jumping',async()=>{const js=await readFile(new URL('../src/reader.mjs',import.meta.url),'utf8');assert.match(js,/\$\('page-number'\)\.addEventListener\('keydown'/);});
test('navigation releases old document font resources before rendering another page',async()=>{const js=await readFile(new URL('../src/reader.mjs',import.meta.url),'utf8');const render=js.slice(js.indexOf('async function renderPage'),js.indexOf('async function openFile'));assert.match(render,/await deadline\(doc\.cleanup\(\),epoch\)/);});
test('academic reader exposes opt-in navigation layouts and local annotation export controls',async()=>{const html=await readFile(new URL('../src/reader.html',import.meta.url),'utf8');for(const id of ['back','outline','thumbnails','view-mode','split-page','crop','search-mode','case-sensitive','note-color','note-comment','note-highlight','note-underline','note-save','note-import','export-json','export-md','export-preview','host-download','draw-mode','discard-dialog'])assert.ok(html.includes(`id="${id}"`),id);});

test('public notice allowlist is complete and internal paths cannot be fetched',async()=>{
 for(const [path,pattern] of [['/privacy',/託管平台/],['/help',/註記不會自動保存/],['/licenses',/Apache License/]]){
  const r=await worker.fetch(req(path),env);assert.equal(r.status,200);assert.match(await r.text(),pattern);assert.equal(r.headers.get('Set-Cookie'),null);
 }
 for(const path of ['/debug','/.env','/source','/docs','/licenses/../../etc/passwd','/upload','/reader?filename=test.pdf'])assert.equal((await worker.fetch(req(path),env)).status,404);
 const r=await worker.fetch(req('/',{headers:{'oai-authenticated-user-email':'PRIVATE-ID@example.invalid',Authorization:'Bearer PRIVATE-ID',Cookie:'PRIVATE-ID'}}),env);
 assert.ok(!(await r.text()).includes('PRIVATE-ID'));
});

test('built license route retains complete project and bundled dependency notices',async()=>{
 const response=await worker.fetch(req('/licenses'),env);
 assert.equal(response.status,200);
 const text=await response.text();
 for(const path of ['LICENSE','licenses/PDFJS-LICENSE','licenses/CMAPS-LICENSE','licenses/FONT-LICENSE-FOXIT','licenses/FONT-LICENSE-LIBERATION','licenses/PDFJS-JBIG2-LICENSE','licenses/JBIG2-LICENSE','licenses/PDFJS-OPENJPEG-LICENSE','licenses/OPENJPEG-LICENSE','licenses/MCP-EXT-APPS-LICENSE','licenses/MCP-CORE-LICENSE','licenses/MCP-SERVER-LICENSE','licenses/MCP-CLIENT-LICENSE','licenses/MCP-NODE-LICENSE','licenses/ZOD-LICENSE','licenses/CONTENT-TYPE-LICENSE']){
  assert.ok(text.includes(await readFile(new URL('../'+path,import.meta.url),'utf8')),path);
 }
 assert.match(text,/Bundled license information/);
});
test('public MCP has no stable caller state or credential-dependent output',async()=>{
 const responses=[];
 for(const headers of [{},{Cookie:'session=a',Authorization:'Bearer X'},{'oai-authenticated-user-email':'someone@example.invalid'}]){
  const request=req('/mcp',{method:'POST',headers:{...headers,'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:42,method:'tools/call',params:{name:'open_pdf_reader',arguments:{}}})});
  const r=await worker.fetch(request,env);assert.equal(r.status,200);assert.equal(r.headers.get('Mcp-Session-Id'),null);responses.push(await r.text());
 }
 assert.equal(responses[0],responses[1]);assert.equal(responses[1],responses[2]);
});
