import { getDocument, PDFWorker, PDFDataRangeTransport, TextLayer, AnnotationMode } from 'pdfjs-dist/build/pdf.mjs';
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { LIMITS, checkFile, normalizedText } from './limits.mjs';
import { pdfOptions, checkPageCount, displayScale, rasterRatio as boundedRasterRatio, localRangeTransport, PageTextCache } from './pdf-policy.mjs';
import { pageWindow, internalDestination, flattenOutline } from './navigation.mjs';
import { ContinuousLayout, visibleWindow } from './continuous-layout.mjs';
import { SEARCH_WORKER_SOURCE } from './search-engine.mjs';
import { AnnotationStore, ANNOTATION_COLORS, normalizePageRect } from './annotations.mjs';
import { createI18n } from './i18n.mjs';
import { preparePdfText, pdfItemsText, canSharePdfText, sendPdfText, AutomaticPdfTextShare } from './chat-context.mjs';
const i18n = createI18n();
const automaticShare = new AutomaticPdfTextShare();
const $ = id => document.getElementById(id);
const state = { epoch:0, pdf:null, task:null, worker:null, rawWorker:null, workerUrl:null, render:null, textLayer:null, page:null, pageNumber:1, scale:1, busy:false, name:'', cache:new PageTextCache(), range:null, searching:false, searchCancel:false, searchNext:1, searchQuery:'', searchCount:0, selection:'', selectionPage:0, selectionRects:[], selectionTruncated:false, views:new Map(), mode:'continuous', crop:0, other:1, history:[], layout:null, fitWidth:true, scrollVersion:0, programScroll:null, pendingPage:null, notes:null, tab:'search', thumbStart:1, outlineLoaded:false, searchWorker:null, searchWorkerUrl:null, searchRequest:0, exportData:null, pendingAction:null, chatPreview:null, chatAbort:null, chatSequence:0, chatSending:false, chatSent:false, chatAutoEnabled:true, chatAutoEligible:false };
const ERRORS = { EMPTY:'errorEmpty', SIZE:'errorSize', RANGE:'errorRange', HEADER:'errorHeader', PAGES:'errorPages', PASSWORD:'errorPassword', TEXT:'errorText', TIMEOUT:'errorTimeout', WORKER:'errorWorker', INVALID:'errorInvalid' };
function status(message, error=false) { if(typeof message==='string'){i18n.clearText($('status'));$('status').textContent=message;}else i18n.text($('status'),message); $('status').dataset.error=String(error); }
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
  updateChatControls();
}
function clearQuote(){ state.selection=''; state.selectionPage=0;state.selectionRects=[];state.selectionTruncated=false; resetChatPreview(); $('citation').value=''; $('copy').disabled=true; window.getSelection()?.removeAllRanges(); }
function closeDocument(message=i18n.message('documentClosed')) {
  automaticShare.cancel();
  state.chatAutoEligible=false;
  ++state.epoch;state.searchCancel=true;state.range?.abort();stopSearchWorker();clearViews();clearThumbnails();state.notes=null;state.pendingAction=null;state.thumbStart=1;state.history=[];state.outlineLoaded=false;state.pendingPage=null;state.layout=null;state.programScroll=null;state.exportData=null;$('pages').style.height='';$('pages').style.width='';$('note-list').replaceChildren();i18n.text($('outline'),"ui.nav.outlineEmpty");i18n.clearValue($('export-preview'));$('export-preview').value='';$('region-preview').hidden=true;$('region-preview').removeAttribute('src');$('note-comment').value='';$('host-download').disabled=true;$('discard-dialog').hidden=true;
  setToolsOpen(false,false);
  state.render?.cancel(); state.textLayer?.cancel();
  // Terminate first: cleanup must never wait on an unresponsive PDF worker.
  state.rawWorker?.terminate(); state.worker?.destroy();
  state.task?.destroy().catch(()=>{});
  if(state.workerUrl) URL.revokeObjectURL(state.workerUrl);
  Object.assign(state,{pdf:null,task:null,worker:null,rawWorker:null,workerUrl:null,render:null,textLayer:null,page:null,pageNumber:1,scale:1,busy:false,name:'',range:null,searching:false,searchCancel:false,searchNext:1,searchQuery:'',searchCount:0});
  state.cache.clear(); clearQuote();
  $('file').value=''; i18n.text($('filename'),"ui.toolbar.noDocument"); $('query').value=''; $('results').replaceChildren(); i18n.text($('search-summary'),"ui.search.textLayerHint");
  $('text-layer').replaceChildren(); $('canvas').width=0; $('canvas').height=0; $('page').hidden=true; $('empty').hidden=false;
  controls(); status(message);
}
function fail(error,epoch){
  if(epoch!==state.epoch)return;
  const code=error?.name==='PasswordException'?'PASSWORD':error?.message;
  const savedNotes=state.notes,draft=$('note-comment').value;closeDocument();state.notes=savedNotes;$('note-comment').value=draft;refreshNotes();controls();if(savedNotes?.size||draft){setTab('notes');setToolsOpen(true);status(i18n.message('errorWithNotes',{reason:i18n.message(ERRORS[code] ?? ERRORS.INVALID)}),true);}else status(i18n.message(ERRORS[code] ?? ERRORS.INVALID),true);
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
      for(const a of annotations.slice(0,1000)){const dest=internalDestination(a);if(!dest||!Array.isArray(a.rect)||a.rect.length!==4)continue;const rect=[...vp.convertToViewportPoint(a.rect[0],a.rect[1]),...vp.convertToViewportPoint(a.rect[2],a.rect[3])];if(!rect.every(Number.isFinite))continue;const button=document.createElement('button');i18n.attribute(button,'aria-label','internalLink');Object.assign(button.style,{left:`${Math.min(rect[0],rect[2])}px`,top:`${Math.min(rect[1],rect[3])}px`,width:`${Math.abs(rect[2]-rect[0])}px`,height:`${Math.abs(rect[3]-rect[1])}px`});button.addEventListener('click',()=>void followDestination(dest));v.links.append(button);}
      paintNotes(v);
    }
    if(state.mode!=='continuous')$('viewport').scrollTop=0;
    status(i18n.message('pageStatus',{page:number,total:doc.numPages,visible:state.views.size,warning:windowTruncated?i18n.message('pageWindowWarning'):''}),windowTruncated);
  }catch(error){fail(error,epoch);}
  finally{if(epoch===state.epoch){state.busy=false;controls();const pending=state.pendingPage;state.pendingPage=null;if(pending&&(pending.number!==state.pageNumber||!pending.options.scroll||state.views.size===0))void renderPage(pending.number,pending.scale,pending.options);else if(state.mode==='continuous'&&state.layout){const visible=state.layout.pageAt($('viewport').scrollTop);if(visible!==state.pageNumber)void renderPage(visible,state.scale,{scroll:true});}}}
}
async function followDestination(dest){
 if(!state.pdf||state.busy)return;const epoch=state.epoch;try{if(typeof dest==='string')dest=await deadline(state.pdf.getDestination(dest),epoch);if(!Array.isArray(dest)||!dest.length)return;let n=dest[0];if(typeof n==='object'&&n&&Number.isInteger(n.num)&&Number.isInteger(n.gen))n=await deadline(state.pdf.getPageIndex(n),epoch);if(epoch!==state.epoch||!Number.isInteger(n)||n<0||n>=state.pdf.numPages)return;setToolsOpen(false,false);await renderPage(n+1,state.scale,{history:true});}catch{status(i18n.message('invalidDestination'),true);}
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
  closeDocument(i18n.message('openingPdf'));
  state.chatAutoEligible=state.chatAutoEnabled;
  const epoch=state.epoch; state.busy=true;controls();
  try{
    checkFile(file);
    const data=new Uint8Array(await deadline(file.slice(0,LIMITS.rangeChunkBytes).arrayBuffer(),epoch));
    if(epoch!==state.epoch)return;
    if(!/^%PDF-\d\.\d/.test(new TextDecoder('ascii').decode(data.subarray(0,8))))throw new Error('HEADER');
    state.name=file.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'document.pdf';
    i18n.clearText($('filename'));$('filename').textContent=state.name;
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
  finally{if(epoch===state.epoch){state.busy=false;controls();maybeAutoShare();}}
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
  if(!query){i18n.text($('search-summary'),'searchEmpty');return;}
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
        i18n.text(button,'searchResult',{page:i,context:match.context});
        button.addEventListener('click',()=>{if(!state.busy){setToolsOpen(false,false);void renderPage(i,state.scale,{history:true});$('viewport').focus();}});li.append(button);$('results').append(li);state.searchCount++;
      }
      if(!state.views.has(i))page.cleanup();
      i18n.text($('search-summary'),'searchProgress',{matches:state.searchCount,page:i,total:doc.numPages});
      // Return control to the browser between pages so cancel/close remains usable.
      await new Promise(resolve=>setTimeout(resolve,0));
      if(processed%20===0)await deadline(doc.cleanup(true),epoch);
      if(state.searchCount>=LIMITS.matches||processed>=LIMITS.searchBatchPages||performance.now()-start>=LIMITS.searchMs)break;
    }
    if(epoch!==state.epoch)return;
    await deadline(doc.cleanup(true),epoch);
    const complete=state.searchNext>doc.numPages,limit=state.searchCount>=LIMITS.matches;
    i18n.text($('search-summary'),'searchSummary',{matches:state.searchCount,page:state.searchNext-1,total:doc.numPages,result:i18n.message(limit?'searchLimit':complete?'searchComplete':state.searchCancel?'searchPaused':'searchBatchComplete')});
    status(i18n.message(complete?'searchDoneStatus':'searchPausedStatus'));
    if(limit)state.searchNext=doc.numPages+1;
  }catch(error){if(epoch===state.epoch){i18n.text($('search-summary'),error.message==='SEARCH_TIMEOUT'?'searchTimeout':'searchIncomplete',{error:error.message});status(i18n.message('searchStopped'),true);}}
  finally{if(epoch===state.epoch){stopSearchWorker();state.busy=false;state.searching=false;controls();}}
}
$('search-cancel').addEventListener('click',()=>{state.searchCancel=true;i18n.text($('search-summary'),'searchStopping');});
$('search-next').addEventListener('click',event=>void searchDocument(event,true));
$('search').addEventListener('click',searchDocument);
$('query').addEventListener('keydown',event=>{if(event.key==='Enter')void searchDocument(event);});
function captureSelection(){
 const sel=window.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount)return;
 for(const v of state.views.values())if(v.text.contains(sel.anchorNode)&&v.text.contains(sel.focusNode)){const box=v.surface.getBoundingClientRect();const selected=sel.toString(),text=selected.slice(0,LIMITS.quoteChars),truncated=selected.length>LIMITS.quoteChars;const changed=state.selection!==text||state.selectionPage!==v.number||state.selectionTruncated!==truncated;state.selection=text;state.selectionTruncated=truncated;state.selectionPage=v.number;if(changed)resetChatPreview();state.selectionRects=Array.from(sel.getRangeAt(0).getClientRects()).slice(0,200).flatMap(r=>{try{return[normalizePageRect([r.x-box.x,r.y-box.y,r.width,r.height],box.width,box.height)];}catch{return[];}});break;}
}
document.addEventListener('selectionchange',captureSelection);
$('cite').addEventListener('click',()=>{
  const source=i18n.t('citationSource',{filename:state.name,page:state.selectionPage||state.pageNumber,total:state.pdf.numPages});
  const quote=state.selection?`\n${i18n.t('citationQuoteHeading')}\n${state.selection}`:'';
  $('citation').value=`【${source}】${quote}`;$('copy').disabled=false;
  status(i18n.message('citationCreated'));
});
$('copy').addEventListener('click',()=>{$('citation').focus();$('citation').select();status(i18n.message('citationSelected'));});
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
  if(!state.outlineLoaded){const outline=flattenOutline(await deadline(doc.getOutline(),epoch));if(epoch!==state.epoch)return;i18n.clearText($('outline'));$('outline').replaceChildren();for(const item of outline){const b=document.createElement('button');b.textContent=item.title;b.style.paddingLeft=`${8+item.depth*10}px`;b.addEventListener('click',()=>void followDestination(item.dest));$('outline').append(b);}if(!outline.length)i18n.text($('outline'),'outlineNone');state.outlineLoaded=true;}
  for(let i=state.thumbStart;i<=Math.min(doc.numPages,state.thumbStart+7);i++){
   if(epoch!==state.epoch||generation!==thumbEpoch)return;const page=await deadline(doc.getPage(i),epoch);if(epoch!==state.epoch||generation!==thumbEpoch)return;const base=page.getViewport({scale:1}),scale=Math.min(140/base.width,180/base.height),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
   const b=document.createElement('button'),label=document.createElement('span');i18n.text(label,'pageLabel',{page:i});b.append(canvas,label);b.addEventListener('click',()=>{if(!state.busy){setToolsOpen(false,false);void renderPage(i,state.scale,{history:true});}});$('thumbnails').append(b);
   const task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,annotationMode:AnnotationMode.DISABLE});thumbJobs.push(task);await deadline(task.promise,epoch);if(!state.views.has(i))page.cleanup();
  }
 }catch(error){if(epoch===state.epoch&&generation===thumbEpoch)status(i18n.message('navigationFailed'),true);}
 finally{if(epoch===state.epoch){state.busy=false;controls();}}
}
function setTab(tab){state.tab=tab;for(const name of ['nav','search','notes','view','chat']){$(`panel-${name}`).hidden=name!==tab;$(`tab-${name}`).setAttribute('aria-selected',String(name===tab));}if(tab==='nav')void loadNavigation();else clearThumbnails();if(tab==='notes')refreshNotes();}
for(const tab of ['nav','search','notes','view','chat'])$(`tab-${tab}`).addEventListener('click',()=>setTab(tab));
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
 if(state.exportData?.text!==undefined){state.exportData=null;i18n.value($('export-preview'),'exportChanged');updateExportButton();}
 for(const v of state.views.values())paintNotes(v);$('note-list').replaceChildren();if(!state.notes)return;
 for(const note of state.notes.list({color:$('note-filter').value||undefined})){const li=document.createElement('li'),go=document.createElement('button'),del=document.createElement('button'),text=document.createElement('p');i18n.text(go,'noteLabel',{page:note.page,type:i18n.message('type.'+note.type),color:i18n.message('color.'+note.color)});go.addEventListener('click',()=>{setToolsOpen(false,false);void renderPage(note.page,state.scale,{history:true});});if(note.text||note.quote)text.textContent=note.text||note.quote;else i18n.text(text,'inkNote');i18n.text(del,'delete');del.addEventListener('click',()=>{state.notes.remove(note.id);refreshNotes();});li.append(go,text,del);$('note-list').append(li);}
}
function addNote(type){
 if(!state.notes||state.busy)return;try{if(type!=='comment'&&!state.selectionRects.length){status(i18n.message('selectTextFirst'),true);return;}state.notes.add({type,page:state.selectionPage||state.pageNumber,color:$('note-color').value,rects:state.selectionRects,text:type==='comment'?$('note-comment').value:'',quote:state.selection});$('note-comment').value='';refreshNotes();status(i18n.message('noteAdded'));}catch(error){status(i18n.message('noteFailed',{error:error.message}),true);}
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
   else{const x=Math.min(g.start[0],p[0]),y=Math.min(g.start[1],p[1]),w=Math.abs(g.start[0]-p[0]),h=Math.abs(g.start[1]-p[1]);if(w<.005||h<.005){paintNotes(view);return;}const sw=Math.ceil(w*view.canvas.width),sh=Math.ceil(h*view.canvas.height),scale=Math.min(1,Math.sqrt(2000000/(sw*sh))),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(sw*scale));canvas.height=Math.max(1,Math.floor(sh*scale));canvas.getContext('2d').drawImage(view.canvas,x*view.canvas.width,y*view.canvas.height,sw,sh,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');canvas.width=0;canvas.height=0;if(data.length>8*1024*1024)throw new Error('SCREENSHOT_SIZE');$('region-preview').src=data;$('region-preview').hidden=false;i18n.value($('export-preview'),'regionPreview',{page:view.number});state.exportData={name:'pdf-region.png',mime:'image/png',blob:data.split(',')[1]};setTab('notes');setToolsOpen(true);updateExportButton();paintNotes(view);}
  }catch(error){status(i18n.message('actionFailed',{error:error.message}),true);paintNotes(view);}
 };
}
function exportNotes(format){if(!state.notes)return;try{const text=format==='json'?state.notes.exportJSON():state.notes.exportMarkdown(i18n.language);i18n.clearValue($('export-preview'));$('export-preview').value=text;$('region-preview').hidden=true;state.exportData={name:format==='json'?'pdf-notes.json':'pdf-notes.md',mime:format==='json'?'application/json':'text/markdown',text};updateExportButton();}catch(error){status(i18n.message('exportFailed',{error:error.message}),true);}}
function resetChatPreview(){
  state.chatSequence=(state.chatSequence||0)+1;
  state.chatAbort?.abort();state.chatAbort=null;state.chatPreview=null;state.chatSending=false;state.chatSent=false;
  $('chat-preview').value='';i18n.text($('chat-status'),'chatIdle');updateChatControls();
}
function updateChatControls(){
  const extracting=!!state.chatAbort,busy=extracting||state.chatSending||automaticShare.running,ready=!!state.pdf&&!state.busy,supported=canSharePdfText(app),enabled=state.chatAutoEnabled!==false;
  $('chat-toggle').disabled=!state.pdf;
  $('chat-scope').disabled=!ready||busy;$('chat-prepare').disabled=!ready||busy;
  $('chat-cancel').hidden=!extracting;
  $('chat-send').disabled=!state.chatPreview||busy||state.chatSent||!supported;
  $('chat-copy').disabled=!state.chatPreview||busy;
  $('chat-host-hint').hidden=supported;
  $('chat-auto').checked=enabled;
  i18n.text($('chat-auto-disclosure'),enabled?'autoDisclosure':'autoOff');
  if(!automaticShare.running&&!automaticShare.hasAttempted(state.pdf))i18n.text($('chat-auto-status'),!enabled?'autoOffStatus':!supported?'autoUnavailable':state.pdf&&!state.chatAutoEligible?'autoNextFile':'autoWaiting');
}
async function prepareChatPreview(){
  if(!state.pdf||state.busy||state.chatAbort||state.chatSending||automaticShare.running)return;
  resetChatPreview();
  const sequence=state.chatSequence,doc=state.pdf,controller=new AbortController();state.chatAbort=controller;updateChatControls();
  try{
    const preview=await preparePdfText({scope:$('chat-scope').value,filename:state.name,pageCount:doc.numPages,currentPage:state.pageNumber,selection:state.selection,selectionPage:state.selectionPage,selectionTruncated:state.selectionTruncated,signal:controller.signal,
      readPage:async number=>{const page=await doc.getPage(number);const text=await page.getTextContent();return pdfItemsText(text.items);},
      onProgress:values=>{if(sequence===state.chatSequence)i18n.text($('chat-status'),'chatPreparing',values);}});
    if(sequence!==state.chatSequence||doc!==state.pdf)return;
    state.chatPreview=preview;$('chat-preview').value=preview.text;
    i18n.text($('chat-status'),'chatReady',{pages:preview.pages.length,chars:preview.text.length,empty:preview.emptyPages.length});
  }catch(error){
    if(sequence!==state.chatSequence)return;
    const keys={NO_SELECTION:'chatNoSelection',SELECTION_LONG:'chatSelectionLong',NO_TEXT:'chatNoText',TOO_LARGE:'chatTooLarge',TIMEOUT:'chatTimeout',CANCELLED:'chatCancelled'};
    i18n.text($('chat-status'),keys[error.code]||'chatPrepareFailed');
  }finally{if(sequence===state.chatSequence){state.chatAbort=null;updateChatControls();}}
}
async function sendChatPreview(){
  if(!state.chatPreview||state.chatSending||state.chatSent||automaticShare.running||!canSharePdfText(app))return;
  const sequence=state.chatSequence,preview=state.chatPreview;state.chatSending=true;updateChatControls();i18n.text($('chat-status'),'chatSending');
  try{await sendPdfText(app,preview);if(sequence===state.chatSequence){state.chatSent=true;i18n.text($('chat-status'),'chatAccepted');}}
  catch(error){if(sequence===state.chatSequence)i18n.text($('chat-status'),error.code==='HOST_REJECTED'?'chatRejected':'chatUnconfirmed');}
  finally{if(sequence===state.chatSequence){state.chatSending=false;updateChatControls();}}
}
function maybeAutoShare(){
  const doc=state.pdf,epoch=state.epoch;
  if(!doc||state.busy||state.chatAbort||state.chatSending||!state.chatAutoEnabled||!state.chatAutoEligible||!canSharePdfText(app))return;
  void automaticShare.start({document:doc,enabled:state.chatAutoEnabled,app,filename:state.name,pageCount:doc.numPages,
    readPage:async number=>{const page=await doc.getPage(number);return pdfItemsText((await page.getTextContent()).items);},
    onState:event=>{
      if(doc!==state.pdf||epoch!==state.epoch)return;
      if(event.phase==='preparing')i18n.text($('chat-auto-status'),event.page?'autoPreparing':'autoStarting',event);
      else if(event.phase==='prepared'){
        state.chatPreview=event.preview;state.chatSent=false;$('chat-scope').value='document';$('chat-preview').value=event.preview.text;
        i18n.text($('chat-status'),'chatReady',{pages:event.preview.pages.length,chars:event.preview.text.length,empty:event.preview.emptyPages.length});
      }else if(event.phase==='sending')i18n.text($('chat-auto-status'),'autoSending');
      else if(event.phase==='accepted'){
        if(state.chatPreview===event.preview){state.chatSent=true;i18n.text($('chat-status'),'chatAccepted');}
        i18n.text($('chat-auto-status'),'autoAccepted');
      }else if(event.phase==='failed'){
        const keys={NO_TEXT:'chatNoText',TOO_LARGE:'chatTooLarge',TIMEOUT:'chatTimeout',UNAVAILABLE:'autoUnavailable'};
        i18n.text($('chat-auto-status'),keys[event.code]||'autoFailed');
      }else if(event.phase==='rejected')i18n.text($('chat-auto-status'),'autoRejected');
      else if(event.phase==='unconfirmed')i18n.text($('chat-auto-status'),'autoUnconfirmed');
      updateChatControls();
    }});
}
$('chat-auto').addEventListener('change',()=>{
  state.chatAutoEnabled=$('chat-auto').checked;
  if(!state.chatAutoEnabled){state.chatAutoEligible=false;const mayHaveSent=automaticShare.cancel();if(mayHaveSent&&state.chatPreview)state.chatSent=true;i18n.text($('chat-auto-status'),mayHaveSent?'autoUnconfirmed':'autoStopped');}
  else if(automaticShare.hasAttempted(state.pdf))i18n.text($('chat-auto-status'),'autoTried');
  updateChatControls();if(state.chatAutoEnabled)maybeAutoShare();
});
$('chat-toggle').addEventListener('click',()=>{setTab('chat');setToolsOpen(true);});
$('chat-scope').addEventListener('change',resetChatPreview);
$('chat-prepare').addEventListener('click',()=>void prepareChatPreview());
$('chat-send').addEventListener('click',()=>void sendChatPreview());
$('chat-cancel').addEventListener('click',()=>{resetChatPreview();i18n.text($('chat-status'),'chatCancelled');});
$('chat-copy').addEventListener('click',()=>{if(!state.chatPreview)return;$('chat-preview').focus();$('chat-preview').select();i18n.text($('chat-status'),'chatCopyHint');});
function updateExportButton(){$('host-download').disabled=!state.exportData||!app?.getHostCapabilities()?.downloadFile;}
$('export-json').addEventListener('click',()=>exportNotes('json'));$('export-md').addEventListener('click',()=>exportNotes('md'));
$('note-import').addEventListener('change',async()=>{const file=$('note-import').files?.[0];$('note-import').value='';if(!file||!state.notes)return;if(file.size>5*1024*1024){status(i18n.message('importTooLarge'),true);return;}const epoch=state.epoch;try{const text=await file.text();if(epoch!==state.epoch)return;const result=state.notes.importJSON(text);refreshNotes();status(i18n.message('importDone',{added:result.added,skipped:result.skipped}));}catch(error){status(i18n.message('importFailed',{error:error.message}),true);}});
$('host-download').addEventListener('click',async()=>{if(!state.exportData||!app?.getHostCapabilities()?.downloadFile)return;const data=state.exportData;try{const resource={uri:`file:///${data.name}`,mimeType:data.mime,...(data.text!==undefined?{text:data.text}:{blob:data.blob})};const result=await app.downloadFile({contents:[{type:'resource',resource}]});status(i18n.message(result.isError?'hostDownloadFailed':'hostDownloadAccepted'));}catch{status(i18n.message('hostDownloadUnavailable'),true);}});
function requestDiscard(action){if(!state.notes?.size&&!$('note-comment').value.trim()){action();return;}state.pendingAction=action;$('discard-dialog').hidden=false;$('discard-cancel').focus();}
$('discard-cancel').addEventListener('click',()=>{state.pendingAction=null;$('discard-dialog').hidden=true;});
$('discard-confirm').addEventListener('click',()=>{const action=state.pendingAction;state.pendingAction=null;$('discard-dialog').hidden=true;action?.();});
$('discard-export').addEventListener('click',()=>{$('discard-dialog').hidden=true;state.pendingAction=null;setTab('notes');setToolsOpen(true);exportNotes('json');});

