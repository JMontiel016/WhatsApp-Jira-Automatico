import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const input=await req.json().catch(()=>null);
 if(!input||typeof input.phone!=='string'||input.phone.length>60)return NextResponse.json({error:'Chat inválido'},{status:400});
 const check=await requireWhatsAppConnector();if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const db=database();
 const messages=db.prepare("SELECT wa_message_id FROM cases WHERE phone=? AND source='whatsapp' AND wa_message_id IS NOT NULL AND wa_message_id NOT LIKE 'fallback-%' ORDER BY received_at DESC,id DESC LIMIT 30").all(input.phone) as {wa_message_id:string}[];
 const ids=[...new Set(messages.map(m=>m.wa_message_id))];
 if(!ids.length)return NextResponse.json({ok:true,refreshed:0});
 try{
  const response=await fetch('http://127.0.0.1:3217/reactions-snapshot',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':process.env.WHATSAPP_LOCAL_SECRET||''},body:JSON.stringify({phone:input.phone,ids}),cache:'no-store',signal:AbortSignal.timeout(22000)});
  const data=await response.json().catch(()=>({error:'Respuesta inválida'})) as {error?:string;items?:Array<{waMessageId:string;reactions:Array<{actorId:string;emoji:string}>}>};
  if(!response.ok||!Array.isArray(data.items))return NextResponse.json({error:data.error||'No se pudieron recuperar reacciones'},{status:502});
  const allowed=new Set(ids);let refreshed=0;
  const transaction=db.transaction((items:typeof data.items)=>{
   for(const item of items||[]){
    if(!item||!allowed.has(item.waMessageId)||!Array.isArray(item.reactions))continue;
    db.prepare('DELETE FROM message_reactions WHERE wa_message_id=?').run(item.waMessageId);
    for(const reaction of item.reactions.slice(0,300)){
     if(typeof reaction.actorId!=='string'||!reaction.actorId||reaction.actorId.length>120||typeof reaction.emoji!=='string'||!reaction.emoji||reaction.emoji.length>24)continue;
     db.prepare('INSERT OR REPLACE INTO message_reactions(wa_message_id,actor_id,emoji) VALUES (?,?,?)').run(item.waMessageId,reaction.actorId,reaction.emoji);
    }
    refreshed++;
   }
  });
  transaction(data.items);
  return NextResponse.json({ok:true,refreshed});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'WhatsApp no respondió'},{status:502});}
}
