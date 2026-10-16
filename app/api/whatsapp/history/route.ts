import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {NextRequest,NextResponse} from 'next/server';
import {rejectCrossOrigin} from '@/lib/security';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const parsed=z.object({phone:z.string().regex(/^(?:[0-9]{5,40}|[0-9-]{5,50}@g\.us)$/)}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Chat inválido'},{status:400});
 const check=await requireWhatsAppConnector();if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const token=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(token.length<24)return NextResponse.json({error:'Conector no configurado'},{status:503});
 try{
  const result=await fetch('http://127.0.0.1:3217/history',{
   method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':token},
   body:JSON.stringify(parsed.data),cache:'no-store',signal:AbortSignal.timeout(110000)
  });
  return NextResponse.json(await result.json(),{status:result.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'WhatsApp no respondió a la sincronización del historial'},{status:503});}
}