window.addEventListener('pagehide',()=>closeDocument(''));
// Auto-sharing follows the visible session setting; raw PDFs and local notes stay out.
let app=null;
function updateHost(context){
  if(context?.theme==='light'||context?.theme==='dark')applyDocumentTheme(context.theme);
  for(const mode of ['inline','fullscreen'])$(mode).hidden=!context?.availableDisplayModes?.includes(mode)||context.displayMode===mode;
  updateExportButton();
  updateChatControls();
  maybeAutoShare();
  i18n.clearText($('host-status'));$('host-status').textContent=`MCP App · ${context?.displayMode??'inline'}`;
}
if(window.parent!==window && !document.documentElement.hasAttribute('data-local')){
  app=new App({name:'Jingdu PDF Reader',version:'0.2.0'},{availableDisplayModes:['inline','fullscreen']},{autoResize:false});
  app.ontoolresult=()=>{};app.onhostcontextchanged=context=>updateHost({...app.getHostContext(),...context});
  app.onteardown=async()=>{closeDocument('');return {};};
  app.connect(undefined,{timeout:5000}).then(()=>updateHost(app.getHostContext())).catch(()=>{i18n.text($('host-status'),'hostUnavailable');});
}
for(const mode of ['inline','fullscreen'])$(mode).addEventListener('click',async()=>{
  try{const result=await app.requestDisplayMode({mode});status(i18n.message('displayModeSelected',{mode:result.mode}));updateHost({...app.getHostContext(),displayMode:result.mode});}
  catch{status(i18n.message('displayModeUnavailable'));}
});

i18n.apply(document);
updateChatControls();
$('language').addEventListener('change',()=>{$('language').value=i18n.setLanguage($('language').value,document);});

// Non-sensitive readiness marker distinguishes UI loading from file selection.
document.documentElement.dataset.readerReady="true";
status(i18n.message('readerReady'));
