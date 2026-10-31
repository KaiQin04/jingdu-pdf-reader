import { LIMITS } from './limits.mjs';
export function pdfOptions(data,worker,BinaryDataFactory){
  return {data,worker,verbosity:0,enableXfa:false,useWasm:false,useWorkerFetch:false,BinaryDataFactory,stopAtErrors:true,disableAutoFetch:true,disableStream:true,disableRange:true,maxImageSize:LIMITS.imagePixels,canvasMaxAreaInBytes:LIMITS.canvasPixels*4,isImageDecoderSupported:false,enableHWA:false,enableWebGPU:false};
}
export function checkPageCount(count){if(!Number.isInteger(count)||count<1||count>LIMITS.pages)throw new Error('PAGES');}
export function boundedScale(width,height,desired,ratio){
  if(!Number.isFinite(width*height)||width<=0||height<=0)throw new Error('INVALID');
  return Math.min(Math.max(.25,Math.min(3,desired)),Math.sqrt(LIMITS.canvasPixels/(width*height))/ratio,8192/width/ratio,8192/height/ratio);
}

// Logical page size must not inherit the Retina canvas memory limit.
// A 6,000px page-height ceiling keeps 5,000-page rails below browser scroll limits.
export function displayScale(width,height,desired){
  if(!Number.isFinite(width*height)||width<=0||height<=0||!Number.isFinite(desired))throw new Error('INVALID');
  return Math.min(Math.max(.25,Math.min(6,desired)),8192/width,6000/height);
}
export function rasterRatio(width,height,ratio,count){
  if(!Number.isFinite(width*height)||width<=0||height<=0||!Number.isFinite(ratio)||ratio<=0||!Number.isInteger(count)||count<1||count>12)throw new Error('INVALID');
  return Math.min(ratio,Math.sqrt((LIMITS.canvasPixels-500000)/count/(width*height)),8192/width,8192/height);
}

// File/Blob only: no URL, fetch, or whole-file arrayBuffer path. PDF.js still
// reserves a file-length buffer inside its worker; this is not a hard RAM cap.
export function localRangeTransport(Base,file,initialData,onError){
  return new class extends Base {
    constructor(){super(file.size,initialData,true);this.stopped=false;this.queue=[];this.active=0;}
    requestDataRange(begin,end){
      if(this.stopped)return;
      if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||begin<0||end<=begin||end>file.size||end-begin>LIMITS.rangeRequestBytes||this.queue.length>=8192){this.abort();onError(new Error('RANGE'));return;}
      this.queue.push([begin,end]);this.pump();
    }
    pump(){
      while(!this.stopped&&this.active<2&&this.queue.length){
        const [begin,end]=this.queue.shift();this.active++;
        file.slice(begin,end).arrayBuffer().then(buffer=>{
          if(this.stopped)return;
          if(buffer.byteLength!==end-begin)throw new Error('RANGE');
          this.onDataRange(begin,new Uint8Array(buffer));
        }).catch(error=>{if(!this.stopped){this.abort();onError(error);}}).finally(()=>{this.active--;this.pump();});
      }
    }
    abort(){this.stopped=true;this.queue.length=0;}
  }();
}
export class PageTextCache {
  constructor(maxPages=LIMITS.cachedPages,maxChars=LIMITS.totalChars){this.entries=new Map();this.chars=0;this.maxPages=maxPages;this.maxChars=maxChars;}
  get(key){return this.entries.get(key);}
  set(key,value){
    if(this.entries.has(key)){this.chars-=this.entries.get(key).plain.length;this.entries.delete(key);}
    while(this.entries.size&&(this.entries.size>=this.maxPages||this.chars+value.plain.length>this.maxChars)){
      const first=this.entries.keys().next().value;this.chars-=this.entries.get(first).plain.length;this.entries.delete(first);
    }
    if(value.plain.length<=this.maxChars){this.entries.set(key,value);this.chars+=value.plain.length;}
  }
  clear(){this.entries.clear();this.chars=0;}
}
