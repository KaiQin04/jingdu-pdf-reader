import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfOptions} from '../src/pdf-policy.mjs';
import {flattenOutline,internalDestination} from '../src/navigation.mjs';
import {searchText} from '../src/search-engine.mjs';
import {preparePdfText,pdfItemsText} from '../src/chat-context.mjs';

// Real parser + committed synthetic fixture; no mocked PageViewport or network.
// Reproduce the app's fixed, offline binary-data allowlist; PDF data never supplies a URL.
const binary=new Map();
for(const [dir,kind] of [['cmaps','cMapUrl'],['standard_fonts','standardFontDataUrl']]){
  const root=new URL(`../node_modules/pdfjs-dist/${dir}/`,import.meta.url);
  for(const filename of await readdir(root)){
    if(!/\.(bcmap|pfb|ttf)$/.test(filename))continue;
    binary.set(`${kind}/${filename}`,new Uint8Array(await readFile(new URL(filename,root))));
  }
}
class OfflineBinaryDataFactory {
  async fetch({kind,filename}){
    const bytes=binary.get(`${kind}/${filename}`);
    if(!bytes)throw new Error('Unsupported built-in data');
    return bytes.slice();
  }
}
async function withAcademicDocument(fn){
  const bytes=await readFile(new URL('./fixtures/academic-navigation.pdf',import.meta.url));
  const task=getDocument(pdfOptions(new Uint8Array(bytes),undefined,OfflineBinaryDataFactory));
  try{await fn(await task.promise);}finally{await task.destroy();}
}
async function destinationPage(doc,dest){
  const resolved=typeof dest==='string'?await doc.getDestination(dest):dest;
  assert.ok(Array.isArray(resolved)&&resolved.length>0);
  return Number.isInteger(resolved[0])?resolved[0]+1:(await doc.getPageIndex(resolved[0]))+1;
}

test('actual PDF.js text from every synthetic page reaches a complete sharing preview',async()=>{
  await withAcademicDocument(async doc=>{
    const preview=await preparePdfText({scope:'document',filename:'academic-synthetic.pdf',pageCount:doc.numPages,readPage:async number=>pdfItemsText((await (await doc.getPage(number)).getTextContent()).items)});
    assert.deepEqual(preview.pages,[1,2,3,4,5,6]);assert.deepEqual(preview.emptyPages,[]);
    for(let number=1;number<=6;number++)assert.ok(preview.text.includes(`--- PDF page ${number} ---`));
    assert.match(preview.text,/Academic sample page 1/);assert.match(preview.text,/Academic sample page 6/);
  });
});

test('actual PDF.js outlines resolve to all six academic fixture pages',async()=>{
  await withAcademicDocument(async doc=>{
    assert.equal(doc.numPages,6);
    const outline=flattenOutline(await doc.getOutline());
    assert.deepEqual(outline.map(item=>item.title),Array.from({length:6},(_,i)=>`Chapter ${i+1}`));
    assert.deepEqual(await Promise.all(outline.map(item=>destinationPage(doc,item.dest))),[1,2,3,4,5,6]);
  });
});

test('actual PDF.js internal links resolve, external URL annotations are filtered inert',async()=>{
  await withAcademicDocument(async doc=>{
    for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i),annotations=await page.getAnnotations({intent:'display'});
      const links=annotations.filter(item=>internalDestination(item));
      const external=annotations.filter(item=>item.url||item.unsafeUrl);
      assert.equal(links.length,1);assert.equal(external.length,1);
      assert.equal(await destinationPage(doc,internalDestination(links[0])),6);
      assert.match(external[0].url,/^https:\/\/example\.invalid\//);
      assert.equal(internalDestination(external[0]),null);
      page.cleanup();
    }
  });
});

test('installed PageViewport point API converts link rectangles for mixed MediaBox and rotation',async()=>{
  await withAcademicDocument(async doc=>{
    for(const number of [1,2]){
      const page=await doc.getPage(number),annotations=await page.getAnnotations();
      const rect=annotations.find(item=>internalDestination(item)).rect;
      const base=page.getViewport({scale:1});
      assert.deepEqual([base.width,base.height],number===1?[600,800]:[800,600]);
      assert.equal(typeof base.convertToViewportPoint,'function');
      for(const rotation of [0,90,180,270]){
        const viewport=page.getViewport({scale:1.5,rotation});
        const a=viewport.convertToViewportPoint(rect[0],rect[1]);
        const b=viewport.convertToViewportPoint(rect[2],rect[3]);
        const box={left:Math.min(a[0],b[0]),top:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])};
        assert.ok(Object.values(box).every(Number.isFinite));
        assert.deepEqual([box.width,box.height],rotation%180===0?[330,37.5]:[37.5,330]);
        assert.ok(box.left>=0&&box.top>=0);
        assert.ok(box.left+box.width<=viewport.width&&box.top+box.height<=viewport.height);
      }
      page.cleanup();
    }
  });
});

test('actual extracted academic text feeds case-sensitive and insensitive search with original context',async()=>{
  await withAcademicDocument(async doc=>{
    const page=await doc.getPage(1);
    const text=(await page.getTextContent()).items.map(item=>item.str??'').join(' ');
    assert.match(text,/Academic sample page 1/);
    assert.match(text,/Alpha alpha economics markets and welfare\./);
    const exact=searchText({id:1,text,query:'Alpha',caseSensitive:true,mode:'literal'});
    const folded=searchText({id:2,text,query:'Alpha',caseSensitive:false,mode:'literal'});
    assert.equal(exact.ok,true);assert.equal(folded.ok,true);
    assert.equal(exact.matches.length,1);assert.equal(folded.matches.length,2);
    for(const match of folded.matches){assert.equal(text.slice(match.start,match.end).toLowerCase(),'alpha');assert.match(match.context,/economics/);}
    page.cleanup();
  });
});


test('actual corrected CNS fixture extracts Chinese and token-AND search matches original Unicode',async()=>{
  await withAcademicDocument(async doc=>{
    const page=await doc.getPage(1);
    const text=(await page.getTextContent()).items.map(item=>item.str??'').join(' ');
    assert.ok(text.includes('經濟制度與市場機制，福利政策與競爭。'));
    const result=searchText({id:3,text,query:'經濟 福利',mode:'tokens',caseSensitive:false});
    assert.equal(result.ok,true);assert.ok(result.matches.length>=2);
    const terms=result.matches.map(match=>text.slice(match.start,match.end));
    assert.ok(terms.includes('經濟'));assert.ok(terms.includes('福利'));
    assert.equal(searchText({id:4,text,query:'經濟 不存在詞彙',mode:'tokens'}).matches.length,0);
    page.cleanup();
  });
});
