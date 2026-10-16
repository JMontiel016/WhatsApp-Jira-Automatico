import {syncMessageEvidenceToLinkedTickets} from '@/lib/jira-evidence';
import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {saveRecoveredMedia,DownloadedMedia} from '@/lib/media';
export const runtime='nodejs';
type Row={id:number;received_at:string;message:string;direction:string;wa_message_id:string|null;has_media:number};
type Found={id:number;found:boolean;waMessageId?:string;media?:DownloadedMedia;error?:string};
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const input=await req.json().catch(()=>null);
 if(!input||typeof input.phone!=='string'||!(/^[0-9]{5,40}$/.test(input.phone)||/^[0-9-]{5,50}@g\.us$/.test(input.phone)))return NextResponse.json({error:'Contacto inválido'},{status:400});
 const check=await requireWhatsAppConnector();if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'El conector no está configurado'},{status:503});
 const db=database();
 // Lote acotado a los 80 eventos más recientes sin archivo, sin alterar mensajes ni tickets.
 const rows=db.prepare("SELECT id,received_at,message,direction,wa_message_id,has_media FROM cases WHERE source='whatsapp' AND phone=? AND media_path IS NULL ORDER BY received_at DESC,id DESC LIMIT 50").all(input.phone) as Row[];
 if(!rows.length)return NextResponse.json({ok:true,discovered:0,saved:0});
 try{
  const response=await fetch('http://127.0.0.1:3217/discover',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify({phone:input.phone,items:rows.map(r=>({id:r.id,receivedAt:r.received_at,message:r.message.slice(0,140),direction:r.direction,waMessageId:r.wa_message_id||'',hasMedia:Boolean(r.has_media)}))}),cache:'no-store',signal:AbortSignal.timeout(95000)});
  const data=await response.json().catch(()=>({error:'Respuesta inválida'})) as {items?:Found[];error?:string};
  if(!response.ok||!Array.isArray(data.items))return NextResponse.json({error:data.error||`No se pudo explorar el historial (HTTP ${response.status})`},{status:response.status===503?503:502});
  const allowed=new Set(rows.map(r=>r.id));let saved=0,discovered=0;
  for(const item of data.items){
   if(!item?.found||!allowed.has(item.id))continue;
   discovered++;
   db.prepare("UPDATE cases SET has_media=1,wa_message_id=COALESCE(NULLIF(wa_message_id,''),?) WHERE id=? AND source='whatsapp'").run((item.waMessageId||'').slice(0,300),item.id);
   if(item.media){try{saveRecoveredMedia(item.id,item.media);await syncMessageEvidenceToLinkedTickets(item.id);saved++;}catch(e){db.prepare('UPDATE cases SET media_error=? WHERE id=? AND media_path IS NULL').run(String(e instanceof Error?e.message:e).slice(0,400),item.id);}}
   else db.prepare('UPDATE cases SET media_error=? WHERE id=? AND media_path IS NULL').run((item.error||'La imagen sigue sin estar disponible').slice(0,400),item.id);
  }
  return NextResponse.json({ok:true,discovered,saved},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Fallo en el historial'},{status:502});}
}
