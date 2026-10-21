import {NextRequest,NextResponse} from 'next/server';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
// Endpoint local autenticado al conector; no se publican secretos de WhatsApp.
export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'No se configuró el secreto local'},{status:503});
 try{
  const r=await fetch('http://127.0.0.1:3217/regenerate-qr',{method:'POST',headers:{'x-local-connector-secret':secret},signal:AbortSignal.timeout(6000),cache:'no-store'});
  const result=await r.json().catch(()=>({error:'Respuesta del conector inválida'}));
  return NextResponse.json(result,{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'El conector no responde. Iniciá npm run whatsapp desde la carpeta TicketWhatsapp.'},{status:503});}
}
