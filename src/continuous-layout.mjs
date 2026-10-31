import {LIMITS} from './limits.mjs';
import {displayScale} from './pdf-policy.mjs';

function dimensions(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!Number.isFinite(width*height)||width*height===0)throw new Error('INVALID_DIMENSIONS');
}
// Metadata only: no page acquisition, DOM, canvas, document bytes, or fetching.
// CSS geometry is independent of raster allocation, which is bounded at render time.
export class ContinuousLayout {
 #count; #gap; #dimensions; #sizes; #offsets; #dirty=true;
 #config={scale:1,crop:0,pixelRatio:1};
 constructor(count,{width=612,height=792,gap=16}={}){
  if(!Number.isInteger(count)||count<1||count>LIMITS.pages)throw new Error('INVALID_PAGE_COUNT');
  dimensions(width,height);
  if(!Number.isFinite(gap)||gap<0||gap>1000)throw new Error('INVALID_GAP');
  this.#count=count;this.#gap=gap;this.#dimensions=Array.from({length:count},()=>({width,height}));
  this.#sizes=new Array(count);this.#offsets=new Float64Array(count+1);
 }
 #index(page){if(!Number.isInteger(page)||page<1||page>this.#count)throw new Error('INVALID_PAGE');return page-1;}
 measure(page,width,height){
  const i=this.#index(page);dimensions(width,height);
  const old=this.#dimensions[i];if(old.width===width&&old.height===height)return this;
  this.#dimensions[i]={width,height};this.#dirty=true;return this;
 }
 configure(changes={}){
  const config={...this.#config,...changes};
  if(!Number.isFinite(config.scale)||config.scale<=0||!Number.isFinite(config.crop)||config.crop<0||config.crop>=.5||!Number.isFinite(config.pixelRatio)||config.pixelRatio<=0||config.pixelRatio>16)throw new Error('INVALID_LAYOUT_CONFIG');
  this.#config={scale:config.scale,crop:config.crop,pixelRatio:config.pixelRatio};this.#dirty=true;return this;
 }
 #ensure(){
  if(!this.#dirty)return;
  const {scale:desired,crop}=this.#config,factor=1-2*crop;
  this.#offsets[0]=0;
  for(let i=0;i<this.#count;i++){
   const {width,height}=this.#dimensions[i];
   const scale=displayScale(width,height,desired);
   const size={width:width*scale*factor,height:height*scale*factor,scale};
   this.#sizes[i]=size;this.#offsets[i+1]=this.#offsets[i]+size.height+(i<this.#count-1?this.#gap:0);
  }
  this.#dirty=false;
 }
 top(page){const i=this.#index(page);this.#ensure();return this.#offsets[i];}
 size(page){const i=this.#index(page);this.#ensure();return {...this.#sizes[i]};}
 get totalHeight(){this.#ensure();return this.#offsets[this.#count];}
 #scroll(value){if(!Number.isFinite(value))throw new Error('INVALID_SCROLL');return Math.max(0,Math.min(this.totalHeight,value));}
 pageAt(scrollTop){
  const y=this.#scroll(scrollTop);let low=0,high=this.#count-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(this.#offsets[mid]<=y+.75)low=mid;else high=mid-1;}
  return low+1;
 }
 // Fraction is within the page's slot INCLUDING its following gap (last page has none).
 // Capture before measurement/configuration and restore after; no implicit scrolling.
 anchor(scrollTop){
  const y=this.#scroll(scrollTop),page=this.pageAt(y),i=page-1;
  const span=this.#offsets[i+1]-this.#offsets[i];
  return {page,fraction:span>0?Math.max(0,(y-this.#offsets[i])/span):0};
 }
 restore(anchor){
  const i=this.#index(anchor?.page);
  if(!Number.isFinite(anchor?.fraction))throw new Error('INVALID_ANCHOR');
  this.#ensure();return this.#offsets[i]+Math.max(0,Math.min(1,anchor.fraction))*(this.#offsets[i+1]-this.#offsets[i]);
 }
}

// Visible pages first; optional one-page overscan only when it fits the hard window cap.
export function visibleWindow(layout,scrollTop,height,count,cap=12){
 const first=layout.pageAt(scrollTop),last=layout.pageAt(Math.min(layout.totalHeight,scrollTop+Math.max(0,height)));
 const end=Math.min(last,first+cap-1),pages=[];for(let n=first;n<=end;n++)pages.push(n);
 if(pages.length<cap&&first>1)pages.unshift(first-1);
 if(pages.length<cap&&end<count)pages.push(end+1);
 return {pages,truncated:last>end};
}
