import {controlDb,listStaff,setting,type SupportRole} from './automation-controls';
const {messageForSupport}=require('./support-personalization.cjs') as {messageForSupport:(template:string,key:string,link:string,role:string)=>string};

/** Un aviso es exclusivamente la URL de Jira: sin nombres, texto de ticket ni datos sensibles. */
export async function notifyRole(ticketId:number,key:string,role:SupportRole,accountId:string){
 if(!/^[A-Z][A-Z0-9]+-\d+$/.test(key))throw Error('Ticket inválido');
 const base=(process.env.JIRA_BASE_URL||'').replace(/\/$/,'');
 if(!/^https:\/\/[^\/\s]+$/.test(base))throw Error('URL de Jira no configurada');
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 const d=controlDb();let sent=0,skipped=0,uncertain=0;
 for(const person of listStaff(accountId,role).filter(p=>p.active)){
  if(!person.notify){skipped++;continue;}
  const link=base+'/browse/'+key;
  const locked=d.prepare(`INSERT OR IGNORE INTO automation_ticket_link_delivery(ticket_id,staff_id,role,link,state) VALUES(?,?,?,?,'sending')`).run(ticketId,person.id,role,link);
  if(!locked.changes)continue;
  if(secret.length<24){d.prepare("UPDATE automation_ticket_link_delivery SET state='review',error='Conector sin configurar' WHERE ticket_id=? AND staff_id=? AND role=?").run(ticketId,person.id,role);uncertain++;continue;}
  try{
   const response=await fetch('http://127.0.0.1:3217/send',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify(setting('automation_notice_'+role)?{phone:person.phone,text:messageForSupport(setting('automation_notice_'+role),key,link,role)}:{phone:person.phone,text:link}),signal:AbortSignal.timeout(19000),cache:'no-store'});
   const payload=await response.json().catch(()=>({})) as {sent?:boolean;id?:string;error?:string};
   if(!response.ok||!payload.sent||!payload.id)throw Error(payload.error||'Envío sin confirmación');
   d.prepare("UPDATE automation_ticket_link_delivery SET state='sent',wa_message_id=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND staff_id=? AND role=?").run(payload.id,ticketId,person.id,role);sent++;
  }catch(e){d.prepare("UPDATE automation_ticket_link_delivery SET state='review',error=?,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND staff_id=? AND role=?").run((e instanceof Error?e.message:'Error').slice(0,200),ticketId,person.id,role);uncertain++;}
 }
 return {sent,skipped,uncertain};
}
export function ticketHistory(){const d=controlDb();return {notifications:d.prepare('SELECT * FROM automation_ticket_link_delivery ORDER BY updated_at DESC LIMIT 80').all(),stages:d.prepare('SELECT * FROM automation_ticket_stage ORDER BY updated_at DESC LIMIT 80').all()};}

/** Confirma únicamente mensajes recibidos desde un N2 registrado y activo. */
export function confirmSupportTicket(account:string,phone:string,message:string){
 const match=/^\s*CONFIRMO\s+([A-Z][A-Z0-9]+-\d+)\s*$/i.exec(message);
 if(!match)return null;
 const d=controlDb();
 const person=d.prepare("SELECT id FROM automation_support_staff WHERE account_id=? AND phone=? AND role='level2' AND active=1").get(account,phone) as {id:number}|undefined;
 if(!person)return null;
 const key=match[1].toUpperCase();
 const record=d.prepare("SELECT t.id FROM customer_jira_tickets t JOIN automation_ticket_stage s ON s.ticket_id=t.id JOIN customer_ticket_messages m ON m.ticket_id=t.id JOIN cases c ON c.id=m.message_id WHERE t.jira_key=? AND s.role='level2' AND s.progress='pending' AND c.account_id=? LIMIT 1").get(key,account) as {id:number}|undefined;
 if(!record)return null;
 d.prepare('INSERT OR IGNORE INTO automation_ticket_ack(ticket_id,staff_id) VALUES(?,?)').run(record.id,person.id); // La confirmación interna detiene la alerta; solo Jira define En curso.
 d.prepare("UPDATE automation_call_requests SET state='cancelled',reason='Nivel 2 confirmó por WhatsApp',updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='pending_integration'").run(record.id);
 return key;
}
