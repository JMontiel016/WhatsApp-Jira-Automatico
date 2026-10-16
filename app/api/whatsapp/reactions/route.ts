import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const parsed=z.object({id:z.number().int().positive(),phone:z.string().min(5).max(60),emoji:z.string().max(24)}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success|| (parsed.data.emoji && !/\p{Extended_Pictographic}/u.test(parsed.data.emoji)))return NextResponse.json({error:'Emoji inválido'},{status:400});
 const {id,phone,emoji}=parsed.data;
 const row=database().prepare("SELECT wa_message_id FROM cases WHERE id=? AND phone=? AND source='whatsapp'").get(id,phone) as {wa_message_id:string|null}|undefined;
 if(!row)return NextResponse.json({error:'El mensaje no pertenece a esta conversación'},{status:404});
 if(!row.wa_message_id||row.wa_message_id.startsWith('fallback-'))return NextResponse.json({error:'Este mensaje no tiene ID real de WhatsApp para reaccionar'},{status:409});
 const check=await requireWhatsAppConnector();if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 try{
  const response=await fetch('http://127.0.0.1:3217/react',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify({phone,waMessageId:row.wa_message_id,emoji}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>({error:'Respuesta inválida del conector'})) as {error?:string};
  if(!response.ok)return NextResponse.json({error:data.error||`WhatsApp HTTP ${response.status}`},{status:response.status});
  const d=database();
  if(emoji)d.prepare("INSERT INTO message_reactions(wa_message_id,actor_id,emoji) VALUES (?,'self',?) ON CONFLICT(wa_message_id,actor_id) DO UPDATE SET emoji=excluded.emoji,updated_at=CURRENT_TIMESTAMP").run(row.wa_message_id,emoji);
  else d.prepare("DELETE FROM message_reactions WHERE wa_message_id=? AND actor_id='self'").run(row.wa_message_id);
  return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'WhatsApp no respondió'},{status:502});}
}
