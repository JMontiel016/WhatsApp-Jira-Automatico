import {controlDb,enabled,listStaff,setting} from './automation-controls';
import {jiraDetails} from './jira';
/** WhatsApp Web NO ofrece una API para iniciar llamadas desde el número de la empresa.
 * WhatsApp Business Calling API exige WABA/Cloud API, consentimiento del usuario,
 * habilitación regional y transporte de voz (WebRTC/SIP). No usar Twilio como origen
 * alternativo sin autorización: este módulo genera alertas; no marca teléfonos. */
export const configuredTelephony=()=>false;
export function callsDb(){return controlDb();}
export function callOverview(){return controlDb().prepare('SELECT r.*,t.jira_key,s.name,s.phone FROM automation_call_requests r JOIN customer_jira_tickets t ON t.id=r.ticket_id LEFT JOIN automation_support_staff s ON s.id=r.staff_id ORDER BY r.created_at DESC LIMIT 100').all();}
const pyHour=(date:Date)=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Asuncion'}).format(date);
export async function processDueCalls():Promise<{called:number;pending:number;errors:string[]}> {
 const out={called:0,pending:0,errors:[] as string[]};
 // No marcamos nunca sin integración oficial real validada. La alerta funciona igual.
 const d=controlDb();
 if(!enabled('automation_enabled'))return out;
 const rows=d.prepare(`SELECT st.ticket_id,st.updated_at,st.progress,t.jira_key,c.account_id
 FROM automation_ticket_stage st JOIN customer_jira_tickets t ON t.id=st.ticket_id
 LEFT JOIN cases c ON c.id=(SELECT min(m.message_id) FROM customer_ticket_messages m WHERE m.ticket_id=st.ticket_id)
 WHERE st.role='level2' AND st.progress='pending' AND t.status='created' AND t.jira_key IS NOT NULL
 GROUP BY st.ticket_id ORDER BY st.updated_at LIMIT 50`).all() as Array<{ticket_id:number;updated_at:string;progress:string;jira_key:string;account_id:string|null}>;
 for(const ticket of rows){
  if(d.prepare('SELECT 1 FROM automation_ticket_ack WHERE ticket_id=?').get(ticket.ticket_id))continue;
  const team=listStaff(ticket.account_id||'','level2').filter(s=>s.active&&s.followup);
  for(const person of team){
   const minutes=person.minutes??Number(setting('automation_level2_minutes','30'));
   const due=Date.parse(ticket.updated_at.replace(' ','T')+(ticket.updated_at.includes('Z')?'':'Z'))+Math.max(5,minutes)*60000;
   if(!Number.isFinite(due)||Date.now()<due)continue;
   const start=setting('automation_call_start','08:00'),end=setting('automation_call_end','18:00');
   const hh=pyHour(new Date());if(hh<start||hh>=end){out.pending++;continue;}
   let remote;
   try{remote=await jiraDetails(ticket.jira_key);}catch(e){out.errors.push(ticket.jira_key+': no se pudo verificar Jira; se omite llamada');continue;}
   if(['indeterminate','done'].includes(remote.statusCategory.toLowerCase())){
    d.prepare("UPDATE automation_ticket_stage SET progress=?,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND progress='pending'").run(remote.statusCategory==='done'?'finished':'in_progress',ticket.ticket_id);
    d.prepare("UPDATE automation_call_requests SET state='cancelled',reason='Jira ya está En curso o Finalizado',updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='pending_integration'").run(ticket.ticket_id);
    continue;
   }
   const again=d.prepare("SELECT progress FROM automation_ticket_stage WHERE ticket_id=? AND role='level2'").get(ticket.ticket_id) as {progress:string}|undefined;
   if(again?.progress!=='pending')continue;
   const voice=setting('automation_call_voice','Hola, le estamos contactando de Soporte TI. Tiene un ticket pendiente de atención, número {ticket}. Por favor, revise el caso y actualice su estado a En curso. Muchas gracias.').replaceAll('{ticket}',ticket.jira_key);
   const wantsCall=enabled('automation_auto_call_enabled')&&person.call_enabled===1;
   const requested=d.prepare("INSERT OR IGNORE INTO automation_call_requests(ticket_id,staff_id,state,reason,voice_text) VALUES (?,?,?,?,?)").run(ticket.ticket_id,person.id,wantsCall?'pending_integration':'alert_only',wantsCall?'Pendiente de proveedor de WhatsApp Business Calling':'Solo alerta interna: llamadas desactivadas',voice);
   if(requested.changes)out.pending++;
  }
 }
 return out;
}
