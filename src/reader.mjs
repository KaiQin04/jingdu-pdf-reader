import { getDocument, PDFWorker, PDFDataRangeTransport, TextLayer, AnnotationMode } from 'pdfjs-dist/build/pdf.mjs';
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { LIMITS, checkFile, normalizedText } from './limits.mjs';
import { pdfOptions, checkPageCount, displayScale, rasterRatio as boundedRasterRatio, localRangeTransport, PageTextCache } from './pdf-policy.mjs';
import { pageWindow, internalDestination, flattenOutline } from './navigation.mjs';
import { ContinuousLayout, visibleWindow } from './continuous-layout.mjs';
import { SEARCH_WORKER_SOURCE } from './search-engine.mjs';
import { AnnotationStore, ANNOTATION_COLORS, normalizePageRect } from './annotations.mjs';
const $ = id => document.getElementById(id);
const state = { epoch:0, pdf:null, task:null, worker:null, rawWorker:null, workerUrl:null, render:null, textLayer:null, page:null, pageNumber:1, scale:1, busy:false, name:'', cache:new PageTextCache(), range:null, searching:false, searchCancel:false, searchNext:1, searchQuery:'', searchCount:0, selection:'', selectionPage:0, selectionRects:[], views:new Map(), mode:'continuous', crop:0, other:1, history:[], layout:null, fitWidth:true, scrollVersion:0, programScroll:null, pendingPage:null, notes:null, tab:'search', thumbStart:1, outlineLoaded:false, searchWorker:null, searchWorkerUrl:null, searchRequest:0, exportData:null, pendingAction:null };
const ERRORS = { EMPTY:'文件是空的。請選擇有效 PDF。', SIZE:'超過 500 MiB 上限。請先分卷；大檔需要較多裝置記憶體。', RANGE:'文件要求過大的單次讀取或讀取失敗，已停止。請重新儲存或分卷後再試。', HEADER:'這不是可辨識的 PDF 文件。', PAGES:'超過 5,000 頁上限，請先分卷。', PASSWORD:'此原型不開啟加密或需要密碼的 PDF。', TEXT:'文件文字量超過此原型的處理上限。', TIMEOUT:'處理逾時，已關閉文件。可嘗試較小的 PDF。', WORKER:'無法啟動隔離解析器，已停止。請使用支援 Web Worker 的瀏覽器或宿主。', INVALID:'PDF 損壞、使用不支援的格式，或無法完成解析。' };
function status(message, error=false) { $('status').textContent=message; $('status').dataset.error=String(error); }
function controls() {
  const ready=!!state.pdf && !state.busy;
  $('back').disabled=!ready||!state.history.length;
  for(const id of ['view-mode','split-page','crop','note-highlight','note-underline','note-save','draw-mode','case-sensitive','search-mode'])$(id).disabled=!ready;
  $('search-cancel').hidden=!state.searching;
  $('search-next').hidden=!state.pdf||state.searchNext>state.pdf.numPages||!state.searchQuery;
  $('search-next').disabled=!ready;
  for(const id of ['page-number','zoom-out','zoom-in','fit','query','search','cite']) $(id).disabled=!ready;
  const base=state.page?.getViewport({scale:1}),shown=state.views.get(state.pageNumber)?.scale??state.scale;
  $('zoom-in').disabled=!ready||!base||displayScale(base.width,base.height,shown+.2)<=shown+1e-8;
  $('zoom-out').disabled=!ready||!base||displayScale(base.width,base.height,shown-.2)>=shown-1e-8;
  $('prev').disabled=!ready || state.pageNumber<=1;
  $('next').disabled=!ready || state.pageNumber>=state.pdf.numPages;
  $('close').disabled=!state.task && !state.busy && !state.notes;
  $('page-number').value=state.pageNumber;
  $('page-count').textContent=`／${state.pdf?.numPages ?? 0}`;
  $('zoom').textContent=`${Math.round((state.views.get(state.pageNumber)?.scale??state.scale)*100)}%`;
}
function clearQuote(){ state.selection=''; state.selectionPage=0;state.selectionRects=[]; $('citation').value=''; $('copy').disabled=true; window.getSelection()?.removeAllRanges(); }
function closeDocument(message='文件已關閉，閱讀器記憶體中的引用與搜尋已清除。') {
  ++state.epoch;state.searchCancel=true;state.range?.abort();stopSearchWorker();clearViews();clearThumbnails();state.notes=null;state.pendingAction=null;state.thumbStart=1;state.history=[];state.outlineLoaded=false;state.pendingPage=null;state.layout=null;state.programScroll=null;state.exportData=null;$('pages').style.height='';$('pages').style.width='';$('note-list').replaceChildren();$('outline').textContent='開啟文件後可讀取目錄。';$('export-preview').value='';$('region-preview').hidden=true;$('region-preview').removeAttribute('src');$('note-comment').value='';$('host-download').disabled=true;$('discard-dialog').hidden=true;
  setToolsOpen(false,false);
  state.render?.cancel(); state.textLayer?.cancel();
  // Terminate first: cleanup must never wait on an unresponsive PDF worker.
  state.rawWorker?.terminate(); state.worker?.destroy();
  state.task?.destroy().catch(()=>{});
  if(state.workerUrl) URL.revokeObjectURL(state.workerUrl);
  Object.assign(state,{pdf:null,task:null,worker:null,rawWorker:null,workerUrl:null,render:null,textLayer:null,page:null,pageNumber:1,scale:1,busy:false,name:'',range:null,searching:false,searchCancel:false,searchNext:1,searchQuery:'',searchCount:0});
  state.cache.clear(); clearQuote();
  $('file').value=''; $('filename').textContent='尚未選擇文件'; $('query').value=''; $('results').replaceChildren(); $('search-summary').textContent='搜尋有文字層的 PDF；掃描檔尚不支援 OCR。';
  $('text-layer').replaceChildren(); $('canvas').width=0; $('canvas').height=0; $('page').hidden=true; $('empty').hidden=false;
  controls(); status(message);
}
function fail(error,epoch){
  if(epoch!==state.epoch)return;
  const code=error?.name==='PasswordException'?'PASSWORD':error?.message;
  const savedNotes=state.notes,draft=$('note-comment').value;closeDocument();state.notes=savedNotes;$('note-comment').value=draft;refreshNotes();controls();if(savedNotes?.size||draft){setTab('notes');setToolsOpen(true);status(`${ERRORS[code] ?? ERRORS.INVALID} 已存註記仍保留，可先匯出；未存留言請先複製。`,true);}else status(ERRORS[code] ?? ERRORS.INVALID,true);
}
async function deadline(promise,epoch,ms=LIMITS.operationMs){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{if(epoch===state.epoch) fail(new Error('TIMEOUT'),epoch);reject(new Error('TIMEOUT'));},ms);})]);}
  finally{clearTimeout(timer);}
}
const binary=PDF_BINARY_DATA;
class OfflineBinaryDataFactory {
  async fetch({kind,filename}) {
    const key=`${kind}/${filename}`;
    if(!Object.hasOwn(binary,key)) throw new Error('Unsupported built-in data');
    return Uint8Array.from(atob(binary[key]),c=>c.charCodeAt(0));
  }
}
async function pageText(page,epoch){
  const cached=state.cache.get(page.pageNumber);if(cached)return cached;
  const text=await deadline(page.getTextContent(),epoch);
  if(epoch!==state.epoch)throw new Error('STALE');
  if(text.items.length>LIMITS.pageItems)throw new Error('TEXT');
  let chars=0;
  for(const item of text.items){chars+=(item.str?.length??0);if(chars>LIMITS.pageChars)throw new Error('TEXT');}
  const entry={text,plain:text.items.map(x=>x.str??'').join(' ')};
  state.cache.set(page.pageNumber,entry);
  return entry;
}
function clearViews(){
  for(const view of state.views.values()){view.render?.cancel();view.textLayer?.cancel();view.page?.cleanup();view.canvas.width=0;view.canvas.height=0;if(view.frame.id!=='primary-frame')view.frame.remove();}
  state.views.clear();$('page').hidden=true;$('primary-frame').hidden=true;
}
function makeView(number,primary){
 const frame=primary?$('primary-frame'):document.createElement('div');frame.className='sheet-frame';frame.hidden=false;
 const surface=primary?$('page'):document.createElement('div');surface.className='page-surface';surface.hidden=false;surface.dataset.page=String(number);surface.dataset.draw=$('draw-mode').value;
 if(!primary){surface.append(document.createElement('canvas'));const text=document.createElement('div');text.className='textLayer';surface.append(text);const links=document.createElement('div');links.className='link-layer';surface.append(links);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('annotation-layer');surface.append(svg);frame.append(surface);$('pages').append(frame);}
 const view={number,frame,surface,canvas:surface.querySelector('canvas'),text:surface.querySelector('.textLayer'),links:surface.querySelector('.link-layer'),notes:surface.querySelector('.annotation-layer'),page:null,render:null,textLayer:null};
 view.text.replaceChildren();view.links.replaceChildren();view.notes.replaceChildren();state.views.set(number,view);attachDrawing(view);return view;
}
async function renderPage(number,scale=state.scale,options={}){
  if(!state.pdf)return;
  if(number&&typeof number==='object'){options={...options,anchor:number};number=number.page;}
  if(state.busy&&!options.force){state.pendingPage={number,scale,options};return;}
  const epoch=state.epoch,doc=state.pdf,startedScrollVersion=state.scrollVersion;number=Math.max(1,Math.min(doc.numPages,Math.trunc(number)||1));
  if(options.history&&number!==state.pageNumber){state.history.push(readingAnchor());if(state.history.length>100)state.history.shift();}
  state.busy=true;controls();clearQuote();
  try{
    const previous=[...state.views.values()];for(const v of previous){v.render?.cancel();v.textLayer?.cancel();}await Promise.all(previous.map(v=>v.render?.promise.catch(()=>{})));if(epoch!==state.epoch||doc!==state.pdf)return;
    clearViews();await deadline(doc.cleanup(),epoch);if(epoch!==state.epoch)return;
    const page=await deadline(doc.getPage(number),epoch);if(epoch!==state.epoch)return;
    const original=page.getViewport({scale:1}),ratio=Math.min(window.devicePixelRatio||1,2);let numbers=pageWindow(state.mode,number,doc.numPages,state.other),windowTruncated=false;
    if(options.fit){state.fitWidth=true;const columns=state.mode==='double'||state.mode==='split'?numbers.length:1;scale=($('viewport').clientWidth-24-(columns-1)*12)/columns/original.width/(1-2*state.crop);}
    scale=Math.max(.25,Math.min(6,scale));
    const loaded=new Map([[number,page]]);
    let anchor=options.anchor??((options.scroll||options.preserve)?readingAnchor():{page:number,fraction:0});
    if(state.scrollVersion!==startedScrollVersion&&state.mode==='continuous'){state.pendingPage={number:state.layout?.pageAt($('viewport').scrollTop)??number,scale,options:{scroll:true}};return;}
    if(state.mode==='continuous'){
      if(!state.layout)state.layout=new ContinuousLayout(doc.numPages,{width:original.width,height:original.height});
      state.layout.measure(number,original.width,original.height);state.layout.configure({scale,crop:state.crop,pixelRatio:ratio});$('pages').style.height=`${continuousRailHeight()}px`;setReadingScroll(state.layout.restore(anchor));
      // At most 12 distinct pages acquired per render. Replan as estimates become actual metadata.
      for(let pass=0;pass<12;pass++){
        const plan=visibleWindow(state.layout,state.layout.restore(anchor),$('viewport').clientHeight,doc.numPages);numbers=plan.pages;windowTruncated=plan.truncated;
        const next=numbers.find(n=>!loaded.has(n));if(next===undefined||loaded.size>=12)break;
        const neighbour=await deadline(doc.getPage(next),epoch);if(epoch!==state.epoch||doc!==state.pdf)return;
        if(state.scrollVersion!==startedScrollVersion){neighbour.cleanup();state.pendingPage={number:state.layout.pageAt($('viewport').scrollTop),scale,options:{scroll:true}};return;}
        loaded.set(next,neighbour);const base=neighbour.getViewport({scale:1});state.layout.measure(next,base.width,base.height);$('pages').style.height=`${continuousRailHeight()}px`;setReadingScroll(state.layout.restore(anchor));
      }
      numbers=numbers.filter(n=>loaded.has(n));
    }else for(const n of numbers){if(!loaded.has(n)){const neighbour=await deadline(doc.getPage(n),epoch);if(epoch!==state.epoch)return;loaded.set(n,neighbour);}}
    if(epoch!==state.epoch)return;
    state.page=page;state.pageNumber=number;state.scale=scale;
    $('pages').dataset.mode=state.mode;$('empty').hidden=true;
    if(state.mode==='continuous'){
      $('pages').style.height=`${continuousRailHeight()}px`;
      const widest=Math.max(...numbers.map(n=>state.layout.size(n).width));$('pages').style.width=`${Math.max($('viewport').clientWidth-24,widest)}px`;
      setReadingScroll(state.layout.restore(anchor));
    }else{$('pages').style.height='';$('pages').style.width='';}
    for(const n of numbers){
      if(epoch!==state.epoch)return;
      const p=loaded.get(n);if(epoch!==state.epoch)return;const base=p.getViewport({scale:1});
      const desired=state.mode==='continuous'?state.layout.size(n).scale:displayScale(base.width,base.height,scale);
      const vp=p.getViewport({scale:desired}),v=makeView(n,n===number);v.page=p;v.viewport=vp;v.scale=desired;
      const rasterRatio=boundedRasterRatio(vp.width,vp.height,ratio,numbers.length);
      v.canvas.width=Math.max(1,Math.floor(vp.width*rasterRatio));v.canvas.height=Math.max(1,Math.floor(vp.height*rasterRatio));v.canvas.style.width=`${vp.width}px`;v.canvas.style.height=`${vp.height}px`;
      v.surface.style.width=`${vp.width}px`;v.surface.style.height=`${vp.height}px`;v.surface.style.setProperty('--scale-factor',String(desired));v.surface.style.setProperty('--total-scale-factor',String(desired));
      v.surface.style.transform=`translate(${-state.crop*vp.width}px,${-state.crop*vp.height}px)`;v.frame.style.width=`${vp.width*(1-2*state.crop)}px`;v.frame.style.height=`${vp.height*(1-2*state.crop)}px`;
      v.frame.style.position=state.mode==='continuous'?'absolute':'relative';v.frame.style.top=state.mode==='continuous'?`${state.layout.top(n)}px`:'';v.frame.style.left=state.mode==='continuous'?'50%':'';v.frame.style.transform=state.mode==='continuous'?'translateX(-50%)':'';
      v.render=p.render({canvasContext:v.canvas.getContext('2d',{alpha:false}),viewport:vp,transform:[rasterRatio,0,0,rasterRatio,0,0],annotationMode:AnnotationMode.DISABLE});state.render=v.render;
      await deadline(v.render.promise,epoch);if(epoch!==state.epoch)return;
      const entry=await pageText(p,epoch);v.textLayer=new TextLayer({textContentSource:entry.text,container:v.text,viewport:vp});state.textLayer=v.textLayer;await deadline(v.textLayer.render(),epoch);if(epoch!==state.epoch)return;
      const normalize=value=>$('case-sensitive').checked?value.normalize('NFKC'):normalizedText(value);const query=normalize($('query').value.trim());if(query&&$('search-mode').value==='literal')for(const span of v.text.querySelectorAll('span'))if(normalize(span.textContent).includes(query))span.classList.add('found');
      const annotations=await deadline(p.getAnnotations({intent:'display'}),epoch);if(epoch!==state.epoch)return;
      for(const a of annotations.slice(0,1000)){const dest=internalDestination(a);if(!dest||!Array.isArray(a.rect)||a.rect.length!==4)continue;const rect=[...vp.convertToViewportPoint(a.rect[0],a.rect[1]),...vp.convertToViewportPoint(a.rect[2],a.rect[3])];if(!rect.every(Number.isFinite))continue;const button=document.createElement('button');button.setAttribute('aria-label','前往文件內部連結');Object.assign(button.style,{left:`${Math.min(rect[0],rect[2])}px`,top:`${Math.min(rect[1],rect[3])}px`,width:`${Math.abs(rect[2]-rect[0])}px`,height:`${Math.abs(rect[3]-rect[1])}px`});button.addEventListener('click',()=>void followDestination(dest));v.links.append(button);}
      paintNotes(v);
    }
    if(state.mode!=='continuous')$('viewport').scrollTop=0;
    status(`第 ${number}／${doc.numPages} 頁 · ${state.views.size} 個可見／鄰頁${windowTruncated?' · 頁面過小，請放大以顯示完整可見區域':''}`,windowTruncated);
  }catch(error){fail(error,epoch);}
  finally{if(epoch===state.epoch){state.busy=false;controls();const pending=state.pendingPage;state.pendingPage=null;if(pending&&(pending.number!==state.pageNumber||!pending.options.scroll||state.views.size===0))void renderPage(pending.number,pending.scale,pending.options);else if(state.mode==='continuous'&&state.layout){const visible=state.layout.pageAt($('viewport').scrollTop);if(visible!==state.pageNumber)void renderPage(visible,state.scale,{scroll:true});}}}
}
async function followDestination(dest){
 if(!state.pdf||state.busy)return;const epoch=state.epoch;try{if(typeof dest==='string')dest=await deadline(state.pdf.getDestination(dest),epoch);if(!Array.isArray(dest)||!dest.length)return;let n=dest[0];if(typeof n==='object'&&n&&Number.isInteger(n.num)&&Number.isInteger(n.gen))n=await deadline(state.pdf.getPageIndex(n),epoch);if(epoch!==state.epoch||!Number.isInteger(n)||n<0||n>=state.pdf.numPages)return;setToolsOpen(false,false);await renderPage(n+1,state.scale,{history:true});}catch{status('這個內部目標無法解析；沒有開啟外部網址。',true);}
}
function continuousRailHeight(){return state.layout.totalHeight+Math.max(0,$('viewport').clientHeight-state.layout.size(state.pdf.numPages).height);}
function readingAnchor(){return state.mode==='continuous'&&state.layout?state.layout.anchor($('viewport').scrollTop):{page:state.pageNumber,fraction:0};}
function setReadingScroll(top){const viewport=$('viewport');viewport.scrollTop=top;state.programScroll=viewport.scrollTop;}
$('viewport').addEventListener('scroll',()=>{
 if(state.mode!=='continuous'||!state.pdf||!state.layout)return;
 const top=$('viewport').scrollTop;if(state.programScroll!==null&&Math.abs(top-state.programScroll)<1){state.programScroll=null;return;}state.programScroll=null;++state.scrollVersion;
 const n=state.layout.pageAt(top);if(n!==state.pageNumber&&!state.searching)void renderPage(n,state.scale,{scroll:true});
});
let resizeTimer,observedWidth=0,observedHeight=0;
new ResizeObserver(entries=>{const {width,height}=entries[0]?.contentRect??{};if(!width||!height)return;const widthChanged=Math.abs(width-observedWidth)>=1,heightChanged=Math.abs(height-observedHeight)>=1;if(!widthChanged&&!heightChanged)return;observedWidth=width;observedHeight=height;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.pdf&&state.mode==='continuous')void renderPage(state.layout?.pageAt($('viewport').scrollTop)??state.pageNumber,state.scale,{preserve:true,fit:state.fitWidth&&widthChanged});},100);}).observe($('viewport'));

