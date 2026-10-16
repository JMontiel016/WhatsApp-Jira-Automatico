import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {saveRecoveredMedia} from '@/lib/media';
import {syncTicketEvidence} from '@/lib/jira-evidence';
import {rejectCrossOrigin} from '@/lib/security';
import fs from 'node:fs';
import path from 'node:path';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 try{
  if(Number(request.headers.get('content-length')||0)>17_300_000)return NextResponse.json({error:'El archivo supera el límite permitido'},{status:413});
  const form=await request.formData();
  const phone=String(form.get('phone')||'');const key=String(form.get('key')||'');
  const id=Number(form.get('id'));const file=form.get('file');
  if(!/^\d{5,40}$/.test(phone)||!/^CW-[0-9]+$/.test(key)||!Number.isSafeInteger(id)||id<=0||!(file instanceof File))return NextResponse.json({error:'Datos inválidos'},{status:400});
  if(file.size<1||file.size>12*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))return NextResponse.json({error:'Solo imágenes PNG, JPG, WebP o GIF hasta 12 MB'},{status:400});
  const db=database();
  const row=db.prepare(`SELECT c.media_path,c.media_source,c.has_media,c.media_error,c.message FROM cases c
  JOIN customer_ticket_messages tm ON tm.message_id=c.id JOIN customer_jira_tickets t ON t.id=tm.ticket_id
  WHERE c.id=? AND c.phone=? AND t.phone=? AND t.jira_key=? AND t.status='created'`).get(id,phone,phone,key) as
  {media_path:string|null;media_source:string|null;has_media:number;media_error:string|null;message:string}|undefined;
  if(!row)return NextResponse.json({error:'El mensaje no corresponde a este ticket'},{status:404});
  if(row.media_path&&fs.existsSync(path.join(process.cwd(),'data','media',path.basename(row.media_path))))return NextResponse.json({error:'Este mensaje ya tiene un archivo. No se reemplazará evidencia existente.'},{status:409});
  if(!row.has_media&&!row.media_error&&!/^\[Adjunto WhatsApp:/.test(row.message))return NextResponse.json({error:'El mensaje no contiene un adjunto de WhatsApp pendiente'},{status:409});
  const bytes=Buffer.from(await file.arrayBuffer());
  saveRecoveredMedia(id,{mime:file.type,filename:file.name||'captura',data:bytes.toString('base64')},'manual');
  const result=await syncTicketEvidence(key,[id]);
  return NextResponse.json({ok:true,saved:true,jira:result},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'No fue posible importar la captura'},{status:400});}
}
