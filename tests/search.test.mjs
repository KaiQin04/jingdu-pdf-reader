import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
const module=await import('../src/search-engine.mjs').catch(()=>({}));
const search=request=>{assert.equal(typeof module.searchText,'function');return module.searchText(request);};
function worker(source=module.SEARCH_WORKER_SOURCE){
 assert.equal(typeof source,'string');
 const code=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:value=>parentPort.postMessage(value)};${source}\nparentPort.on('message',data=>self.onmessage({data}));`;
 return new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
}
function request(w,data,timeout=1000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{w.terminate();reject(Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'}));},timeout);w.once('message',x=>{clearTimeout(timer);resolve(x);});w.once('error',e=>{clearTimeout(timer);reject(e);});w.postMessage(data);});}
test('case-sensitive and insensitive literal matching returns original offsets and context',()=>{
 const insensitive=search({id:1,text:'Before Alpha after alpha tail',query:'alpha'});assert.equal(insensitive.ok,true);assert.deepEqual(insensitive.matches.map(m=>[m.start,m.end]),[[7,12],[19,24]]);assert.equal(insensitive.matches[0].text,'Alpha');assert.equal(insensitive.matches[0].context,'Before Alpha after alpha tail');
 assert.equal(search({text:'Alpha alpha',query:'alpha',caseSensitive:true}).matches.length,1);
});
test('NFKC ligature, fullwidth and combining normalization preserves original UTF-16 ranges',()=>{
 const r=search({text:'xﬃＡéz',query:'ffiaé'});assert.equal(r.ok,true);assert.equal(r.matches.length,1);assert.deepEqual([r.matches[0].start,r.matches[0].end,r.matches[0].text],[1,5,'ﬃＡé']);
});
test('Chinese token-AND mode requires all terms, returns contexts not HTML',()=>{
 const r=search({text:'市場與價格。另有誘因和機制設計。',query:'市場 機制',mode:'tokens'});assert.equal(r.ok,true);assert.ok(r.matches.length>=2);assert.ok(r.segmentation.includes('Intl.Segmenter'));
 assert.equal(search({text:'只有市場。',query:'市場 機制',mode:'tokens'}).matches.length,0);
 const raw=search({text:'<script>example</script>',query:'script'});assert.equal(raw.matches[0].text,'script');assert.match(raw.matches[0].context,/<script>/);
});
test('bounded requests and match cap are enforced with typed errors',()=>{
 assert.equal(search({text:'x'.repeat(200001),query:'x'}).error.code,'TEXT_LIMIT');assert.equal(search({text:'x',query:'x'.repeat(201)}).error.code,'QUERY_LIMIT');assert.equal(search({text:'x',query:' '}).error.code,'EMPTY_QUERY');assert.equal(search({text:'x',query:'x',caseSensitive:'yes'}).error.code,'INVALID_REQUEST');
 const r=search({text:'a '.repeat(50),query:'a'});assert.equal(r.matches.length,20);assert.equal(r.truncated,true);
});
test('main-thread API refuses all regex execution',()=>{assert.equal(search({text:'a'.repeat(100)+'!',query:'(a+)+$',mode:'regex'}).error.code,'WORKER_REQUIRED');});
test('dedicated actual worker searches regex, bounds zero-width matches, and reports syntax errors',async()=>{
 const w=worker();try{
  const r=await request(w,{id:'regex',text:'Page 12 and page 24',query:'page \\d+',mode:'regex'});assert.equal(r.id,'regex');assert.deepEqual(r.matches.map(x=>x.text),['Page 12','page 24']);
  assert.equal((await request(w,{text:'abc',query:'(?=.)',mode:'regex'})).matches.length,3);
  assert.equal((await request(w,{text:'abc',query:'[',mode:'regex'})).error.code,'INVALID_REGEX');
 }finally{await w.terminate();}
});
test('pathological regex is terminated by an external worker deadline, then a new worker works',{timeout:5000},async()=>{
 const w=worker();await request(w,{text:'ready',query:'ready'});
 await assert.rejects(request(w,{text:'a'.repeat(50000)+'!',query:'(a+)+$',mode:'regex'},100),{code:'TIMEOUT'});
 const next=worker();try{assert.equal((await request(next,{text:'safe',query:'safe'})).matches.length,1);}finally{await next.terminate();}
});
test('very long regex matches keep contexts and previews bounded while preserving full offsets',async()=>{
 const w=worker();try{const r=await request(w,{text:'a'.repeat(10000),query:'.+',mode:'regex'});assert.equal(r.matches[0].end,10000);assert.ok(r.matches[0].context.length<=240);assert.ok(r.matches[0].text.length<=160);assert.equal(r.matches[0].textTruncated,true);}finally{await w.terminate();}
});
test('worker source remains self-contained after production-style esbuild minification',async()=>{
 const {build}=await import('esbuild');const output=await build({entryPoints:[new URL('../src/search-engine.mjs',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true});
 const bundled=await import(`data:text/javascript,${encodeURIComponent(output.outputFiles[0].text)}`);
 const w=worker(bundled.SEARCH_WORKER_SOURCE);try{const r=await request(w,{id:8,text:'中文市場 Alpha',query:'alpha'});assert.equal(r.ok,true);assert.equal(r.matches[0].text,'Alpha');}finally{await w.terminate();}
});
