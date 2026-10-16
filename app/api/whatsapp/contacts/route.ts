import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {NextRequest,NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(r:NextRequest){
 const q=(r.nextUrl.searchParams.get('q')||'').trim();
 if(q.length>100)return NextResponse.json({error:'Búsqueda demasiado larga'},{status:400});
 const check=await requireWhatsAppConnector();if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const token=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(token.length<24)return NextResponse.json({error:'Conector sin configurar'},{status:503});
 try{const res=await fetch('http://127.0.0.1:3217/contacts?q='+encodeURIComponent(q),{headers:{'x-local-connector-secret':token},cache:'no-store',signal:AbortSignal.timeout(12000)});
 const data=await res.json();return NextResponse.json(data,{status:res.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'WhatsApp no está conectado o no responde'},{status:503});}
}
