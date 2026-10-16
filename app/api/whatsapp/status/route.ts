import {NextResponse} from 'next/server';
import {WHATSAPP_CONNECTOR_VERSION} from '@/lib/whatsapp-version';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 try{
  const r=await fetch('http://127.0.0.1:3217/status',{cache:'no-store',signal:AbortSignal.timeout(2500)});
  if(!r.ok)return NextResponse.json({connected:false,service:false,compatible:false,error:'El conector no responde correctamente.'});
  const data=await r.json();
  const compatible=data.version===WHATSAPP_CONNECTOR_VERSION;
  return NextResponse.json({connected:data.connected===true&&compatible,service:true,compatible,
   version:typeof data.version==='string'?data.version:'anterior o desconocida',
   error:compatible?null:`Hay otra versión del conector en el puerto 3217 (${data.version||'sin identificar'}). Cerrá la terminal del conector anterior, reiniciá npm run whatsapp y volvé a cargar la página.`});
 }catch{return NextResponse.json({connected:false,service:false,compatible:false,error:'No se encontró el conector. Iniciá npm run whatsapp.'});}
}
