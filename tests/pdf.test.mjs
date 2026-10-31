import test from 'node:test';
import assert from 'node:assert/strict';
import {getDocument,AnnotationMode} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';
import { makePdf,writeFixtures } from './fixtures.mjs';
import { checkFile,LIMITS,normalizedText } from '../src/limits.mjs';
import { pdfOptions,checkPageCount,boundedScale } from '../src/pdf-policy.mjs';
await writeFixtures();
async function open(bytes,fn){const task=getDocument(pdfOptions(new Uint8Array(bytes)));try{return await fn(await task.promise);}finally{await task.destroy();}}
test('real PDF engine extracts synthetic pages; search and citation page numbers match',async()=>{
  await open(makePdf(),async doc=>{assert.equal(doc.numPages,3);checkPageCount(doc.numPages);const results=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const text=(await page.getTextContent()).items.map(x=>x.str??'').join(' ');if(normalizedText(text).includes('aurora'))results.push(page.pageNumber);page.cleanup();}assert.deepEqual(results,[2]);});
});
test('actual canvas rendering produces a nonempty PNG',async()=>{
  await open(makePdf({pages:1}),async doc=>{const page=await doc.getPage(1);const viewport=page.getViewport({scale:1});const canvas=createCanvas(viewport.width,viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:AnnotationMode.DISABLE}).promise;const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;assert.ok(data.some((v,i)=>i%4!==3 && v<100));await writeFile(new URL('../evidence/synthetic-page.png',import.meta.url),canvas.toBuffer('image/png'));});
});
test('damaged PDF is rejected by actual parser',async()=>{await assert.rejects(()=>open(Buffer.from('%PDF-1.7\nnot a PDF'),async()=>{}));});
test('empty, nonempty and oversized files enforce 500 MiB before parsing',()=>{assert.throws(()=>checkFile({size:0}),/EMPTY/);assert.throws(()=>checkFile({size:LIMITS.fileBytes+1}),/SIZE/);assert.doesNotThrow(()=>checkFile({size:LIMITS.fileBytes}));});
test('actual 301-page PDF is now accepted by shared page limit',async()=>{await open(makePdf({pages:301}),async doc=>{assert.equal(doc.numPages,301);assert.doesNotThrow(()=>checkPageCount(doc.numPages));});});
test('very large page dimensions remain inside canvas area/axis budget',async()=>{await open(makePdf({pages:1,hugePage:true}),async doc=>{const viewport=(await doc.getPage(1)).getViewport({scale:1});const scale=boundedScale(viewport.width,viewport.height,3,2);assert.ok(viewport.width*viewport.height*(scale*2)**2<=LIMITS.canvasPixels+1);assert.ok(viewport.width*scale*2<=8192);});});
test('synthetic JS, Launch, URL annotations and embedded attachment exist but low-level rendering is inert',async()=>{
  globalThis.__pdfActionRan=false;const bytes=makePdf({pages:1,actions:true});assert.match(bytes.toString(),/\/S \/Launch/);assert.match(bytes.toString(),/\/OpenAction/);
  await open(bytes,async doc=>{const actions=await doc.getJSActions();assert.ok(actions);const attachments=await doc.getAttachments();assert.equal(attachments.size,1);const page=await doc.getPage(1);const annotations=await page.getAnnotations();assert.ok(annotations.some(a=>a.url?.startsWith('https://example.invalid')));const viewport=page.getViewport({scale:1});const canvas=createCanvas(viewport.width,viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:AnnotationMode.DISABLE}).promise;assert.equal(globalThis.__pdfActionRan,false);});
});
test('repeated actual engine open-render-close cycles release loading tasks',async()=>{
  for(let i=0;i<20;i++)await open(makePdf({pages:1}),async doc=>{const page=await doc.getPage(1);assert.ok((await page.getTextContent()).items.length);await doc.cleanup();});
});
test('book limits admit 500 MiB and 5000 pages but reject larger inputs',()=>{
  assert.doesNotThrow(()=>checkFile({size:500*1024*1024}));
  assert.doesNotThrow(()=>checkPageCount(5000));
  assert.throws(()=>checkPageCount(5001),/PAGES/);
});
test('local range transport reads requested slices, aborts, and rejects unsafe ranges',async()=>{
  const policy=await import('../src/pdf-policy.mjs');assert.equal(typeof policy.localRangeTransport,'function');
  const {PDFDataRangeTransport}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes=makePdf({pages:5000}),blob=new Blob([bytes]);let reads=0,errors=[];
  const file={size:blob.size,slice:(...a)=>{reads++;return blob.slice(...a);}};
  const range=policy.localRangeTransport(PDFDataRangeTransport,file,new Uint8Array(await blob.slice(0,65536).arrayBuffer()),e=>errors.push(e));
  const task=getDocument({...pdfOptions(undefined),range,disableRange:false,rangeChunkSize:65536});
  try {const doc=await task.promise;assert.equal(doc.numPages,5000);assert.match((await (await doc.getPage(5000)).getTextContent()).items.map(x=>x.str).join(' '),/Page 5000/);assert.ok(reads>0);assert.equal(errors.length,0);}finally{await task.destroy();}
  const received=[];const second=policy.localRangeTransport(PDFDataRangeTransport,file,new Uint8Array(),e=>errors.push(e));second.transportReady(x=>received.push(x));second.requestDataRange(-1,12);assert.equal(errors[0].message,'RANGE');second.abort();second.requestDataRange(0,8);await new Promise(r=>setTimeout(r,10));assert.equal(received.length,0);
});
test('bounded page text cache evicts oldest entries instead of rejecting large books',async()=>{
 const policy=await import('../src/pdf-policy.mjs');assert.equal(typeof policy.PageTextCache,'function');
 const cache=new policy.PageTextCache(2,10);cache.set(1,{plain:'abcd'});cache.set(2,{plain:'efgh'});cache.set(3,{plain:'ijk'});assert.equal(cache.get(1),undefined);assert.equal(cache.get(3).plain,'ijk');assert.ok(cache.chars<=10);cache.clear();assert.equal(cache.chars,0);
});
