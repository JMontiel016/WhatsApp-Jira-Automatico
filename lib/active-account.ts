import {connectorReady,readConnectorStatus} from './whatsapp-version';

/** Identidad VERIFICADA en el conector, nunca el último número guardado en SQLite. */
export async function linkedAccount():Promise<string|null>{
 const state=await readConnectorStatus();
 return connectorReady(state) ? state!.accountId! : null;
}
