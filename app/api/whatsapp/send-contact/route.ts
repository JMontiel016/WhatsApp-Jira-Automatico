import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export async function POST(r:NextRequest){
 const denied=rejectCrossOrigin(r);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(r.headers.get('host')||''))return NextResponse.json({error:'Solo en aplicación local'},{status:403});
 const data=z.object({phone:z.string().regex(/^(?:\d{5,40}|[0-9-]{5,50}@g\.us)$/),contactPhone:z.string().regex(/^\d{5,40}$/),chatId:z.string().max(65).optional()}).safeParse(await r.json().catch(()=>null));
 if(!data.success)return NextResponse.json({error:'Contacto inválido'},{status:400});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Conector sin configurar'},{status:503});
 try{
  const res=await fetch('http://127.0.0.1:3217/send-contact',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify(data.data),signal:AbortSignal.timeout(30000),cache:'no-store'});
  const json=await res.json().catch(()=>({error:'Respuesta inválida del conector'}));
  return NextResponse.json(json,{status:res.status});
 }catch{return NextResponse.json({error:'No se pudo confirmar el envío. Revisá WhatsApp antes de reintentar.'},{status:503});}
}
