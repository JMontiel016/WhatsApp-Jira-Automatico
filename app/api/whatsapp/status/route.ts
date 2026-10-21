import {NextResponse} from 'next/server';
import {
  WHATSAPP_CONNECTOR_VERSION,
  connectorReady,
  isConnectorVersionCompatible,
  readConnectorStatus
} from '@/lib/whatsapp-version';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  const d=await readConnectorStatus();
  if(!d){
    return NextResponse.json({
      connected:false,service:false,compatible:false,accountId:null,
      phase:'unavailable',version:null,expectedVersion:WHATSAPP_CONNECTOR_VERSION,
      error:'Conector no disponible. Iniciá npm run whatsapp desde el proyecto principal.'
    },{headers:{'Cache-Control':'no-store'}});
  }
  const compatible=isConnectorVersionCompatible(d.version);
  const connected=connectorReady(d);
  const phase=connected?'connected':!compatible?'incompatible':d.pairingPhase||'waiting';
  const error=!compatible
    ? `Versión incompatible: detectada ${String(d.version||'desconocida')}, requerida ${WHATSAPP_CONNECTOR_VERSION}.`
    : d.pairingError||null;
  return NextResponse.json({
    connected,service:true,compatible,accountId:connected?d.accountId:null,
    phase,version:d.version||null,expectedVersion:WHATSAPP_CONNECTOR_VERSION,
    compiledExpectedVersion:WHATSAPP_CONNECTOR_VERSION,
    startupSeconds:d.startupSeconds,historySync:d.historySync,
    qrAvailable:d.pairingQrAvailable===true,
    recoveryAvailable:d.recoveryAvailable===true,
    restartCount:d.restartCount||0,restartReason:d.restartReason||'',
    browserActive:d.browserActive===true,browserPageOpen:d.browserPageOpen===true,
    browserObservation:d.browserObservation||null,
    diagnostic:d.diagnostic||null,error
  },{headers:{'Cache-Control':'no-store'}});
}
