import test from 'node:test';
import assert from 'node:assert/strict';
import {ContinuousLayout,visibleWindow} from '../src/continuous-layout.mjs';
import {LIMITS} from '../src/limits.mjs';
import {rasterRatio} from '../src/pdf-policy.mjs';

test('mixed dimensions and crop use variable prefix offsets with fixed gaps',()=>{
 const l=new ContinuousLayout(3,{width:600,height:800,gap:16});
 l.measure(2,800,600);l.configure({scale:1,crop:.1,pixelRatio:1});
 assert.deepEqual(l.size(1),{width:480,height:640,scale:1});
 assert.deepEqual(l.size(2),{width:640,height:480,scale:1});
 assert.equal(l.top(2),656);assert.equal(l.top(3),1152);assert.equal(l.totalHeight,1792);
});
test('anchor keeps the same page/fraction through metadata measurement, zoom and crop',()=>{
 const l=new ContinuousLayout(20);
 const a=l.anchor(l.top(12)+300);
 for(const mutation of [()=>l.measure(3,1400,400),()=>l.measure(12,800,1200),()=>l.configure({scale:2.4}),()=>l.configure({crop:.15,pixelRatio:2})]){
  mutation();const after=l.anchor(l.restore(a));assert.equal(after.page,a.page);assert.ok(Math.abs(after.fraction-a.fraction)<1e-12);
 }
});
test('5000 pages binary lookup resolves each offset and clamps document edges',()=>{
 const l=new ContinuousLayout(5000);
 for(let n=1;n<=5000;n++){if(n%11===0)l.measure(n,1000,500);}
 for(let n=1;n<=5000;n++){assert.equal(l.pageAt(l.top(n)),n);assert.equal(l.pageAt(l.top(n)+l.size(n).height/2),n);}
 assert.equal(l.pageAt(-20),1);assert.equal(l.pageAt(l.totalHeight+20),5000);
 assert.equal(l.restore(l.anchor(l.totalHeight)),l.totalHeight);
});
test('per-page canvas budget and axis limits remain independent of page count',()=>{
 for(const count of [1,2,5000]){
  const l=new ContinuousLayout(count,{width:50000,height:20000});l.configure({scale:3,crop:.2,pixelRatio:2});
  const {scale}=l.size(1);const ratio=rasterRatio(50000*scale,20000*scale,2,3);assert.ok(50000*20000*(scale*ratio)**2<=(LIMITS.canvasPixels-500000)/3+1e-6);
  assert.ok(50000*scale*ratio<=8192);assert.ok(20000*scale*ratio<=8192);
 }
 const one=new ContinuousLayout(1,{width:50000,height:20000});const many=new ContinuousLayout(5000,{width:50000,height:20000});assert.deepEqual(one.size(1),many.size(1));
});
test('invalid metadata/configuration is rejected atomically; returned size is not mutable state',()=>{
 assert.throws(()=>new ContinuousLayout(5001));assert.throws(()=>new ContinuousLayout(0));
 const l=new ContinuousLayout(2);const before=l.totalHeight;
 for(const pair of [[0,3],[NaN,3],[Infinity,2],[1e300,1e300]])assert.throws(()=>l.measure(1,...pair));
 for(const config of [{crop:.5},{scale:0},{pixelRatio:0},{scale:NaN}])assert.throws(()=>l.configure(config));
 assert.equal(l.totalHeight,before);assert.throws(()=>l.measure(3,10,10));
 const size=l.size(1);size.height=0;assert.equal(l.size(1).height,792);
});


test('short landscape pages at 25% fill tall viewport before optional overscan',()=>{
 const l=new ContinuousLayout(100,{width:600,height:200,gap:16});l.configure({scale:.25});
 assert.equal(l.size(1).height,50);
 const window=visibleWindow(l,0,650,100);
 // Visible pages 1..10 (each 66px slot), then one forward overscan page.
 assert.deepEqual(window.pages,Array.from({length:11},(_,i)=>i+1));
 assert.equal(window.truncated,false);
 for(let page=1;page<=10;page++)assert.ok(window.pages.includes(page));
 const middle=visibleWindow(l,l.top(30),650,100);
 assert.deepEqual(middle.pages,Array.from({length:12},(_,i)=>29+i));
 assert.equal(middle.truncated,false);
});

test('very tall viewport enforces 12-page cap and flags undisplayed visible pages',()=>{
 const l=new ContinuousLayout(5000,{width:600,height:200,gap:16});l.configure({scale:.25});
 for(const first of [1,30,1000]){
  const window=visibleWindow(l,l.top(first),2000,5000);
  assert.deepEqual(window.pages,Array.from({length:12},(_,i)=>first+i));
  assert.equal(window.pages.length,12);assert.equal(window.truncated,true);
 }
 const exactlyTwelve=visibleWindow(l,l.top(30),12*66-1,5000);
 assert.deepEqual(exactlyTwelve.pages,Array.from({length:12},(_,i)=>30+i));
 assert.equal(exactlyTwelve.truncated,false); // Overscan never displaces a visible page.
});

test('visible window respects first/last/single-page document edges without duplicates',()=>{
 const l=new ContinuousLayout(100,{width:600,height:200});l.configure({scale:.25});
 assert.deepEqual(visibleWindow(l,0,10,100),{pages:[1,2],truncated:false});
 assert.deepEqual(visibleWindow(l,l.top(99),2000,100),{pages:[98,99,100],truncated:false});
 assert.deepEqual(visibleWindow(l,l.totalHeight,2000,100),{pages:[99,100],truncated:false});
 const one=new ContinuousLayout(1,{width:600,height:200});one.configure({scale:.25});
 assert.deepEqual(visibleWindow(one,0,2000,1),{pages:[1],truncated:false});
 for(const top of [0,l.top(2),l.top(90),l.totalHeight]){
  const {pages}=visibleWindow(l,top,2000,100);
  assert.equal(new Set(pages).size,pages.length);assert.ok(pages.length<=12);
  assert.ok(pages.every(page=>page>=1&&page<=100));
 }
});

test('integer browser scroll rounding does not send an exact page jump to preceding page',()=>{
 const layout=new ContinuousLayout(5000).configure({scale:1.185,crop:0,pixelRatio:1});
 const top=layout.top(5000);assert.equal(layout.pageAt(Math.round(top)),5000);
 assert.equal(layout.anchor(Math.round(top)).page,5000);assert.ok(layout.anchor(Math.round(top)).fraction>=0);
});
