import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import fs from 'node:fs';
import path from 'node:path';
export const runtime='nodejs';

export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return new NextResponse('Prohibido',{status:403});
 const id=Number((await params).id);
 if(!Number.isSafeInteger(id)||id<=0)return new NextResponse('No encontrado',{status:404});
 const row=database().prepare('SELECT media_path,media_type,media_name FROM cases WHERE id=?').get(id) as {media_path:string|null;media_type:string|null;media_name:string|null}|undefined;
 if(!row?.media_path||!row.media_type)return new NextResponse('No encontrado',{status:404});
 const filename=path.basename(row.media_path);
 const filepath=path.join(process.cwd(),'data','media',filename);
 try{
  const stats=fs.statSync(filepath);
  if(!stats.isFile()||stats.size<1)return new NextResponse('Archivo no disponible',{status:404});
  const mime=row.media_type;
  const inline=mime.startsWith('image/')||mime.startsWith('video/')||mime.startsWith('audio/')||mime==='application/pdf';
  const headers:Record<string,string>={
   'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
   'Accept-Ranges':'bytes',
   'Content-Disposition':(inline?'inline':'attachment')+'; filename="'+(row.media_name||filename).replace(/[\r\n"\\]/g,'_')+'"'
  };
  const range=request.headers.get('range');
  if(range){
   const parts=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
   if(!parts)return new NextResponse(null,{status:416,headers:{...headers,'Content-Range':`bytes */${stats.size}`}});
   const from=parts[1]?Number(parts[1]):null;
   const to=parts[2]?Number(parts[2]):null;
   let start=from===null?Math.max(0,stats.size-(to||0)):from;
   let end=from===null?stats.size-1:Math.min(stats.size-1,to??stats.size-1);
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=stats.size||end<start)return new NextResponse(null,{status:416,headers:{...headers,'Content-Range':`bytes */${stats.size}`}});
   const file=fs.openSync(filepath,'r');
   const bytes=Buffer.alloc(end-start+1);
   try{fs.readSync(file,bytes,0,bytes.length,start);}finally{fs.closeSync(file);}
   headers['Content-Range']=`bytes ${start}-${end}/${stats.size}`;
   headers['Content-Length']=String(bytes.length);
   return new NextResponse(new Uint8Array(bytes),{status:206,headers});
  }
  headers['Content-Length']=String(stats.size);
  return new NextResponse(new Uint8Array(fs.readFileSync(filepath)),{headers});
 }catch{return new NextResponse('Archivo no disponible',{status:404});}
}
