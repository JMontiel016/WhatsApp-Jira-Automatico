/**
 * Versión y estado de WhatsApp: una sola fuente para TODAS las rutas Next.js.
 * El panel, los tickets y la agenda nunca deben discrepar sobre el mismo /status.
 */
export const WHATSAPP_CONNECTOR_VERSION = 'ticketbridge-sync-v6.7-sync';

export type ConnectorStatus = {
  service?:string;
  version?:string;
  connected?:boolean;
  ready?:boolean;
  accountId?:string|null;
  pairingPhase?:string;
  pairingError?:string|null;
  startupSeconds?:number;
  historySync?:string;
  pairingQrAvailable?:boolean;
  browserActive?:boolean;
  browserPageOpen?:boolean;
  browserObservation?:string;
  diagnostic?:string|null;
  recoveryAvailable?:boolean;
  restartCount?:number;
  restartReason?:string;
};

export function isConnectorVersionCompatible(value:unknown):boolean {
  // Los procesos antiguos pueden enviar espacios al final, pero no se permiten
  // versiones diferentes. No inventar compatibilidad con una instancia vieja.
  return typeof value === 'string' && value.trim() === WHATSAPP_CONNECTOR_VERSION;
}

export function validConnectedAccount(value:unknown):value is string {
  return typeof value === 'string' && /^\d{5,40}@(c\.us|lid)$/.test(value);
}

export async function readConnectorStatus(timeoutMs=4500):Promise<ConnectorStatus|null> {
  try {
    const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
    const result=await fetch('http://127.0.0.1:3217/status',{
      headers:{'x-local-connector-secret':secret},
      cache:'no-store',
      signal:AbortSignal.timeout(timeoutMs)
    });
    if(!result.ok)return null;
    const status:unknown=await result.json();
    if(!status || typeof status!=='object' || Array.isArray(status))return null;
    return status as ConnectorStatus;
  }catch{return null;}
}

export function connectorReady(status:ConnectorStatus|null):boolean {
  return Boolean(status && isConnectorVersionCompatible(status.version)
    && status.ready===true && status.connected===true
    && validConnectedAccount(status.accountId));
}

export async function requireWhatsAppConnector():Promise<
  {ok:true}|{ok:false;status:number;error:string}
> {
  const info=await readConnectorStatus();
  if(!info)return {ok:false,status:503,error:'El conector WhatsApp no responde en 127.0.0.1:3217. Iniciá npm run whatsapp.'};
  if(!isConnectorVersionCompatible(info.version))return {ok:false,status:503,
    error:`Versión de conector diferente: detectada ${String(info.version||'desconocida')}, requerida ${WHATSAPP_CONNECTOR_VERSION}.`};
  if(!info.connected||!info.ready)return {ok:false,status:503,
    error:'El conector funciona, pero WhatsApp aún no terminó de autenticarse.'};
  if(!validConnectedAccount(info.accountId))return {ok:false,status:503,
    error:'WhatsApp está listo, pero el identificador de cuenta no es válido. No se mostrarán conversaciones de otra cuenta.'};
  return {ok:true};
}
