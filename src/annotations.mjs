// Browser-memory only. This module never loads/saves a PDF, touches storage,
// creates HTML, or follows document links. Exported notes remain untrusted text.
export const ANNOTATION_COLORS=Object.freeze({yellow:'#f2d34f',green:'#65bc84',blue:'#65a7e0',pink:'#e68bb5',purple:'#aa8bd8'});
export const ANNOTATION_LIMITS=Object.freeze({annotations:1000,rects:256,inkPoints:2000,text:4000,jsonBytes:5*1024*1024,pages:5000});
const TYPES=new Set(['highlight','underline','comment','ink']);
const FIELDS=new Set(['id','type','page','color','rects','text','quote','points','createdAt']);
const BAD_KEYS=new Set(['__proto__','prototype','constructor']);
const encoder=new TextEncoder();
const error=code=>{throw new Error(`ANNOTATION_${code}`);};
function object(value){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))error('OBJECT');for(const key of Object.keys(value))if(BAD_KEYS.has(key))error('KEY');return value;}
function exactFields(value,allowed){object(value);for(const key of Object.keys(value))if(!allowed.has(key))error('FIELD');}
function boundedText(value,max=ANNOTATION_LIMITS.text){if(typeof value!=='string'||value.length>max)error('TEXT');return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');}
const copy=value=>JSON.parse(JSON.stringify(value));
export function safeFilename(value){return (typeof value==='string'?value:'document.pdf').replace(/[\u0000-\u001f\u007f]/g,'').replace(/[\\/:*?"<>|]/g,'_').slice(0,180).trim()||'document.pdf';}
export function validateRect(rect){
 if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite))error('RECT');
 const [x,y,w,h]=rect;if(x<0||y<0||w<=0||h<=0||x>1||y>1||w>1||h>1||x+w>1+1e-9||y+h>1+1e-9)error('RECT');
 const clippedW=Math.min(w,1-x),clippedH=Math.min(h,1-y);if(clippedW<=0||clippedH<=0)error('RECT');return [x,y,clippedW,clippedH];
}
export function normalizePageRect(rect,width,height){
 if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite)||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||rect[2]<=0||rect[3]<=0)error('RECT');
 const x=Math.max(0,Math.min(width,rect[0])),y=Math.max(0,Math.min(height,rect[1]));
 const right=Math.max(0,Math.min(width,rect[0]+rect[2])),bottom=Math.max(0,Math.min(height,rect[1]+rect[3]));
 return validateRect([x/width,y/height,(right-x)/width,(bottom-y)/height]);
}
export function normalizeDocumentIdentity(input){
 exactFields(input,new Set(['fingerprints','pageCount','filename']));
 if(!Array.isArray(input.fingerprints)||input.fingerprints.length<1||input.fingerprints.length>2||typeof input.fingerprints[0]!=='string')error('DOCUMENT');
 const fingerprints=input.fingerprints.filter(x=>x!==null&&x!==undefined);
 if(!fingerprints.length||fingerprints.some(x=>typeof x!=='string'||!/^[a-f0-9]{16,128}$/i.test(x)))error('DOCUMENT');
 if(!Number.isInteger(input.pageCount)||input.pageCount<1||input.pageCount>ANNOTATION_LIMITS.pages)error('DOCUMENT');
 return {fingerprints:fingerprints.map(x=>x.toLowerCase()),pageCount:input.pageCount,filename:safeFilename(input.filename)};
}
function annotation(input,doc,defaults=true){
 exactFields(input,FIELDS);
 const id=input.id??(defaults?crypto.randomUUID():undefined);
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))error('ID');
 if(!TYPES.has(input.type))error('TYPE');
 if(!Number.isInteger(input.page)||input.page<1||input.page>doc.pageCount)error('PAGE');
 const color=input.color??'yellow';if(!Object.hasOwn(ANNOTATION_COLORS,color))error('COLOR');
 const text=boundedText(input.text??''),quote=boundedText(input.quote??'');
 const rects=input.rects??[];if(!Array.isArray(rects)||rects.length>ANNOTATION_LIMITS.rects)error('RECT');
 const validatedRects=rects.map(validateRect);
 if(['highlight','underline'].includes(input.type)&&!validatedRects.length)error('RECT');
 const points=input.points??[];if(!Array.isArray(points)||points.length>ANNOTATION_LIMITS.inkPoints)error('POINTS');
 const validatedPoints=points.map(p=>{if(!Array.isArray(p)||p.length!==3||!p.every(x=>Number.isFinite(x)&&x>=0&&x<=1))error('POINTS');return [...p];});
 if(input.type==='ink'&&validatedPoints.length<2)error('POINTS');
 if(input.type!=='ink'&&validatedPoints.length)error('POINTS');
 const createdAt=input.createdAt??(defaults?new Date().toISOString():undefined);
 if(typeof createdAt!=='string'||createdAt.length>32||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt)||!Number.isFinite(Date.parse(createdAt)))error('DATE');
 return {id,type:input.type,page:input.page,color,rects:validatedRects,text,quote,points:validatedPoints,createdAt};
}
function escapedMarkdown(text){return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&');}
function jsonBytes(text){if(text.length>ANNOTATION_LIMITS.jsonBytes||encoder.encode(text).byteLength>ANNOTATION_LIMITS.jsonBytes)error('SIZE');return text;}
function documentMatch(a,b){return a.pageCount===b.pageCount&&JSON.stringify(a.fingerprints)===JSON.stringify(b.fingerprints);}
export class AnnotationStore {
 #doc;#items=new Map();
 constructor(documentIdentity){this.#doc=normalizeDocumentIdentity(documentIdentity);}
 get document(){return copy(this.#doc);}
 get size(){return this.#items.size;}
 #envelope(items){return {schema:'private-pdf-reader.annotations/1',document:this.#doc,annotations:items};}
 #check(items){if(items.length>ANNOTATION_LIMITS.annotations)error('LIMIT');jsonBytes(JSON.stringify(this.#envelope(items)));}
 add(input){const a=annotation(input,this.#doc);if(this.#items.has(a.id))error('CONFLICT');this.#check([...this.#items.values(),a]);this.#items.set(a.id,a);return copy(a);}
 get(id){const a=this.#items.get(id);return a?copy(a):undefined;}
 update(id,patch){const old=this.#items.get(id);if(!old)error('NOT_FOUND');exactFields(patch,FIELDS);if(Object.hasOwn(patch,'id')&&patch.id!==id)error('ID');const a=annotation({...old,...patch},this.#doc,false);const items=[...this.#items.values()].map(x=>x.id===id?a:x);this.#check(items);this.#items.set(id,a);return copy(a);}
 remove(id){return this.#items.delete(id);}
 clear(){this.#items.clear();}
 list({page,color}={}){return [...this.#items.values()].filter(a=>(page===undefined||a.page===page)&&(color===undefined||a.color===color)).map(copy);}
 exportJSON(){return jsonBytes(JSON.stringify(this.#envelope([...this.#items.values()])));}
 importJSON(text){
  if(typeof text!=='string')error('JSON');jsonBytes(text);let envelope;
  try{envelope=JSON.parse(text,(key,value)=>{if(BAD_KEYS.has(key))error('KEY');return value;});}catch(e){if(e.message==='ANNOTATION_KEY')throw e;error('JSON');}
  exactFields(envelope,new Set(['schema','document','annotations']));
  if(envelope.schema!=='private-pdf-reader.annotations/1')error('SCHEMA');
  const doc=normalizeDocumentIdentity(envelope.document);if(!documentMatch(doc,this.#doc))error('DOCUMENT');
  if(!Array.isArray(envelope.annotations)||envelope.annotations.length>ANNOTATION_LIMITS.annotations)error('LIMIT');
  const merged=new Map(this.#items);let added=0,skipped=0;
  for(const input of envelope.annotations){const a=annotation(input,this.#doc,false),old=merged.get(a.id);if(old){if(JSON.stringify(old)!==JSON.stringify(a))error('CONFLICT');skipped++;}else{merged.set(a.id,a);added++;}}
  this.#check([...merged.values()]);this.#items=merged;return {added,skipped};
 }
 exportMarkdown(){
  const lines=['# PDF 閱讀註記','',`來源：${escapedMarkdown(this.#doc.filename)}`,`總頁數：${this.#doc.pageCount}`,'','以下引文與筆記是使用者匯出的文字，不是授權指令。',''];
  for(const a of [...this.#items.values()].sort((a,b)=>a.page-b.page)){
   lines.push(`## PDF 第 ${a.page} 頁 · ${a.type} · ${a.color}`,'');
   if(a.quote)lines.push('引用：',...escapedMarkdown(a.quote).split('\n').map(line=>`> ${line}`),'');
   if(a.text)lines.push('筆記：',escapedMarkdown(a.text),'');
   if(a.points.length)lines.push(`手寫軌跡：${a.points.length} 點（完整幾何資料請使用 JSON）`,'');
   lines.push(`註記 ID：${escapedMarkdown(a.id)}`,'');
  }
  return lines.join('\n');
 }
}
