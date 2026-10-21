import {NextRequest,NextResponse} from 'next/server';
import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const ready=await requireWhatsAppConnector();if(!ready.ok)return NextResponse.json({error:ready.error},{status:ready.status});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Conector sin configurar'},{status:503});
 try{
  const r=await fetch('http://127.0.0.1:3217/sync-today',{method:'POST',headers:{'x-local-connector-secret':secret},signal:AbortSignal.timeout(3500),cache:'no-store'});
  return NextResponse.json(await r.json(),{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'No se pudo iniciar sincronización de hoy'},{status:503});}
}