async function openFile(file,approved=false){
  if(!approved&&(state.notes?.size||$('note-comment').value.trim())){requestDiscard(()=>void openFile(file,true));return;}
  closeDocument('正在本機開啟 PDF…');
  const epoch=state.epoch; state.busy=true;controls();
  try{
    checkFile(file);
    const data=new Uint8Array(await deadline(file.slice(0,LIMITS.rangeChunkBytes).arrayBuffer(),epoch));
    if(epoch!==state.epoch)return;
    if(!/^%PDF-\d\.\d/.test(new TextDecoder('ascii').decode(data.subarray(0,8))))throw new Error('HEADER');
    state.name=file.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'document.pdf';
    $('filename').textContent=state.name;
    state.workerUrl=URL.createObjectURL(new Blob([PDF_WORKER_SOURCE],{type:'text/javascript'}));
    state.rawWorker=new Worker(state.workerUrl,{name:'private-pdf-parser'});
    state.rawWorker.onerror=()=>fail(new Error('WORKER'),epoch);
    state.worker=new PDFWorker({port:state.rawWorker});
    await deadline(state.worker.promise,epoch);
    if(epoch!==state.epoch)return;
    state.range=localRangeTransport(PDFDataRangeTransport,file,data,error=>fail(error,epoch));
    state.task=getDocument({...pdfOptions(undefined,state.worker,OfflineBinaryDataFactory),range:state.range,disableRange:false,rangeChunkSize:LIMITS.rangeChunkBytes});
    // No PDFViewer, AnnotationLayer, scripting manager, attachments or action handlers are instantiated.
    // In 6.4.299 eval support was removed from the low-level renderer; do not pretend an ignored option protects us.
    const doc=await deadline(state.task.promise,epoch);
    if(epoch!==state.epoch)return;
    checkPageCount(doc.numPages);
    state.pdf=doc;state.notes=new AnnotationStore({fingerprints:doc.fingerprints,pageCount:doc.numPages,filename:state.name});$('page-number').max=doc.numPages;$('split-page').max=doc.numPages;
    await renderPage(1,Math.max(.25,($('viewport').clientWidth-24)/612),{force:true,fit:true});
  }catch(error){fail(error,epoch);}
  finally{if(epoch===state.epoch){state.busy=false;controls();}}
}
function setToolsOpen(open,restoreFocus=true){
  $('tools-panel').hidden=!open;
  $('tools-toggle').setAttribute('aria-expanded',String(open));
  if(open){(state.tab==='search'&&!$('query').disabled?$('query'):$('tools-close')).focus();if(state.tab==='nav')void loadNavigation();}else{clearThumbnails();if(restoreFocus)$('tools-toggle').focus();}
}
$('tools-toggle').addEventListener('click',()=>setToolsOpen($('tools-panel').hidden));
$('tools-close').addEventListener('click',()=>setToolsOpen(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('tools-panel').hidden){event.preventDefault();setToolsOpen(false);}});
$('file').addEventListener('change',()=>{const file=$('file').files?.[0];if(file)void openFile(file);});
$('close').addEventListener('click',()=>requestDiscard(()=>closeDocument()));
$('prev').addEventListener('click',()=>void renderPage(state.pageNumber-1));
$('next').addEventListener('click',()=>void renderPage(state.pageNumber+1));
$('page-number').addEventListener('change',()=>void renderPage(Number($('page-number').value)));
$('page-number').addEventListener('keydown',event=>{if(event.key==='Enter'&&!state.busy){event.preventDefault();void renderPage(Number($('page-number').value));}});
$('zoom-in').addEventListener('click',()=>{state.fitWidth=false;void renderPage(state.pageNumber,(state.views.get(state.pageNumber)?.scale??state.scale)+.2,{preserve:true});});
$('zoom-out').addEventListener('click',()=>{state.fitWidth=false;void renderPage(state.pageNumber,(state.views.get(state.pageNumber)?.scale??state.scale)-.2,{preserve:true});});
$('fit').addEventListener('click',()=>void renderPage(state.pageNumber,state.scale,{fit:true,preserve:true}));
async function searchDocument(event,resume=false){
  event.preventDefault();if(!state.pdf||state.busy)return;
  const query=$('query').value.trim(),searchKey=JSON.stringify([query,$('search-mode').value,$('case-sensitive').checked]);
  if(!query){$('search-summary').textContent='請輸入搜尋文字。';return;}
  if(!resume||searchKey!==state.searchQuery){state.searchNext=1;state.searchCount=0;state.searchQuery=searchKey;$('results').replaceChildren();}
  const epoch=state.epoch,doc=state.pdf,start=performance.now();let processed=0;
  state.busy=true;state.searching=true;state.searchCancel=false;controls();
  try{
    for(let i=state.searchNext;i<=doc.numPages;i++){
      if(state.searchCancel||epoch!==state.epoch)break;
      const page=await deadline(doc.getPage(i),epoch);if(epoch!==state.epoch)return;
      const entry=await pageText(page,epoch);if(epoch!==state.epoch)return;
      const result=await searchPage(entry.plain,query,epoch);if(epoch!==state.epoch)return;const match=result.matches[0];
      state.searchNext=i+1;processed++;
      if(match){
        const li=document.createElement('li'),button=document.createElement('button');
        button.textContent=`第 ${i} 頁 · ${match.context}`;
        button.addEventListener('click',()=>{if(!state.busy){setToolsOpen(false,false);void renderPage(i,state.scale,{history:true});$('viewport').focus();}});li.append(button);$('results').append(li);state.searchCount++;
      }
      if(!state.views.has(i))page.cleanup();
      $('search-summary').textContent=`找到 ${state.searchCount} 個符合頁面 · 已搜尋 ${i}／${doc.numPages} 頁`;
      // Return control to the browser between pages so cancel/close remains usable.
      await new Promise(resolve=>setTimeout(resolve,0));
      if(processed%20===0)await deadline(doc.cleanup(true),epoch);
      if(state.searchCount>=LIMITS.matches||processed>=LIMITS.searchBatchPages||performance.now()-start>=LIMITS.searchMs)break;
    }
    if(epoch!==state.epoch)return;
    await deadline(doc.cleanup(true),epoch);
    const complete=state.searchNext>doc.numPages,limit=state.searchCount>=LIMITS.matches;
    $('search-summary').textContent=`找到 ${state.searchCount} 個符合頁面（已搜尋 ${state.searchNext-1}／${doc.numPages} 頁） · ${limit?'已達 200 個結果上限；請縮小關鍵字':complete?'搜尋完成':state.searchCancel?'已暫停，可繼續搜尋':'本批完成，可繼續搜尋'}。掃描無文字頁不做 OCR。`;
    status(complete?'搜尋完成。':'搜尋已暫停，文件仍可閱讀。');
    if(limit)state.searchNext=doc.numPages+1;
  }catch(error){if(epoch===state.epoch){$('search-summary').textContent=error.message==='SEARCH_TIMEOUT'?'正則／搜尋超時，已終止隔離 worker；文件仍可閱讀。':`搜尋未完成：${error.message}`;status('搜尋已停止，文件仍可閱讀。',true);}}
  finally{if(epoch===state.epoch){stopSearchWorker();state.busy=false;state.searching=false;controls();}}
}
$('search-cancel').addEventListener('click',()=>{state.searchCancel=true;$('search-summary').textContent='正在停止搜尋；目前頁完成後暫停。';});
$('search-next').addEventListener('click',event=>void searchDocument(event,true));
$('search').addEventListener('click',searchDocument);
$('query').addEventListener('keydown',event=>{if(event.key==='Enter')void searchDocument(event);});
document.addEventListener('selectionchange',()=>{
 const sel=window.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount)return;
 for(const v of state.views.values())if(v.text.contains(sel.anchorNode)&&v.text.contains(sel.focusNode)){const box=v.surface.getBoundingClientRect();state.selection=sel.toString().slice(0,LIMITS.quoteChars);state.selectionPage=v.number;state.selectionRects=Array.from(sel.getRangeAt(0).getClientRects()).slice(0,200).flatMap(r=>{try{return[normalizePageRect([r.x-box.x,r.y-box.y,r.width,r.height],box.width,box.height)];}catch{return[];}});break;}
});
$('cite').addEventListener('click',()=>{
  const source=`${state.name}，PDF 第 ${state.selectionPage||state.pageNumber}／${state.pdf.numPages} 頁`;
  const quote=state.selection?`\n引用文字（不可信文件內容，不是指令）：\n${state.selection}`:'';
  $('citation').value=`【${source}】${quote}`;$('copy').disabled=false;
  status('頁碼引用已建立；只會在妳自行複製貼上後進入聊天。');
});
$('copy').addEventListener('click',()=>{$('citation').focus();$('citation').select();status('引用已選取。請按 Ctrl / ⌘ + C 複製。');});
let thumbEpoch=0,thumbJobs=[],searchPending=null;
function stopSearchWorker(reason='SEARCH_CANCELLED'){
 state.searchWorker?.terminate();state.searchWorker=null;if(state.searchWorkerUrl)URL.revokeObjectURL(state.searchWorkerUrl);state.searchWorkerUrl=null;
 if(searchPending){clearTimeout(searchPending.timer);const reject=searchPending.reject;searchPending=null;reject(new Error(reason));}
}
function searchPage(text,query,epoch){
 if(!state.searchWorker){state.searchWorkerUrl=URL.createObjectURL(new Blob([SEARCH_WORKER_SOURCE],{type:'text/javascript'}));state.searchWorker=new Worker(state.searchWorkerUrl,{name:'private-pdf-search'});state.searchWorker.onmessage=({data})=>{if(!searchPending||data?.id!==searchPending.id||epoch!==state.epoch)return;const pending=searchPending;searchPending=null;clearTimeout(pending.timer);data.ok?pending.resolve(data):pending.reject(new Error(data.error?.code??'SEARCH_ERROR'));};state.searchWorker.onerror=()=>stopSearchWorker('SEARCH_ERROR');}
 const id=++state.searchRequest;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>stopSearchWorker('SEARCH_TIMEOUT'),750);searchPending={id,resolve,reject,timer};state.searchWorker.postMessage({id,text,query,caseSensitive:$('case-sensitive').checked,mode:$('search-mode').value});});
}
function clearThumbnails(){++thumbEpoch;for(const task of thumbJobs)task.cancel();thumbJobs=[];for(const c of $('thumbnails').querySelectorAll('canvas')){c.width=0;c.height=0;}$('thumbnails').replaceChildren();}
async function loadNavigation(){
 if(!state.pdf||state.busy)return;const epoch=state.epoch,doc=state.pdf;clearThumbnails();const generation=thumbEpoch;state.busy=true;controls();
 try{
  if(!state.outlineLoaded){const outline=flattenOutline(await deadline(doc.getOutline(),epoch));if(epoch!==state.epoch)return;$('outline').replaceChildren();for(const item of outline){const b=document.createElement('button');b.textContent=item.title;b.style.paddingLeft=`${8+item.depth*10}px`;b.addEventListener('click',()=>void followDestination(item.dest));$('outline').append(b);}if(!outline.length)$('outline').textContent='這份 PDF 沒有可用的內部目錄。';state.outlineLoaded=true;}
  for(let i=state.thumbStart;i<=Math.min(doc.numPages,state.thumbStart+7);i++){
   if(epoch!==state.epoch||generation!==thumbEpoch)return;const page=await deadline(doc.getPage(i),epoch);if(epoch!==state.epoch||generation!==thumbEpoch)return;const base=page.getViewport({scale:1}),scale=Math.min(140/base.width,180/base.height),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
   const b=document.createElement('button'),label=document.createElement('span');label.textContent=`第 ${i} 頁`;b.append(canvas,label);b.addEventListener('click',()=>{if(!state.busy){setToolsOpen(false,false);void renderPage(i,state.scale,{history:true});}});$('thumbnails').append(b);
   const task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,annotationMode:AnnotationMode.DISABLE});thumbJobs.push(task);await deadline(task.promise,epoch);if(!state.views.has(i))page.cleanup();
  }
 }catch(error){if(epoch===state.epoch&&generation===thumbEpoch)status('縮圖／目錄未能完成；仍可用頁碼閱讀。',true);}
 finally{if(epoch===state.epoch){state.busy=false;controls();}}
}
function setTab(tab){state.tab=tab;for(const name of ['nav','search','notes','view']){$(`panel-${name}`).hidden=name!==tab;$(`tab-${name}`).setAttribute('aria-selected',String(name===tab));}if(tab==='nav')void loadNavigation();else clearThumbnails();if(tab==='notes')refreshNotes();}
for(const tab of ['nav','search','notes','view'])$(`tab-${tab}`).addEventListener('click',()=>setTab(tab));
$('thumb-prev').addEventListener('click',()=>{if(!state.busy){state.thumbStart=Math.max(1,state.thumbStart-8);void loadNavigation();}});
$('thumb-next').addEventListener('click',()=>{if(state.pdf&&!state.busy){state.thumbStart=Math.min(Math.max(1,state.pdf.numPages-7),state.thumbStart+8);void loadNavigation();}});
$('back').addEventListener('click',()=>{if(!state.busy&&state.history.length)void renderPage(state.history.pop());});
$('view-mode').addEventListener('change',()=>{state.mode=$('view-mode').value;void renderPage(state.pageNumber,state.scale,{fit:true});});
function applySplitPage(){state.other=Math.max(1,Math.min(state.pdf?.numPages??1,Number($('split-page').value)||1));if(state.mode==='split')void renderPage(state.pageNumber,state.scale,{fit:true});}
$('split-page').addEventListener('change',applySplitPage);$('split-page').addEventListener('keydown',event=>{if(event.key==='Enter'&&!state.busy){event.preventDefault();applySplitPage();}});
$('crop').addEventListener('change',()=>{state.crop=Number($('crop').value)||0;void renderPage(state.pageNumber,state.scale,{fit:state.fitWidth,preserve:true});});
document.addEventListener('keydown',event=>{
 if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)||event.target?.isContentEditable||!state.pdf||state.busy)return;
 const actions={j:()=>renderPage(state.pageNumber+1),k:()=>renderPage(state.pageNumber-1),ArrowRight:()=>renderPage(state.pageNumber+1),ArrowLeft:()=>renderPage(state.pageNumber-1),g:()=>renderPage(1),G:()=>renderPage(state.pdf.numPages),b:()=>{if(state.history.length)void renderPage(state.history.pop());},'/':()=>{setTab('search');setToolsOpen(true);}};
 if(actions[event.key]){event.preventDefault();void actions[event.key]();}
});
function svgElement(tag,attrs){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
function paintNotes(view){
 view.notes.replaceChildren();view.notes.setAttribute('viewBox','0 0 1000 1000');view.notes.setAttribute('preserveAspectRatio','none');if(!state.notes)return;
 for(const note of state.notes.list({page:view.number})){
  const color=ANNOTATION_COLORS[note.color];
  if(note.type==='ink'){view.notes.append(svgElement('polyline',{points:note.points.map(p=>`${p[0]*1000},${p[1]*1000}`).join(' '),fill:'none',stroke:color,'stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'}));}
  else if(note.rects.length){const d=note.rects.map(([x,y,w,h])=>note.type==='underline'?`M${x*1000} ${(y+h)*1000}h${w*1000}`:`M${x*1000} ${y*1000}h${w*1000}v${h*1000}h${-w*1000}Z`).join(' ');view.notes.append(svgElement('path',note.type==='underline'?{d,fill:'none',stroke:color,'stroke-width':2}:{d,fill:color,'fill-opacity':.3}));}
  if(note.type==='comment'){const r=note.rects[0]??[.94,.02,.04,.04],mark=svgElement('circle',{cx:(r[0]+.01)*1000,cy:(r[1]+.01)*1000,r:10,fill:color});mark.classList.add('note-marker');const title=svgElement('title',{});title.textContent=note.text;mark.append(title);mark.addEventListener('click',()=>{setTab('notes');setToolsOpen(true);});view.notes.append(mark);}
 }
}
function refreshNotes(){
 if(state.exportData?.text!==undefined){state.exportData=null;$('export-preview').value='註記已變更，請重新產生匯出預覽。';updateExportButton();}
 for(const v of state.views.values())paintNotes(v);$('note-list').replaceChildren();if(!state.notes)return;
 for(const note of state.notes.list({color:$('note-filter').value||undefined})){const li=document.createElement('li'),go=document.createElement('button'),del=document.createElement('button'),text=document.createElement('p');go.textContent=`第 ${note.page} 頁 · ${note.type} · ${note.color}`;go.addEventListener('click',()=>{setToolsOpen(false,false);void renderPage(note.page,state.scale,{history:true});});text.textContent=note.text||note.quote||'手寫註記';del.textContent='刪除';del.addEventListener('click',()=>{state.notes.remove(note.id);refreshNotes();});li.append(go,text,del);$('note-list').append(li);}
}
function addNote(type){
 if(!state.notes||state.busy)return;try{if(type!=='comment'&&!state.selectionRects.length){status('請先在 PDF 選取文字。',true);return;}state.notes.add({type,page:state.selectionPage||state.pageNumber,color:$('note-color').value,rects:state.selectionRects,text:type==='comment'?$('note-comment').value:'',quote:state.selection});$('note-comment').value='';refreshNotes();status('註記只保留在目前視窗，請記得匯出。');}catch(error){status(`未加入註記：${error.message}`,true);}
}
$('note-highlight').addEventListener('click',()=>addNote('highlight'));$('note-underline').addEventListener('click',()=>addNote('underline'));$('note-save').addEventListener('click',()=>addNote('comment'));$('note-filter').addEventListener('change',refreshNotes);
$('draw-mode').addEventListener('change',()=>{for(const v of state.views.values())v.surface.dataset.draw=$('draw-mode').value;setToolsOpen(false,false);});
function attachDrawing(view){
 let gesture=null,preview=null;
 const point=event=>{const b=view.surface.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-b.x)/b.width)),Math.max(0,Math.min(1,(event.clientY-b.y)/b.height)),Math.max(0,Math.min(1,Number.isFinite(event.pressure)?event.pressure:.5))];};
 view.surface.onpointerdown=event=>{const mode=$('draw-mode').value;if(gesture||mode==='select'||state.busy||!state.notes||event.button!==0)return;event.preventDefault();view.surface.setPointerCapture(event.pointerId);gesture={pointerId:event.pointerId,mode,start:point(event),points:[point(event)]};};
 view.surface.onpointermove=event=>{if(!gesture||gesture.pointerId!==event.pointerId)return;event.preventDefault();const p=point(event);if(gesture.points.length<2000)gesture.points.push(p);preview?.remove();if(gesture.mode==='ink'){const poly=svgElement('polyline',{points:gesture.points.map(q=>`${q[0]*1000},${q[1]*1000}`).join(' '),fill:'none',stroke:ANNOTATION_COLORS[$('note-color').value],'stroke-width':2});preview=poly;view.notes.append(poly);}else{const a=gesture.start;preview=svgElement('rect',{x:Math.min(a[0],p[0])*1000,y:Math.min(a[1],p[1])*1000,width:Math.abs(a[0]-p[0])*1000,height:Math.abs(a[1]-p[1])*1000,fill:'#77bbaa33',stroke:'#275f9a','stroke-width':2});view.notes.append(preview);}};
 view.surface.onpointercancel=event=>{if(gesture?.pointerId!==event.pointerId)return;gesture=null;preview?.remove();preview=null;};
 view.surface.onpointerup=event=>{
  if(!gesture||gesture.pointerId!==event.pointerId)return;const g=gesture;gesture=null;preview?.remove();preview=null;const p=point(event);try{
   if(g.mode==='ink'){if(g.points.length<2)g.points.push(p);state.notes.add({type:'ink',page:view.number,color:$('note-color').value,points:g.points});refreshNotes();}
   else{const x=Math.min(g.start[0],p[0]),y=Math.min(g.start[1],p[1]),w=Math.abs(g.start[0]-p[0]),h=Math.abs(g.start[1]-p[1]);if(w<.005||h<.005){paintNotes(view);return;}const sw=Math.ceil(w*view.canvas.width),sh=Math.ceil(h*view.canvas.height),scale=Math.min(1,Math.sqrt(2000000/(sw*sh))),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(sw*scale));canvas.height=Math.max(1,Math.floor(sh*scale));canvas.getContext('2d').drawImage(view.canvas,x*view.canvas.width,y*view.canvas.height,sw,sh,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');canvas.width=0;canvas.height=0;if(data.length>8*1024*1024)throw new Error('SCREENSHOT_SIZE');$('region-preview').src=data;$('region-preview').hidden=false;$('export-preview').value=`第 ${view.number} 頁區域 PNG，僅原始頁面影像（不含註記）。`;state.exportData={name:'pdf-region.png',mime:'image/png',blob:data.split(',')[1]};setTab('notes');setToolsOpen(true);updateExportButton();paintNotes(view);}
  }catch(error){status(`操作未完成：${error.message}`,true);paintNotes(view);}
 };
}
function exportNotes(format){if(!state.notes)return;try{const text=format==='json'?state.notes.exportJSON():state.notes.exportMarkdown();$('export-preview').value=text;$('region-preview').hidden=true;state.exportData={name:format==='json'?'pdf-notes.json':'pdf-notes.md',mime:format==='json'?'application/json':'text/markdown',text};updateExportButton();}catch(error){status(`無法匯出：${error.message}`,true);}}
function updateExportButton(){$('host-download').disabled=!state.exportData||!app?.getHostCapabilities()?.downloadFile;}
$('export-json').addEventListener('click',()=>exportNotes('json'));$('export-md').addEventListener('click',()=>exportNotes('md'));
$('note-import').addEventListener('change',async()=>{const file=$('note-import').files?.[0];$('note-import').value='';if(!file||!state.notes)return;if(file.size>5*1024*1024){status('註記 JSON 超過 5 MiB。',true);return;}const epoch=state.epoch;try{const text=await file.text();if(epoch!==state.epoch)return;const result=state.notes.importJSON(text);refreshNotes();status(`已匯入 ${result.added} 筆，略過 ${result.skipped} 筆相同註記。`);}catch(error){status(`未匯入：${error.message}；原註記未變更。`,true);}});
$('host-download').addEventListener('click',async()=>{if(!state.exportData||!app?.getHostCapabilities()?.downloadFile)return;const data=state.exportData;try{const resource={uri:`file:///${data.name}`,mimeType:data.mime,...(data.text!==undefined?{text:data.text}:{blob:data.blob})};const result=await app.downloadFile({contents:[{type:'resource',resource}]});status(result.isError?'宿主未完成下載；可保留預覽自行複製。':'宿主已接受下載要求；請查看下載檔案。');}catch{status('宿主下載不可用；請複製文字或另存預覽圖。',true);}});
function requestDiscard(action){if(!state.notes?.size&&!$('note-comment').value.trim()){action();return;}state.pendingAction=action;$('discard-dialog').hidden=false;$('discard-cancel').focus();}
$('discard-cancel').addEventListener('click',()=>{state.pendingAction=null;$('discard-dialog').hidden=true;});
$('discard-confirm').addEventListener('click',()=>{const action=state.pendingAction;state.pendingAction=null;$('discard-dialog').hidden=true;action?.();});
$('discard-export').addEventListener('click',()=>{$('discard-dialog').hidden=true;state.pendingAction=null;setTab('notes');setToolsOpen(true);exportNotes('json');});

