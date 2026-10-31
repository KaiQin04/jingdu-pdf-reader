import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { createI18n } from '../src/i18n.mjs';
const source=readFileSync(new URL('../src/reader.mjs',import.meta.url),'utf8');
// Execute the actual named function source with bounded DOM doubles, not a copy
// of its logic. Browser layout/host integration remain separate UI tests.
function fn(name,next,globals={}){
 const start=source.indexOf(`function ${name}(`),end=source.indexOf(next,start);
 assert.ok(start>=0&&end>start,`source boundary for ${name}`);
 return vm.runInNewContext(`(${source.slice(start,end).trim()})`,{i18n:createI18n('zh-Hant'),...globals});
}
function node(){return {value:'',hidden:false,disabled:false,style:{},children:[],attributes:{},classList:{add(){}},append(...v){this.children.push(...v)},replaceChildren(){this.children=[]},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k];delete this[k]},addEventListener(){},focus(){},remove(){this.removed=true}};}
const nodes=()=>{const values=new Map();return id=>{if(!values.has(id))values.set(id,node());return values.get(id)}};
test('dense saved ink uses one SVG primitive per annotation, not per segment',()=>{
 const notes=Array.from({length:70},()=>({type:'ink',color:'yellow',points:Array.from({length:2000},(_,i)=>[i/2000,.5,.5])}));
 const target=node();const paint=fn('paintNotes','function refreshNotes',{state:{notes:{list:()=>notes}},ANNOTATION_COLORS:{yellow:'#ff0'},svgElement:(tag,attrs)=>({tag,attrs})});
 paint({number:1,notes:target});assert.equal(target.children.length,70);assert.ok(target.children.every(n=>n.tag==='polyline'||n.tag==='path'));
});
test('pointer identity, genuine zero pressure, and preview do not rebuild saved geometry',()=>{
 const $=nodes();$('draw-mode').value='ink';$('note-color').value='yellow';let paints=0,refreshes=0;const added=[];
 const view={number:1,notes:node(),surface:{getBoundingClientRect:()=>({x:0,y:0,width:100,height:100}),setPointerCapture(){}}};
 const attach=fn('attachDrawing','function exportNotes',{state:{busy:false,notes:{add:a=>added.push(a)}},$,ANNOTATION_COLORS:{yellow:'#ff0'},svgElement:()=>node(),paintNotes:()=>paints++,refreshNotes:()=>refreshes++,status(){}});attach(view);
 const event=(id,x,pressure=0)=>({pointerId:id,button:0,clientX:x,clientY:50,pressure,preventDefault(){}});
 view.surface.onpointerdown(event(1,10));view.surface.onpointerdown(event(2,90));view.surface.onpointermove(event(2,95));view.surface.onpointerup(event(2,95));assert.equal(added.length,0);
 view.surface.onpointermove(event(1,20));view.surface.onpointerup(event(1,20));assert.equal(added.length,1);assert.equal(added[0].points[0][0],.1);assert.equal(added[0].points[0][2],0);assert.equal(paints,0);assert.equal(refreshes,1);
});
test('explicit close clears screenshot data URL, draft, pending actions and notes',()=>{
 const $=nodes();$('region-preview').src='data:image/png;base64,private';$('note-comment').value='private draft';
 const state={epoch:0,notes:{size:1},pendingAction:()=>{},cache:{clear(){}}};
 const close=fn('closeDocument','function fail',{state,$,stopSearchWorker(){},clearViews(){},clearThumbnails(){},setToolsOpen(){},clearQuote(){},controls(){},status(){},URL});close();
 assert.equal(state.notes,null);assert.equal(state.pendingAction,null);assert.equal($('note-comment').value,'');assert.equal($('region-preview').src,undefined);assert.equal($('host-download').disabled,true);
});
test('parser failure terminates document yet preserves note store and draft for recovery',()=>{
 const $=nodes(),notes={size:2};$('note-comment').value='recover this';const state={epoch:5,notes};let closed=0,opened=0;
 const fail=fn('fail','async function deadline',{state,$,ERRORS:{TIMEOUT:'timeout'},closeDocument(){closed++;state.notes=null;$('note-comment').value=''},refreshNotes(){},controls(){},setTab(){},setToolsOpen(){opened++},status(){}});
 fail(new Error('TIMEOUT'),4);assert.equal(closed,0);fail(new Error('TIMEOUT'),5);assert.equal(closed,1);assert.equal(state.notes,notes);assert.equal($('note-comment').value,'recover this');assert.equal(opened,1);
});
test('note changes invalidate text export snapshot but not independent region image',()=>{
 const $=nodes();const state={views:new Map(),notes:null,exportData:{text:'old'}};let updates=0;
 const refresh=fn('refreshNotes','function addNote',{state,$,updateExportButton(){updates++},paintNotes(){}});
 refresh();assert.equal(state.exportData,null);assert.equal(updates,1);assert.match($('export-preview').value,/重新/);
 const image={blob:'image'};state.exportData=image;refresh();assert.equal(state.exportData,image);
});
test('draft-only notes trigger discard confirmation',()=>{
 const $=nodes(),state={notes:null};$('note-comment').value='unsaved';let called=0;
 const discard=fn('requestDiscard',"\n$('discard-cancel')",{state,$});const action=()=>called++;discard(action);assert.equal(called,0);assert.equal(state.pendingAction,action);assert.equal($('discard-dialog').hidden,false);
});

test('opening another file invokes discard gate for a draft-only comment before closing',async()=>{
 const $=nodes(),state={notes:null};$('note-comment').value='unsaved draft';let discard=0;
 const start=source.indexOf('async function openFile('),end=source.indexOf('function setToolsOpen(',start);
 const open=vm.runInNewContext(`(${source.slice(start,end).trim()})`,{state,$,requestDiscard(){discard++},closeDocument(){throw new Error('must not close without confirmation')}});
 await open({name:'next.pdf'});assert.equal(discard,1);
});
test('dense text rectangles are batched per note, not expanded into DOM per rectangle',()=>{
 const notes=Array.from({length:1000},(_,i)=>({type:i%2?'underline':'highlight',color:'yellow',rects:Array.from({length:256},()=>[.1,.1,.01,.01])}));
 const target=node();const paint=fn('paintNotes','function refreshNotes',{state:{notes:{list:()=>notes}},ANNOTATION_COLORS:{yellow:'#ff0'},svgElement:(tag,attrs)=>({tag,attrs})});
 paint({number:1,notes:target});assert.equal(target.children.length,1000);assert.ok(target.children.every(n=>n.tag==='path'));assert.ok(target.children.every(n=>n.attrs.d.split('M').length===257));
});
test('untrusted imported note text is assigned as text, not executable HTML',()=>{
 const $=nodes();const payload='<img src=x onerror=alert(1)>';const state={views:new Map(),exportData:null,notes:{list:()=>[{id:'x',page:1,type:'comment',color:'yellow',text:payload}]}};
 const created=[];const document={createElement(){const n=node();Object.defineProperty(n,'innerHTML',{set(){throw new Error('HTML injection sink')}});created.push(n);return n}};
 const refresh=fn('refreshNotes','function addNote',{state,$,document,updateExportButton(){},paintNotes(){}});refresh();assert.ok(created.some(n=>n.textContent===payload));
});
