import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/annotations.mjs').catch(()=>({}));
const identity={fingerprints:['a'.repeat(32),null],pageCount:5000,filename:'研究 <book>.pdf'};
function store(){assert.equal(typeof api.AnnotationStore,'function');return new api.AnnotationStore(identity);}
const highlight={type:'highlight',page:2,color:'yellow',rects:[[.1,.2,.3,.04]],text:'My note',quote:'A quote'};
test('normalized rectangles preserve page coordinates across zoom and clip pixel selections',()=>{
 assert.equal(typeof api.normalizePageRect,'function');
 assert.deepEqual(api.normalizePageRect([10,20,30,4],100,100),[.1,.2,.3,.04]);
 assert.deepEqual(api.normalizePageRect([20,40,60,8],200,200),[.1,.2,.3,.04]);
 assert.deepEqual(api.normalizePageRect([-2,10,12,10],100,100),[0,.1,.1,.1]);
 for(const rect of [[0,0,NaN,1],[0,0,0,1],[-1,0,.1,.1],[.9,0,.2,.2]])assert.throws(()=>api.validateRect(rect));
});
test('annotation CRUD validates geometry and keeps defensive copies',()=>{
 const s=store(),a=s.add(highlight);assert.equal(a.type,'highlight');assert.equal(a.page,2);assert.ok(a.id);
 a.rects[0][0]=.9;assert.equal(s.list()[0].rects[0][0],.1);
 const changed=s.update(a.id,{color:'blue',text:'Changed'});assert.equal(changed.color,'blue');
 assert.equal(s.list({page:2,color:'blue'}).length,1);assert.equal(s.list({page:1}).length,0);
 assert.throws(()=>s.update(a.id,{page:5001}));assert.equal(s.list()[0].page,2);
 assert.equal(s.remove(a.id),true);assert.equal(s.remove(a.id),false);assert.equal(s.list().length,0);
});
test('typed annotations bound text, page, rectangles and ink pressure',()=>{
 const s=store();s.add({type:'comment',page:1,text:'Page-level comment'});
 s.add({type:'underline',page:1,rects:[[0,0,.2,.1]],color:'pink'});
 s.add({type:'ink',page:1,color:'purple',points:[[0,0,0],[1,1,1]]});
 for(const patch of [{page:0},{page:5001},{type:'script'},{color:'red'},{text:'x'.repeat(4001)},{quote:'x'.repeat(4001)},{rects:[]},{rects:[[0,0,2,1]]}])assert.throws(()=>s.add({...highlight,...patch}));
 assert.throws(()=>s.add({type:'ink',page:1,points:[[0,0,2],[1,1,.5]]}));
 assert.throws(()=>s.add({type:'ink',page:1,points:Array.from({length:2001},()=>[0,0,.5])}));
 assert.throws(()=>s.add({...highlight,rects:Array.from({length:257},()=>[0,0,.1,.1])}));
});
test('JSON round-trip binds document and merging is idempotent and atomic',()=>{
 const source=store();const a=source.add(highlight);const json=source.exportJSON();const target=store();
 assert.deepEqual(target.importJSON(json),{added:1,skipped:0});assert.deepEqual(target.importJSON(json),{added:0,skipped:1});assert.equal(target.list().length,1);
 const changed=JSON.parse(json);changed.annotations[0].text='conflicting content';assert.throws(()=>target.importJSON(JSON.stringify(changed)),/CONFLICT/);assert.equal(target.list()[0].text,'My note');
 const wrong=new api.AnnotationStore({...identity,fingerprints:['b'.repeat(32)]});assert.throws(()=>wrong.importJSON(json),/DOCUMENT/);
 const wrongPages=new api.AnnotationStore({...identity,pageCount:4});assert.throws(()=>wrongPages.importJSON(json),/DOCUMENT/);
 const bad=JSON.parse(json);bad.annotations.push({...bad.annotations[0],id:'bad',page:0});const empty=store();assert.throws(()=>empty.importJSON(JSON.stringify(bad)));assert.equal(empty.list().length,0);
 assert.equal(target.list()[0].id,a.id);target.clear();assert.equal(target.list().length,0);
});
test('prototype keys, oversized JSON, unexpected fields and capacity overflow are rejected',()=>{
 const s=store();assert.throws(()=>s.importJSON('{"__proto__":{"polluted":true}}'),/KEY/);assert.equal({}.polluted,undefined);
 assert.throws(()=>s.importJSON(' '.repeat(5*1024*1024+1)),/SIZE/);
 assert.throws(()=>s.importJSON('{"x":{"constructor":{}}}'),/KEY/);
 assert.throws(()=>s.add({...highlight,url:'https://example.invalid'}),/FIELD/);
 for(let i=0;i<1000;i++)s.add({type:'comment',page:1,text:String(i)});
 assert.throws(()=>s.add({type:'comment',page:1,text:'over'}),/LIMIT/);
 const doc=JSON.parse(s.exportJSON());doc.annotations.push({...doc.annotations[0],id:'overflow'});assert.throws(()=>store().importJSON(JSON.stringify(doc)),/LIMIT/);
});
test('Markdown treats filenames, quotes and notes as literal untrusted text',()=>{
 const s=store();s.add({...highlight,text:'<script>alert(1)</script>\n# inject [x](javascript:alert(1))',quote:'![remote](https://example.invalid/pixel)'});
 const md=s.exportMarkdown();assert.ok(md.includes('PDF 第 2'));assert.ok(md.includes('&lt;script&gt;'));assert.ok(!md.includes('<script>'));assert.ok(!md.includes('![remote]'));assert.ok(!md.includes('\n# inject'));
 assert.equal(api.safeFilename('../bad\\name\u0000.pdf'),'.._bad_name.pdf');
 assert.ok(api.safeFilename('x'.repeat(1000)).length<=180);
});
test('edge-touching geometry never normalizes to zero width',()=>{assert.throws(()=>api.validateRect([1,0,1e-12,.1]),/RECT/);});
test('any admitted dense ink set exports within the same import size limit',()=>{
 const s=store(),points=Array.from({length:2000},()=>[.25,.5,.75]);
 for(let i=0;i<70;i++)s.add({type:'ink',page:1,points});
 const json=s.exportJSON();assert.ok(new TextEncoder().encode(json).length<=5*1024*1024);assert.equal(store().importJSON(json).added,70);
});
