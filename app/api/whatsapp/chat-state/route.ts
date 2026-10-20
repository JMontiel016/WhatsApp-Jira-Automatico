import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const parsed=z.object({phone:z.string().regex(/^(?:[0-9]{5,40}|[0-9-]{5,50}@g\.us)$/),action:z.enum(['read','unread','pin','unpin','favorite','unfavorite'])}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Datos inválidos'},{status:400});
 const {phone,action}=parsed.data;const d=database();
 // Los estados de lectura SIEMPRE se pueden guardar en TicketBridge.
 // Sin soporte en WhatsApp (por ejemplo markUnread en whatsapp-web.js 1.34.7),
 // informar que la sincronización remota no se confirmó, pero mantener el estado local.
 let syncedWithWhatsApp=false;
 let warning='';
 if(action==='read'||action==='unread'||action==='pin'||action==='unpin'){
  const check=await requireWhatsAppConnector();
  if(!check.ok){
   if(action==='pin'||action==='unpin')return NextResponse.json({error:check.error},{status:check.status});
   warning='Estado guardado en TicketBridge; WhatsApp no está conectado para confirmar la lectura.';
  }else{
   const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
   if(secret.length<24){
    if(action==='pin'||action==='unpin')return NextResponse.json({error:'Conector sin configurar'},{status:503});
    warning='Estado guardado en TicketBridge; el conector no tiene configuración de sincronización.';
   }else{
    try{
     const response=await fetch('http://127.0.0.1:3217/chat-state',{
      method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify({phone,action}),cache:'no-store',signal:AbortSignal.timeout(14000)
     });
     const result=await response.json().catch(()=>({error:'Respuesta inválida del conector'})) as {error?:string};
     if(!response.ok){
      if(action==='pin'||action==='unpin')return NextResponse.json({error:result.error||'WhatsApp no confirmó el cambio'},{status:response.status});
      warning='Estado guardado en TicketBridge, pero WhatsApp no confirmó el cambio: '+(result.error||'Operación no admitida');
     }else syncedWithWhatsApp=true;
    }catch{
     if(action==='pin'||action==='unpin')return NextResponse.json({error:'No se pudo sincronizar con WhatsApp'},{status:503});
     warning='Estado guardado en TicketBridge; no se pudo confirmar el cambio en WhatsApp.';
    }
   }
  }
 }
 d.prepare('INSERT OR IGNORE INTO chat_preferences(phone) VALUES(?)').run(phone);
 if(action==='read'){
  const latest=d.prepare("SELECT MAX(received_at) AS last_date FROM cases WHERE source='whatsapp' AND phone=?").get(phone) as {last_date:string|null};
  d.prepare("UPDATE chat_preferences SET last_read_at=?,force_unread=0,remote_unread=0,force_unread_at='' WHERE phone=?").run(latest.last_date||new Date().toISOString(),phone);
 }else if(action==='unread'){
  const latest=d.prepare("SELECT MAX(received_at) AS last_date FROM cases WHERE source='whatsapp' AND phone=? AND direction='in'").get(phone) as {last_date:string|null};
  d.prepare('UPDATE chat_preferences SET last_read_at=?,force_unread=1,remote_unread=0,force_unread_at=? WHERE phone=?').run(latest?.last_date||new Date().toISOString(),new Date().toISOString(),phone);
 }
 else if(action==='pin'||action==='unpin')d.prepare('UPDATE chat_preferences SET pinned=? WHERE phone=?').run(action==='pin'?1:0,phone);
 else d.prepare('UPDATE chat_preferences SET favorite=? WHERE phone=?').run(action==='favorite'?1:0,phone);
 return NextResponse.json({ok:true,action,syncedWithWhatsApp,warning});
}
