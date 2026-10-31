/** Bounded, DOM-free search. Offsets are UTF-16 indices into the ORIGINAL text.
 * Literal/token search folds each grapheme with NFKC; regex uses original text
 * and native Unicode RegExp semantics. Regex is never enabled by searchText().
 * All output is untrusted plain text: consumers must use textContent, not HTML.
 */
function boundedSearch(request,workerContext=false){
  const id=(typeof request?.id==='string'&&request.id.length<=64)||Number.isSafeInteger(request?.id)?request.id:null;
  const error=(code,message)=>({id,ok:false,error:{code,message}});
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.text!=='string'||typeof request.query!=='string'||(request.caseSensitive!==undefined&&typeof request.caseSensitive!=='boolean'))return error('INVALID_REQUEST','Invalid search request.');
  const {text,query}=request,caseSensitive=request.caseSensitive===true,mode=request.mode??'literal';
  if(!['literal','tokens','regex'].includes(mode))return error('INVALID_REQUEST','Unsupported search mode.');
  if(text.length>200000)return error('TEXT_LIMIT','A page may contain at most 200000 text characters.');
  if(query.length>200)return error('QUERY_LIMIT','A query may contain at most 200 characters.');
  if(!query.trim())return error('EMPTY_QUERY','Enter a nonempty query.');
  if(mode==='regex'&&!workerContext)return error('WORKER_REQUIRED','Regular expressions require an isolated worker with an external deadline.');
  const MAX=20;
  const context=(start,end)=>{
    let left=Math.max(0,start-48);
    // Do not cut a surrogate pair at context boundaries.
    if(left>0&&text.charCodeAt(left)>=0xdc00&&text.charCodeAt(left)<=0xdfff)left--;
    let right=Math.min(text.length,end+72,left+239);
    if(right<text.length&&text.charCodeAt(right)>=0xdc00&&text.charCodeAt(right)<=0xdfff)right++;
    let previewEnd=Math.min(end,start+160);
    if(previewEnd<end&&text.charCodeAt(previewEnd)>=0xdc00&&text.charCodeAt(previewEnd)<=0xdfff)previewEnd--;
    return {start,end,text:text.slice(start,previewEnd),textTruncated:previewEnd<end,context:text.slice(left,right),contextStart:left,contextEnd:right};
  };
  if(mode==='regex'){
    let expression;try{expression=new RegExp(query,caseSensitive?'gu':'giu');}catch{return error('INVALID_REGEX','Invalid regular expression.');}
    const matches=[];let match;
    while((match=expression.exec(text))!==null){
      if(matches.length===MAX)return {id,ok:true,matches,truncated:true,segmentation:'not-used',normalization:'native-regex'};
      matches.push(context(match.index,match.index+match[0].length));
      if(match[0].length===0){const point=text.codePointAt(expression.lastIndex);expression.lastIndex+=point>0xffff?2:1;}
    }
    return {id,ok:true,matches,truncated:false,segmentation:'not-used',normalization:'native-regex'};
  }
  const fold=value=>{const normalized=value.normalize('NFKC');return caseSensitive?normalized:normalized.toLowerCase();};
  const starts=[],ends=[];let normalized='';
  const segments=typeof Intl?.Segmenter==='function'?new Intl.Segmenter('und',{granularity:'grapheme'}).segment(text):null;
  const add=(segment,index)=>{
    const value=fold(segment);
    if(normalized.length+value.length>1000000)return false;
    normalized+=value;
    for(let i=0;i<value.length;i++){starts.push(index);ends.push(index+segment.length);}
    return true;
  };
  if(segments){for(const {segment,index}of segments)if(!add(segment,index))return error('NORMALIZATION_LIMIT','Normalized page text exceeds the processing limit.');}
  else {let index=0;for(const point of text){if(!add(point,index))return error('NORMALIZATION_LIMIT','Normalized page text exceeds the processing limit.');index+=point.length;}}
  let tokens=[fold(query)],segmentation='not-used';
  if(mode==='tokens'){
    if(typeof Intl?.Segmenter==='function'){
      tokens=Array.from(new Intl.Segmenter('zh-Hant',{granularity:'word'}).segment(fold(query))).filter(x=>x.isWordLike).map(x=>x.segment);
      segmentation='Intl.Segmenter zh-Hant word';
    }else{tokens=fold(query).trim().split(/\s+/u);segmentation='whitespace-fallback';}
    tokens=[...new Set(tokens)];
    if(!tokens.length)return error('EMPTY_QUERY','The query has no searchable words.');
    if(tokens.length>100)return error('TOKEN_LIMIT','The query has too many separate words.');
  }
  const found=new Map();let truncated=false;
  for(const token of tokens){
    let cursor=0,count=0,position;
    while((position=normalized.indexOf(token,cursor))!==-1){
      const start=starts[position],end=ends[position+token.length-1];
      found.set(`${start}:${end}`,context(start,end));count++;
      cursor=position+Math.max(1,token.length);
      if(count>MAX){truncated=true;break;}
    }
    // Token mode is AND across the whole page, not a promise of a phrase match.
    if(count===0)return {id,ok:true,matches:[],truncated:false,segmentation,normalization:segments?'NFKC-grapheme':'NFKC-codepoint-fallback'};
  }
  const matches=Array.from(found.values()).sort((a,b)=>a.start-b.start||a.end-b.end);
  return {id,ok:true,matches:matches.slice(0,MAX),truncated:truncated||matches.length>MAX,segmentation,normalization:segments?'NFKC-grapheme':'NFKC-codepoint-fallback'};
}

/** Literal/token-only safe entry point. Route regex through SEARCH_WORKER_SOURCE. */
export function searchText(request){return boundedSearch(request,false);}

/** Self-contained classic Worker source. No imports, fetch, eval, or storage.
 * Host MUST terminate the Worker after its deadline: a synchronous regex cannot
 * interrupt itself. Recreate the worker before subsequent requests after timeout.
 * One in-flight request per worker is recommended; use id to reject stale replies.
 */
export const SEARCH_WORKER_SOURCE=`'use strict';\nconst runSearch=${boundedSearch.toString()};\nself.onmessage=event=>{let result;try{result=runSearch(event.data,true);}catch{result={id:null,ok:false,error:{code:'SEARCH_ERROR',message:'Search could not be completed.'}};}self.postMessage(result);};`;