window.addEventListener('pagehide',()=>closeDocument(''));
// Normal reading sends no PDF content. Explicit disclosed export alone sends the chosen resource to the host download API.
let app=null;
function updateHost(context){
  if(context?.theme==='light'||context?.theme==='dark')applyDocumentTheme(context.theme);
  for(const mode of ['inline','fullscreen'])$(mode).hidden=!context?.availableDisplayModes?.includes(mode)||context.displayMode===mode;
  updateExportButton();
  $('host-status').textContent=`MCP App · ${context?.displayMode??'inline'}`;
}
if(window.parent!==window && !document.documentElement.hasAttribute('data-local')){
  app=new App({name:'Jingdu PDF Reader',version:'0.2.0'},{availableDisplayModes:['inline','fullscreen']},{autoResize:false});
  app.ontoolresult=()=>{};app.onhostcontextchanged=context=>updateHost({...app.getHostContext(),...context});
  app.onteardown=async()=>{closeDocument('');return {};};
  app.connect(undefined,{timeout:5000}).then(()=>updateHost(app.getHostContext())).catch(()=>{$('host-status').textContent='宿主連線不可用 · 本機閱讀仍可使用';});
}
for(const mode of ['inline','fullscreen'])$(mode).addEventListener('click',async()=>{
  try{const result=await app.requestDisplayMode({mode});status(`宿主已選擇 ${result.mode} 顯示模式。`);updateHost({...app.getHostContext(),displayMode:result.mode});}
  catch{status('宿主未提供此顯示模式；可繼續在目前視窗閱讀。');}
});

// Non-sensitive readiness marker distinguishes UI loading from file selection.
document.documentElement.dataset.readerReady="true";
status("閱讀器已就緒。請選擇 PDF。");
