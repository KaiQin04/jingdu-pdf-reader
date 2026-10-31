// Cloud preview adapter only. Not bundled into deployed Worker.
import http from 'node:http';
import worker from '../dist/server/index.js';
const origin='https://jingdu-pdf-reader.qqqqqwz.chatgpt.site';
http.createServer(async(req,res)=>{
 try{
 const r=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})}),{PDF_READER_SITE_ORIGIN:origin});
 res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Preview failed');}
}).listen(Number(process.env.PORT||4173),'0.0.0.0');
