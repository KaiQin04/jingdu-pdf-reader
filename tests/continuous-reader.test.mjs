import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {displayScale} from '../src/pdf-policy.mjs';
const source=readFileSync(new URL('../src/reader.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function renderPage('),end=source.indexOf('async function followDestination(',start);
assert.ok(start>=0&&end>start);
const renderSource=`(${source.slice(start,end).trim()})`;
// Execute the real render entry and its first await under controlled scheduling.
// These do not substitute for real browser scroll/layout tests.
for(const replace of [false,true])test(`cancelled old render cannot clear ${replace?'replacement document':'closed document'} after first await`,async()=>{
 let release;const waiting=new Promise(r=>{release=r});let clears=0,cleanups=0,controls=0;
 const oldDoc={numPages:10,cleanup(){cleanups++;return Promise.resolve()}};
 const state={pdf:oldDoc,epoch:1,busy:false,scrollVersion:0,scale:1,pageNumber:1,views:new Map([[1,{render:{cancel(){},promise:waiting}}]])};
 const render=vm.runInNewContext(renderSource,{state,controls(){controls++},clearQuote(){},clearViews(){clears++;state.views.clear()},deadline:p=>p,fail(e){throw e}});
 const run=render(2);
 state.epoch++;state.pdf=replace?{numPages:20}:null;state.busy=replace;
 const newViews=new Map(replace?[[1,{belongsToNewDocument:true}]]:[]);state.views=newViews;
 release();await run;
 assert.equal(clears,0);assert.equal(cleanups,0);assert.equal(state.views,newViews);assert.equal(state.views.size,replace?1:0);assert.equal(state.busy,replace);assert.equal(controls,1);
});
test('same-document cancellation rejection is drained before clearing views',async()=>{
 let reject;const waiting=new Promise((_,r)=>{reject=r});const order=[];
 const oldDoc={numPages:10,cleanup(){order.push('cleanup');return Promise.resolve()},getPage(){order.push('getPage');state.epoch++;return Promise.resolve({})}};
 const state={pdf:oldDoc,epoch:1,busy:false,scrollVersion:0,scale:1,pageNumber:1,views:new Map([[1,{render:{cancel(){order.push('cancel')},promise:waiting}}]])};
 const render=vm.runInNewContext(renderSource,{state,controls(){},clearQuote(){},clearViews(){order.push('clear')},deadline:p=>p,fail(e){throw e}});
 const run=render(2);assert.deepEqual(order,['cancel']);reject(new Error('RenderingCancelledException'));await run;
 assert.deepEqual(order,['cancel','clear','cleanup','getPage']);
});
test('scroll within same page after views cleared retries aborted render',async()=>{
 let acquisitions=0;const page={getViewport:()=>({width:600,height:800})};
 const state={epoch:1,busy:false,scrollVersion:0,scale:1,pageNumber:1,mode:'continuous',crop:0,other:1,views:new Map(),layout:{pageAt:()=>1},pendingPage:null};
 const doc={numPages:10,cleanup:()=>Promise.resolve(),async getPage(){acquisitions++;if(acquisitions===1)state.scrollVersion++;else state.epoch++;return page;}};state.pdf=doc;
 const render=vm.runInNewContext(renderSource,{state,controls(){},clearQuote(){},clearViews(){state.views.clear()},deadline:p=>p,fail(e){throw e},displayScale,window:{devicePixelRatio:1},pageWindow:()=>[1,2],readingAnchor:()=>({page:1,fraction:.2}),$:()=>({scrollTop:160})});
 await render(1,1,{preserve:true});
 // finally launches the retried render asynchronously; drain its short promise chain.
 for(let i=0;i<12;i++)await Promise.resolve();
 assert.equal(acquisitions,2,'same-page pending scroll must replay after cleared views');
});

test('fresh reader opens in continuous mode without layout or next-page buttons',()=>{
 assert.match(source,/mode:'continuous'/,'initial state must allow wheel/trackpad scroll through the document');
 const html=readFileSync(new URL('../src/reader.html',import.meta.url),'utf8');
 assert.match(html,/<option value="continuous" selected>/,'visible layout selection must agree with initial state');
});
