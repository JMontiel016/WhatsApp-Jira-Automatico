import {NextRequest,NextResponse} from 'next/server';
import {constantEqual,signatureValid,cloudLiveAllowed} from '@/lib/cloud-security';
import {handleCloudMessage} from '@/lib/cloud-live';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(r:NextRequest){
 const q=r.nextUrl.searchParams;
 const expected=process.env.META_WEBHOOK_VERIFY_TOKEN||'';
 if(q.get('hub.mode')!=='subscribe'||expected.length<24||!constantEqual(q.get('hub.verify_token')||'',expected))return new Response('Forbidden',{status:403});
 return new Response(q.get('hub.challenge')||'',{status:200,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
}
export async function POST(r:NextRequest){
 const raw=await r.text();
 if(raw.length>1024*1024)return NextResponse.json({error:'Payload demasiado grande'},{status:413});
 if(!signatureValid(raw,r.headers.get('x-hub-signature-256')))return NextResponse.json({error:'Firma inválida'},{status:403});
 if(!cloudLiveAllowed())return NextResponse.json({error:'Cloud API no habilitada: confirmar coexistencia y enrutamiento'},{status:503});
 try{
  const doc=JSON.parse(raw) as {object?:string;entry?:Array<{changes?:Array<{field?:string;value?:{metadata?:{phone_number_id?:string};messages?:unknown[]}}>} >};
  if(doc.object!=='whatsapp_business_account')return NextResponse.json({ok:true,ignored:true});
  const id=process.env.META_WHATSAPP_PHONE_NUMBER_ID||'';
  for(const entry of (doc.entry||[]).slice(0,12))for(const change of (entry.changes||[]).slice(0,12)){
   // Nunca interpretar ecos enviados por personal humano como mensajes entrantes.
   if(change.field!=='messages'||change.value?.metadata?.phone_number_id!==id)continue;
   for(const message of (change.value?.messages||[]).slice(0,30))await handleCloudMessage(message);
  }
  return NextResponse.json({ok:true});
 }catch(e){
  console.error('[CLOUD API] Webhook sin procesar:',e instanceof Error?e.message:'Error');
  return NextResponse.json({error:'Error de procesamiento, Meta puede reintentar'},{status:500});
 }
}
