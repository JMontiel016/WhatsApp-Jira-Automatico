import {syncMessageEvidenceToLinkedTickets} from '@/lib/jira-evidence';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {saveRecoveredMedia} from '@/lib/media';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo disponible localmente'},{status:403});
 try{
  const form=await request.formData();
  const id=Number(form.get('id')),phone=String(form.get('phone')||''),file=form.get('file');
  if(!Number.isSafeInteger(id)||id<=0||!/^\d{5,40}$/.test(phone)||!(file instanceof File))return NextResponse.json({error:'Datos inválidos'},{status:400});
  if(file.size<1||file.size>12*1024*1024)return NextResponse.json({error:'La imagen debe tener entre 1 byte y 12 MB'},{status:400});
  const allowed=['image/jpeg','image/png','image/webp','image/gif'];
  if(!allowed.includes(file.type))return NextResponse.json({error:'Solo se permiten imágenes JPG, PNG, WebP o GIF'},{status:400});
  const row=database().prepare("SELECT media_path,media_source,media_error,has_media,message FROM cases WHERE id=? AND phone=? AND source='whatsapp'").get(id,phone) as {media_path:string|null;media_source:string|null;media_error:string|null;has_media:number;message:string}|undefined;
  if(!row)return NextResponse.json({error:'Mensaje no encontrado en esta conversación'},{status:404});
  if(row.media_path&&row.media_source!=='manual')return NextResponse.json({error:'El mensaje ya tiene el archivo original descargado'},{status:409});
  if(!row.media_error&&!row.has_media&&!/^\[Adjunto WhatsApp:/.test(row.message||'')&&!row.media_path)return NextResponse.json({error:'Este mensaje no corresponde a un adjunto de WhatsApp'},{status:400});
  const bytes=Buffer.from(await file.arrayBuffer());
  saveRecoveredMedia(id,{mime:file.type,filename:file.name||'imagen',data:bytes.toString('base64')},'manual');
  const jira=await syncMessageEvidenceToLinkedTickets(id);
  return NextResponse.json({ok:true,origin:'manual',jira},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'No se pudo importar la imagen'},{status:400});}
}
