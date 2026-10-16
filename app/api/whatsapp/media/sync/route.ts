import {syncMessageEvidenceToLinkedTickets} from '@/lib/jira-evidence';
import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {saveRecoveredMedia,DownloadedMedia} from '@/lib/media';
import fs from 'node:fs';
import path from 'node:path';

export const runtime='nodejs';

type Row={id:number;phone:string;received_at:string;message:string;direction:string;wa_message_id:string|null;media_path:string|null};
type Item={id:number;media?:DownloadedMedia;error?:string};

export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo en la computadora local'},{status:403});
 const check=await requireWhatsAppConnector();if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Falta el secreto del conector local'},{status:503});
 const input=await request.json().catch(()=>null);
 if(!input||typeof input.phone!=='string'||!(/^[0-9]{5,40}$/.test(input.phone)||/^[0-9-]{5,50}@g\.us$/.test(input.phone))||!Array.isArray(input.ids)||input.ids.length<1||input.ids.length>4||input.ids.some((id:unknown)=>!Number.isSafeInteger(id)||Number(id)<=0))return NextResponse.json({error:'Solicitud de recuperación inválida'},{status:400});
 const ids=[...new Set(input.ids as number[])];
 const forceIds=new Set<number>(Array.isArray(input.forceIds)?input.forceIds.filter((id:unknown)=>Number.isSafeInteger(id)&&input.ids.includes(id)):[]);

 const placeholders=ids.map(()=>'?').join(',');
 const rows=database().prepare(`SELECT id,phone,received_at,message,direction,wa_message_id,media_path FROM cases WHERE source='whatsapp' AND phone=? AND id IN (${placeholders})`).all(input.phone,...ids) as Row[];
 if(rows.length!==ids.length)return NextResponse.json({error:'Los mensajes no pertenecen a la conversación'},{status:404});
 const outstanding=rows.filter(r=>forceIds.has(r.id)||!r.media_path||!fs.existsSync(path.join(process.cwd(),'data','media',path.basename(r.media_path))));
 if(!outstanding.length)return NextResponse.json({ok:true,saved:0,failed:0,items:[]});
 try{
  const res=await fetch('http://127.0.0.1:3217/recover-batch',{
    method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},
    body:JSON.stringify({phone:input.phone,items:outstanding.map(r=>({id:r.id,receivedAt:r.received_at,message:r.message,direction:r.direction,waMessageId:r.wa_message_id}))}),
    cache:'no-store',signal:AbortSignal.timeout(110000)
  });
  const response=await res.json().catch(()=>({error:'El conector respondió con datos inválidos'})) as {error?:string;items?:Item[]};
  if(!res.ok||!Array.isArray(response.items))return NextResponse.json({error:response.error||'La sesión WhatsApp no pudo recuperar los archivos'},{status:res.status===503?503:502});
  const allowed=new Set(outstanding.map(r=>r.id));const done=new Set<number>();const outcome:Array<{id:number;ok:boolean;error?:string}>=[];
  for(const item of response.items){
   if(!item||!allowed.has(item.id)||done.has(item.id))continue;
   done.add(item.id);
   if(item.media){
    try{saveRecoveredMedia(item.id,item.media);const jira=await syncMessageEvidenceToLinkedTickets(item.id);if(jira.errors.length)console.warn('[JIRA MEDIA] Revisar adjunto local:',item.id);outcome.push({id:item.id,ok:true});}
    catch(e){outcome.push({id:item.id,ok:false,error:e instanceof Error?e.message:'Archivo inválido'});}
   }else outcome.push({id:item.id,ok:false,error:item.error||'El archivo original no está disponible en la sesión vinculada'});
  }
  for(const row of outstanding){if(!done.has(row.id))outcome.push({id:row.id,ok:false,error:'WhatsApp no entregó el adjunto'});}
  const d=database();
  for(const o of outcome)if(!o.ok)d.prepare('UPDATE cases SET media_error=? WHERE id=? AND media_path IS NULL').run((o.error||'No recuperable').slice(0,450),o.id);
  return NextResponse.json({ok:true,saved:outcome.filter(o=>o.ok).length,failed:outcome.filter(o=>!o.ok).length,items:outcome},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Fallo al conectar con WhatsApp'},{status:502});}
}
