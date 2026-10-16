import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {z} from 'zod';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';

type StoredChat = {chat_id:string|null};
type StoredMessage = {wa_chat_id:string|null;wa_message_id:string|null};
const validChat = (value:string|undefined|null,phone:string) =>
  Boolean(value && ((/^[0-9-]{5,50}@g\.us$/.test(phone)&&value===phone)||(/^\d{5,40}@(c\.us|lid)$/.test(value)&&value.split('@')[0]===phone)));

// Identificar el JID por un ID de evento nativo histórico, sin inferir que todo es @c.us.
function chatIdFromMessageId(id:string|null,phone:string):string|null{
 if (!id) return null;
 const pattern=/(?:^|_)(\d{5,40}@(c\.us|lid))(?=_|$)/g;
 let match:RegExpExecArray|null;
 while((match=pattern.exec(id))!==null){if(validChat(match[1],phone))return match[1];}
 return null;
}

export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo se permite la aplicación local'},{status:403});
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return NextResponse.json({error:'Se requiere JSON'},{status:415});
 const parsed=z.object({phone:z.string().regex(/^(?:[0-9]{5,40}|[0-9-]{5,50}@g\.us)$/),message:z.string().trim().min(1).max(3000),chatId:z.string().max(65).optional(),replyToId:z.number().int().positive().optional()}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Mensaje inválido'},{status:400});
 const {phone,message,chatId:chosenChat,replyToId}=parsed.data;
 const db=database();
 const quote=replyToId?db.prepare("SELECT wa_message_id FROM cases WHERE source='whatsapp' AND phone=? AND id=?").get(phone,replyToId) as {wa_message_id:string|null}|undefined:undefined;
 if(replyToId&&(!quote?.wa_message_id||quote.wa_message_id.startsWith('fallback-')))return NextResponse.json({error:'El mensaje original no tiene un identificador de WhatsApp para responderlo'},{status:409});
 if(chosenChat&&!validChat(chosenChat,phone))return NextResponse.json({error:'Identificador de contacto inválido'},{status:400});
 const rows=db.prepare("SELECT wa_chat_id,wa_message_id FROM cases WHERE source='whatsapp' AND phone=? ORDER BY received_at DESC,id DESC LIMIT 60").all(phone) as StoredMessage[];
 const profile=db.prepare('SELECT chat_id FROM contact_profiles WHERE phone=?').get(phone) as StoredChat|undefined;
 const storedChat=profile?.chat_id||rows.find(r=>validChat(r.wa_chat_id,phone))?.wa_chat_id||rows.map(r=>chatIdFromMessageId(r.wa_message_id,phone)).find(Boolean)||null;
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Conector sin configurar'},{status:503});
 try{
  const response=await fetch('http://127.0.0.1:3217/send',{
   method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},
   body:JSON.stringify({phone,chatId:validChat(chosenChat,phone)?chosenChat:(validChat(storedChat,phone)?storedChat:undefined),text:message,quotedMessageId:quote?.wa_message_id||undefined}),
   signal:AbortSignal.timeout(30000),cache:'no-store'
  });
  const result=await response.json().catch(()=>({error:'El conector no devolvió una respuesta válida'})) as {sent?:boolean;error?:string;id?:string|null};
  if(!response.ok)return NextResponse.json({error:result.error||`WhatsApp rechazó el envío (HTTP ${response.status})`},{status:response.status});
  if(result.sent!==true)return NextResponse.json({error:'WhatsApp no confirmó el envío. Revisá la conversación antes de reintentar.'},{status:502});
  return NextResponse.json({sent:true,id:result.id||null});
 }catch(error){
  const timeout=error instanceof Error && (error.name==='TimeoutError'||error.name==='AbortError');
  return NextResponse.json({error:timeout?'El envío tardó demasiado y su resultado es incierto. Revisá WhatsApp antes de volver a intentar.':'El conector de WhatsApp no responde en 127.0.0.1:3217. Revisá la terminal de npm run whatsapp.'},{status:timeout?504:503});
 }
}
