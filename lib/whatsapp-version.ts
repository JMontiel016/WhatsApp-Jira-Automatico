// El servidor Next debe hablar con la MISMA versión del conector local.
// Un node antiguo sigue escuchando en :3217 después de copiar los archivos,
// lo que generaba 404 para /history y /chat-state.
export const WHATSAPP_CONNECTOR_VERSION = 'ticketbridge-sync-v6.4';
export async function requireWhatsAppConnector():Promise<{ok:true}|{ok:false;status:number;error:string}> {
 try {
  const r=await fetch('http://127.0.0.1:3217/status',{cache:'no-store',signal:AbortSignal.timeout(2500)});
  if(!r.ok)return {ok:false,status:503,error:'No se pudo consultar el estado del conector WhatsApp.'};
  const info=await r.json() as {version?:string;ready?:boolean;connected?:boolean;capabilities?:string[]};
  if(info.version!==WHATSAPP_CONNECTOR_VERSION)
   return {ok:false,status:503,error:`El conector de WhatsApp en el puerto 3217 es una versión anterior (${info.version||'sin identificar'}). Detené la instancia anterior y reiniciá npm run whatsapp desde el proyecto actualizado.`};
  if(!info.ready||!info.connected)
   return {ok:false,status:503,error:'El conector está actualizado, pero WhatsApp todavía no está conectado. Esperá al mensaje de conexión.'};
  return {ok:true};
 }catch{
  return {ok:false,status:503,error:'El conector WhatsApp no responde en 127.0.0.1:3217. Ejecutá npm run whatsapp en otra terminal.'};
 }
}
