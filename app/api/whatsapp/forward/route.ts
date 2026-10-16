import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {z} from 'zod';
export const runtime='nodejs';
const PHONE=/^(?:[0-9]{5,40}|[0-9-]{5,50}@g\.us)$/;
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo uso local'},{status:403});
 const parsed=z.object({phone:z.string().regex(PHONE),id:z.number().int().positive(),targetPhone:z.string().regex(PHONE)}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Datos inválidos'},{status:400});
 const {phone,id,targetPhone}=parsed.data;
 if(phone===targetPhone)return NextResponse.json({error:'Seleccioná otro chat para reenviar'},{status:400});
 const db=database();
 const msg=db.prepare("SELECT wa_message_id FROM cases WHERE source='whatsapp' AND phone=? AND id=?").get(phone,id) as {wa_message_id:string|null}|undefined;
 if(!msg?.wa_message_id||msg.wa_message_id.startsWith('fallback-'))return NextResponse.json({error:'Este mensaje no se puede reenviar desde WhatsApp'},{status:409});
 const recipient=db.prepare("SELECT 1 AS ok FROM cases WHERE source='whatsapp' AND phone=? LIMIT 1").get(targetPhone);
 if(!recipient)return NextResponse.json({error:'Elegí una conversación ya registrada'},{status:404});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'El conector no está configurado'},{status:503});
 try{
  const res=await fetch('http://127.0.0.1:3217/forward',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify({phone,waMessageId:msg.wa_message_id,targetPhone}),signal:AbortSignal.timeout(30000),cache:'no-store'});
  const data=await res.json().catch(()=>({error:'Respuesta inválida del conector'})) as {sent?:boolean;error?:string};
  if(!res.ok||!data.sent)return NextResponse.json({error:data.error||'No se confirmó el reenvío'},{status:res.ok?502:res.status});
  return NextResponse.json({sent:true},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:'No se pudo confirmar el reenvío. Revisá WhatsApp antes de reintentar.'},{status:503});}
}
