import {NextRequest,NextResponse} from 'next/server';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
// Solo usuario local y confirmación explícita. El token no se entrega al navegador.
export async function POST(request:NextRequest){
 const rejected=rejectCrossOrigin(request);if(rejected)return rejected;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const data=await request.json().catch(()=>null);
 if(data?.confirm!=='DESCONECTAR')return NextResponse.json({error:'Confirmación requerida'},{status:400});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Conector no configurado'},{status:503});
 try{
  const r=await fetch('http://127.0.0.1:3217/logout',{method:'POST',headers:{'x-local-connector-secret':secret,'Content-Type':'application/json'},body:JSON.stringify({confirm:'DESCONECTAR'}),signal:AbortSignal.timeout(18000),cache:'no-store'});
  const result=await r.json().catch(()=>({error:'El conector devolvió una respuesta inválida'}));
  return NextResponse.json(result,{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'No se pudo confirmar la desvinculación. Revisá la terminal de WhatsApp.'},{status:503});}
}
