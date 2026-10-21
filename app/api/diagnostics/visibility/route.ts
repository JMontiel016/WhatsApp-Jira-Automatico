import {NextResponse} from 'next/server';
import {readConnectorStatus,connectorReady} from '@/lib/whatsapp-version';
import {database} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';

/** Solo conteos, jamás expone teléfonos, textos ni JIDs. No modifica SQLite. */
export async function GET(){
 const status=await readConnectorStatus();
 const ready=connectorReady(status);
 const d=database();
 const total=(d.prepare("SELECT COUNT(*) AS n FROM cases WHERE source='whatsapp'").get() as {n:number}).n;
 const unassigned=(d.prepare("SELECT COUNT(*) AS n FROM cases WHERE source='whatsapp' AND (account_id IS NULL OR account_id='')").get() as {n:number}).n;
 const visible=ready?(d.prepare("SELECT COUNT(*) AS n FROM cases WHERE source='whatsapp' AND account_id=?").get(status!.accountId) as {n:number}).n:0;
 const otherAccount=(d.prepare("SELECT COUNT(*) AS n FROM cases WHERE source='whatsapp' AND account_id<>'' AND account_id<>?").get(ready?status!.accountId:'') as {n:number}).n;
 const tickets=(d.prepare("SELECT COUNT(*) AS n FROM customer_jira_tickets").get() as {n:number}).n;
 const media=(d.prepare("SELECT COUNT(*) AS n FROM cases WHERE source='whatsapp' AND media_path IS NOT NULL AND media_path<>''").get() as {n:number}).n;
 const help=!ready?'El conector todavía no confirmó cuenta y autenticación.':
   visible>0?'Hay mensajes vinculados a esta cuenta. Si no aparecen en la interfaz, revisar filtros o caché.':
   unassigned>0?'Hay mensajes históricos sin cuenta. Asociarlos requiere confirmación expresa desde la pantalla de chats.':
   otherAccount>0?'Hay mensajes vinculados a otra identidad; no se mostrarán sin verificar que sea el mismo número.':
   'No hay mensajes WhatsApp en esta copia de SQLite. Si clonaste una instalación, comprobá el directorio de datos.';
 return NextResponse.json({connected:ready,totalMessages:total,visibleMessages:visible,unassignedMessages:unassigned,otherAccountMessages:otherAccount,totalTickets:tickets,mediaSaved:media,help}, {headers:{'Cache-Control':'no-store'}});
}
