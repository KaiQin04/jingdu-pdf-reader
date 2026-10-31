export function pageWindow(mode,page,count,other=1){
 const clamp=n=>Math.max(1,Math.min(count,Math.trunc(Number(n))||1));page=clamp(page);
 if(mode==='continuous')return [page-1,page,page+1].filter(n=>n>=1&&n<=count);
 if(mode==='double')return [page,page+1].filter(n=>n<=count);
 if(mode==='split')return [...new Set([page,clamp(other)])];
 return [page];
}
export function internalDestination(item){
 if(!item||typeof item!=='object'||item.url||item.unsafeUrl||item.action||item.newWindow)return null;
 const dest=item.dest;return typeof dest==='string'&&dest.length<=1000||Array.isArray(dest)&&dest.length<=10?dest:null;
}
export function flattenOutline(items){
 const result=[],seen=new WeakSet();
 const walk=(nodes,depth)=>{if(!Array.isArray(nodes)||depth>12)return;for(const item of nodes){if(result.length>=1000)return;if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);const dest=internalDestination(item);if(dest)result.push({title:String(item.title??'章節').slice(0,240),dest,depth});walk(item.items,depth+1);}};
 walk(items,0);return result;
}
