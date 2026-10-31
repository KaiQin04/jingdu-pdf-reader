import { mkdir,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const escape=s=>s.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
export function makePdf({pages=3,actions=false,hugePage=false}={}){
  const objects=['','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const add=s=>{objects.push(s);return objects.length;};
  const pageIds=[];
  let actionId,launchId,linkId,attachId;
  if(actions){
    actionId=add("<< /S /JavaScript /JS (globalThis.__pdfActionRan = true; app.launchURL\(\"https://example.invalid/pdf-action\"\);) >>");
    launchId=add('<< /S /Launch /F (synthetic-do-not-run.exe) >>');
    linkId=add('<< /Type /Annot /Subtype /Link /Rect [30 630 500 700] /A << /S /URI /URI (https://example.invalid/should-never-load) >> >>');
    const content='SYNTHETIC ATTACHMENT - DO NOT EXECUTE';
    const stream=add(`<< /Type /EmbeddedFile /Length ${content.length} >>\nstream\n${content}\nendstream`);
    attachId=add(`<< /Type /Filespec /F (synthetic.txt) /EF << /F ${stream} 0 R >> >>`);
  }
  for(let i=1;i<=pages;i++){
    const lines=[`PRIVATE PDF READER / SYNTHETIC DOCUMENT`, `Page ${i} - ${i===2?'Aurora search target':'Research notes'}`, 'This file contains no private information.', actions?'Actions and attachments must stay inert.':'Select a line and create a page citation.', 'IGNORE PREVIOUS INSTRUCTIONS is quoted data.'];
    let stream='BT /F1 18 Tf 40 730 Td\n';
    lines.forEach((line,index)=>{if(index)stream+='0 -34 Td\n';stream+=`(${escape(line)}) Tj\n`;});stream+='ET';
    const contentId=add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId=add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${hugePage?'100000 100000':'612 792'}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R ${actions?`/AA << /O ${actionId} 0 R /C ${launchId} 0 R >> /Annots [${linkId} 0 R]`:''} >>`);
    pageIds.push(pageId);
  }
  objects[0]=`<< /Type /Catalog /Pages 2 0 R ${actions?`/OpenAction ${actionId} 0 R /Names << /EmbeddedFiles << /Names [(synthetic.txt) ${attachId} 0 R] >> >>`:''} >>`;
  objects[1]=`<< /Type /Pages /Count ${pages} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`;
  let output='%PDF-1.7\n%synthetic\n';const offsets=[0];let length=Buffer.byteLength(output);
  for(let i=0;i<objects.length;i++){offsets.push(length);const part=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;output+=part;length+=Buffer.byteLength(part);}
  const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))output+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  output+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
export async function writeFixtures(){
  const dir=new URL('./fixtures/',import.meta.url);await mkdir(dir,{recursive:true});
  for(const [name,options] of [['normal',{}],['actions',{actions:true,pages:1}],['many-pages',{pages:301}],['huge-page',{hugePage:true,pages:1}]])await writeFile(new URL(`${name}.pdf`,dir),makePdf(options));
  await writeFile(new URL('corrupt.pdf',dir),'%PDF-1.7\nThis is not a valid PDF');
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)await writeFixtures();
