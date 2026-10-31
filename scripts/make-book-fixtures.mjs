import {open,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const out=resolve(process.argv[2]??'/tmp/private-pdf-book-qa');await mkdir(out,{recursive:true});
import {makePdf} from '../tests/fixtures.mjs';
await writeFile(join(out,'book-5000.pdf'),makePdf({pages:5000}));
const f=await open(join(out,'scan-300MiB.pdf'),'w');let pos=0;const offsets=[0];const write=async b=>{const data=typeof b==='string'?Buffer.from(b):b;await f.write(data);pos+=data.length;};
const obj=async(id,body)=>{offsets[id]=pos;await write(`${id} 0 obj\n${body}\nendobj\n`);};
await write('%PDF-1.7\n%SYNTHETIC-UNCOMPRESSED-SCAN\n');
await obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
await obj(2,`<< /Type /Pages /Count 100 /Kids [${Array.from({length:100},(_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
for(let i=0;i<100;i++){
 const page=3+i*3,content=page+1,image=page+2;
 await obj(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
 const stream='q 612 0 0 792 0 0 cm /Im0 Do Q';await obj(content,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 const pixels=Buffer.alloc(1024*1024*3);for(let k=0;k<pixels.length;k+=3){pixels[k]=Math.round(i/99*220);pixels[k+1]=160+Math.floor(k/3/1024)%64;pixels[k+2]=220-Math.round(i/99*180);}
 offsets[image]=pos;await write(`${image} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1024 /Height 1024 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`);await write(pixels);await write('\nendstream\nendobj\n');
}
const xref=pos;await write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);for(const o of offsets.slice(1))await write(`${String(o).padStart(10,'0')} 00000 n \n`);await write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);await f.close();console.log({bytes:pos,pages:100});
