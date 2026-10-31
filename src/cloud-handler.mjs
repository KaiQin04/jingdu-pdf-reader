import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createReaderServer, RESOURCE, VERSION } from './mcp-definition.mjs';

import { ICON_DATA_URI, ICONS } from './brand.mjs';

const BODY_LIMIT=32768, MAX_DEPTH=16, REQUEST_MS=10000, MAX_RESPONSE=9*1024*1024;
const REVISION_KEY='io.modelcontextprotocol/protocolVersion';
const COMMON_HEADERS={
  'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
const METHODS=new Set(['server/discover','initialize','notifications/initialized','ping','tools/list','tools/call','resources/list','resources/read','resources/templates/list']);
const plain=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const owns=(v,key)=>Object.hasOwn(v,key);
const reply=(status,message)=>new Response(message,{status,headers:{...COMMON_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
const rpc=(id,result)=>new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{headers:{...COMMON_HEADERS,'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
function siteOrigin(env){
  try {
    const value=env?.PDF_READER_SITE_ORIGIN;
    if(typeof value!=='string')return null;
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && !url.port && value===url.origin ? value : null;
  }catch{return null;}
}
async function readBounded(request){
  if(Number(request.headers.get('Content-Length')||0)>BODY_LIMIT)throw new Error('SIZE');
  const reader=request.body?.getReader();if(!reader)throw new Error('JSON');
  let timer,length=0;const parts=[];
  const operation=(async()=>{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>BODY_LIMIT)throw new Error('SIZE');parts.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  })();
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TIMEOUT')),REQUEST_MS);})]);}
  finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
function parseBody(raw){
  let depth=0,inString=false,escaped=false;
  for(const char of raw){
    if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;}
    else if(char==='"')inString=true;
    else if(char==='{'||char==='['){if(++depth>MAX_DEPTH)throw new Error('JSON');}
    else if(char==='}'||char===']')depth--;
  }
  const body=JSON.parse(raw);
  if(!plain(body)||body.jsonrpc!=='2.0'||!METHODS.has(body.method))throw new Error('JSON');
  if(Object.keys(body).some(k=>!['jsonrpc','id','method','params'].includes(k)))throw new Error('JSON');
  if(owns(body,'id')){
    if(!(Number.isSafeInteger(body.id)||(typeof body.id==='string'&&body.id.length<=128)))throw new Error('JSON');
  }else if(body.method!=='notifications/initialized')throw new Error('JSON');
  if(body.params!==undefined&&!plain(body.params))throw new Error('JSON');
  const params=body.params??{};
  if(body.method==='tools/call'){
    if(params.name!=='open_pdf_reader'||!plain(params.arguments)||Object.keys(params.arguments).length!==0)throw new Error('JSON');
    if(Object.keys(params).some(k=>!['name','arguments','_meta'].includes(k)))throw new Error('JSON');
  }else if(body.method==='resources/read'){
    if(params.uri!==RESOURCE||Object.keys(params).some(k=>!['uri','_meta'].includes(k)))throw new Error('JSON');
  }else if(['tools/list','resources/list','resources/templates/list','server/discover','ping','notifications/initialized'].includes(body.method)){
    if(Object.keys(params).some(k=>k!=='_meta'))throw new Error('JSON');
  }
  return body;
}

export function createCloudWorker({html,csp,documents={}}){
  const readerHtml=html.replace(/<html lang="(en|zh-Hant)">/,'<html lang="$1" data-local>');
  const shell='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jingdu PDF Reader</title><link rel="icon" type="image/png" href="'+ICON_DATA_URI+'"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><iframe title="Jingdu PDF Reader" sandbox="allow-scripts" src="/reader"></iframe></html>';
  let active=0;
  return {async fetch(request,env){
    // Anonymous fixed-content service: never read identity, cookies or authorization.
    const expected=siteOrigin(env);if(!expected)return reply(503,'Site origin is not configured');
    const url=new URL(request.url);
    if(url.origin!==expected)return reply(403,'Invalid host');
    if(url.search||!['/','/reader','/mcp',...Object.keys(documents)].includes(url.pathname))return reply(404,'Not found');
    if(Object.hasOwn(documents,url.pathname)){
      if(!['GET','HEAD'].includes(request.method))return reply(405,'Method not allowed');
      return new Response(request.method==='HEAD'?null:documents[url.pathname],{headers:{...COMMON_HEADERS,'Content-Type':'text/plain; charset=utf-8','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; sandbox"}});
    }
    if(url.pathname!=='/mcp'){
      if(!['GET','HEAD'].includes(request.method))return reply(405,'Method not allowed');
      const policy=url.pathname==='/'?"default-src 'none'; frame-src 'self'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'":csp+"; sandbox allow-scripts; frame-ancestors 'self'";
      return new Response(request.method==='HEAD'?null:(url.pathname==='/'?shell:readerHtml),{headers:{...COMMON_HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy}});
    }
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...COMMON_HEADERS,'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Accept, MCP-Protocol-Version, MCP-Method, MCP-Name','Access-Control-Max-Age':'600'}});
    if(request.method!=='POST')return reply(405,'Only POST is supported');
    if((request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,'JSON required');
    if(request.headers.has('Content-Encoding'))return reply(415,'Encoded bodies are not supported');
    if(active>=4)return reply(429,'Busy');
    active++;
    let server,transport,handler,timer;
    try{
      const body=parseBody(await readBounded(request));
      // Sites documents a plain JSON-RPC discovery probe; support it in addition
      // to the SDK's modern envelope protocol. Do not rewrite client metadata.
      if(body.method==='server/discover'&&!body.params?._meta?.[REVISION_KEY]&&!request.headers.has('MCP-Protocol-Version')){
        return rpc(body.id,{supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'jingdu-public-reader',version:VERSION,icons:ICONS}}});
      }
      let response;
      const operation=(async()=>{
        if(await isLegacyRequest(request,body,{maxRequestBodySize:BODY_LIMIT})){
          server=createReaderServer(html);
          transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:BODY_LIMIT});
          await server.connect(transport);response=await transport.handleRequest(request,{parsedBody:body});
        }else{
          handler=createMcpHandler(()=>createReaderServer(html),{legacy:'reject',maxRequestBodySize:BODY_LIMIT,maxSubscriptions:0,onerror:()=>{}});
          response=await handler.fetch(request,{parsedBody:body});
        }
        // Tools emit no progress and hold no subscriptions; fully consume before cleanup.
        const bytes=await response.arrayBuffer();
        if(bytes.byteLength>MAX_RESPONSE)throw new Error('RESPONSE');
        const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');for(const [key,value] of Object.entries(COMMON_HEADERS))headers.set(key,value);
        return new Response(bytes,{status:response.status,headers});
      })();
      return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TIMEOUT')),REQUEST_MS);})]);
    }catch(error){
      return reply(error.message==='SIZE'?413:error.message==='TIMEOUT'?408:400,'Request rejected');
    }finally{
      clearTimeout(timer);await transport?.close().catch(()=>{});await server?.close().catch(()=>{});await handler?.close().catch(()=>{});active--;
    }
  }};
}
