import test from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousLayout} from '../src/continuous-layout.mjs';
import * as policy from '../src/pdf-policy.mjs';
import {LIMITS} from '../src/limits.mjs';
test('Retina continuous zoom increases CSS page size past the old memory plateau',()=>{
 const layout=new ContinuousLayout(5000,{width:600,height:800});
 let previous=0;
 for(const scale of [1,1.4,1.6,2,3,4,6]){
  layout.configure({scale,pixelRatio:2});const size=layout.size(1);
  assert.equal(size.width,600*scale);assert.ok(size.width>previous);previous=size.width;
 }
 assert.ok(layout.totalHeight<33000000);
});
test('raster allocation alone consumes bounded pixels for all visible pages',()=>{
 assert.equal(typeof policy.rasterRatio,'function');
 for(const [w,h] of [[600,800],[800,600],[50000,20000]])for(const count of [1,2,3,12])for(const dpr of [1,2]){
  const scale=policy.displayScale(w,h,6),width=w*scale,height=h*scale;
  const r=policy.rasterRatio(width,height,dpr,count);
  assert.ok(width*height*r*r*count<=LIMITS.canvasPixels-500000+1e-6);
  assert.ok(width*r<=8192+1e-6);assert.ok(height*r<=8192+1e-6);
 }
});
test('zoom in/out and crop preserve mixed-page reading anchor',()=>{
 const layout=new ContinuousLayout(5000,{width:600,height:800});layout.measure(18,800,600);
 const anchor=layout.anchor(layout.top(18)+251);
 for(const scale of [2,3,6,1,.25,4])for(const crop of [0,.1,.2]){
  layout.configure({scale,crop,pixelRatio:2});const next=layout.anchor(layout.restore(anchor));
  assert.equal(next.page,18);assert.ok(Math.abs(next.fraction-anchor.fraction)<1e-10);
 }
});

test('mixed oversized page never changes neighboring logical zoom',()=>{
 const l=new ContinuousLayout(3,{width:600,height:800}).measure(2,600,2000).configure({scale:4,pixelRatio:2});
 assert.equal(l.size(1).scale,4);assert.equal(l.size(2).scale,3);assert.equal(l.size(3).scale,4);
});

test('zoom buttons disable at actual per-page extent instead of silently no-op',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const source=readFileSync(new URL('../src/reader.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function controls()'),source.indexOf('function clearQuote()'));
 for(const [width,height,shown,plus,minus] of [[600,800,1,false,false],[600,800,6,true,false],[600,2000,3,true,false],[50000,50000,.12,true,true],[600,800,.25,false,true]]){
  const dom=new Map(),state={pdf:{numPages:5},page:{getViewport:()=>({width,height})},pageNumber:1,scale:shown,views:new Map([[1,{scale:shown}]]),history:[]};
  vm.runInNewContext(code+';controls()',{state,displayScale:policy.displayScale,$:id=>{if(!dom.has(id))dom.set(id,{});return dom.get(id)}});
  assert.equal(dom.get('zoom-in').disabled,plus);assert.equal(dom.get('zoom-out').disabled,minus);
 }
});
