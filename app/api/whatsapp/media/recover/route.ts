import {syncMessageEvidenceToLinkedTickets} from '@/lib/jira-evidence';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import fs from 'node:fs';
import path from 'node:path';
import {saveRecoveredMedia} from '@/lib/media';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 const host=request.headers.get('host')||'';
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(host))return NextResponse.json({error:'Solo disponible en la computadora local'},{status:403});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Falta configurar el secreto local'},{status:503});
 const body=await request.json().catch(()=>null);
 if(!body||!Number.isSafeInteger(body.id)||body.id<=0)return NextResponse.json({error:'ID inválido'},{status:400});
 const db=database();
 const row=db.prepare("SELECT id,phone,received_at,message,direction,wa_message_id,media_path,media_type FROM cases WHERE id=? AND source='whatsapp'").get(body.id) as {id:number,phone:string,received_at:string,message:string,direction:string,wa_message_id:string|null,media_path:string|null,media_type:string|null}|undefined;
 if(!row)return NextResponse.json({error:'Mensaje no encontrado'},{status:404});
 if(row.media_path&&fs.existsSync(path.join(process.cwd(),'data','media',path.basename(row.media_path))))return NextResponse.json({ok:true,already:true});
 try{
  const res=await fetch('http://127.0.0.1:3217/recover',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify({phone:row.phone,receivedAt:row.received_at,message:row.message,direction:row.direction,waMessageId:row.wa_message_id||''}),signal:AbortSignal.timeout(45000),cache:'no-store'});
  const result=await res.json() as {error?:string,media?:{mime:string,filename:string,data:string}};
  if(!res.ok||!result.media)return NextResponse.json({error:result.error||'WhatsApp no entregó el archivo para visualizarlo'},{status:res.status>=400&&res.status<500?res.status:502});
  const saved=saveRecoveredMedia(row.id,result.media);
  const jira=await syncMessageEvidenceToLinkedTickets(row.id);
  return NextResponse.json({ok:true,filename:saved.filename,mime:saved.mime,jira});
 }catch(e){
  const error=e instanceof Error?e.message:'Error de recuperación';
  return NextResponse.json({error},{status:502});
 }
}
