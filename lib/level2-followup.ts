import {database} from './db';
function level2Message(template:string,key:string,link:string){
 const body=template.trim().replace(/\{ticket\}/gi,key).replace(/\{nivel\}/gi,'N2').replace(/\{link\}/gi,link);
 return body ? (body.includes(link)?body:body+'\n'+link) : link;
}

/** Entregas persistentes. Nunca duplicar un enlace si el resultado del envío es incierto. */
export function followupDb(){
 const d=database();
 d.exec(`CREATE TABLE IF NOT EXISTS level2_followups (
  ticket_id INTEGER PRIMARY KEY, jira_key TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL, link TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','review','confirmed')),
  error TEXT, created_at TEXT NOT NULL, due_at TEXT NOT NULL,
  sent_at TEXT, confirmed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );CREATE INDEX IF NOT EXISTS idx_level2_followup_alert ON level2_followups(state,due_at);`);
 return d;
}
function supportPhone(){
 const v=(followupDb().prepare("SELECT value FROM settings WHERE name='automation_level2_phone'").get() as {value:string}|undefined)?.value||'';
 return v.replace(/\D/g,'');
}
export async function recordLevel2Ticket(ticketId:number,key:string){
 if(!/^CW-\d+$/.test(key))throw Error('Clave de ticket inválida');
 const phone=supportPhone();
 // Registrar siempre el plazo, incluso cuando no se configuró teléfono de Nivel 2.
 const hasPhone=/^\d{10,16}$/.test(phone);
 const base=(process.env.JIRA_BASE_URL||'').replace(/\/$/,'');
 if(!/^https:\/\/[^/\s]+$/.test(base))throw Error('No se configuró la URL segura de Jira');
 const configured=(followupDb().prepare("SELECT value FROM settings WHERE name='automation_level2_minutes'").get() as {value:string}|undefined)?.value||'30';
 const minutes=Math.max(5,Math.min(720,parseInt(configured,10)||30));
 const now=new Date();const due=new Date(now.getTime()+minutes*60*1000).toISOString();
 const db=followupDb(),link=base+'/browse/'+key;
 db.prepare("INSERT OR IGNORE INTO level2_followups(ticket_id,jira_key,phone,link,state,created_at,due_at) VALUES (?,?,?,?,'pending',?,?)")
  .run(ticketId,key,phone,link,now.toISOString(),due);
 if(hasPhone)await sendLevel2Link(ticketId);
 else db.prepare("UPDATE level2_followups SET state='review',error='Teléfono Nivel 2 no configurado' WHERE ticket_id=?").run(ticketId);
}
export async function sendLevel2Link(ticketId:number){
 const d=followupDb();
 const row=d.prepare('SELECT * FROM level2_followups WHERE ticket_id=?').get(ticketId) as {phone:string;link:string;state:string;jira_key:string}|undefined;
 if(!row||row.state!=='pending')return {sent:false,reason:'Aviso no pendiente'};
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return {sent:false,reason:'Conector sin configurar'};
 // Transición atómica previo al HTTP POST. Ante un timeout NO reenviamos sin verificar.
 const lock=d.prepare("UPDATE level2_followups SET state='sending',updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='pending'").run(ticketId);
 if(!lock.changes)return {sent:false,reason:'Aviso ya en proceso'};
 try{
  const response=await fetch('http://127.0.0.1:3217/send',{method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},body:JSON.stringify({phone:row.phone,text:level2Message((d.prepare("SELECT value FROM settings WHERE name='automation_notice_level2'").get() as {value:string}|undefined)?.value||'',row.jira_key,row.link)}),signal:AbortSignal.timeout(22000),cache:'no-store'});
  const result=await response.json().catch(()=>({error:'Respuesta inválida'})) as {sent?:boolean;id?:string;error?:string};
  if(!response.ok||!result.sent||!result.id)throw Error(result.error||'WhatsApp no confirmó el envío');
  d.prepare("UPDATE level2_followups SET state='sent',sent_at=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='sending'").run(new Date().toISOString(),ticketId);
  return {sent:true};
 }catch(error){
  const reason=(error instanceof Error?error.message:'Sin confirmación de WhatsApp').slice(0,350);
  d.prepare("UPDATE level2_followups SET state='review',error=?,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='sending'").run(reason,ticketId);
  console.warn('[NIVEL2] Aviso sin confirmación de entrega; revisar antes de reintentar:',ticketId,reason);
  return {sent:false,reason};
 }
}
/** Solo aceptamos respuesta REAL del teléfono configurado para Nivel 2. */
export function confirmFromLevel2(phone:string,accountId:string,message:string){
 if(phone!==supportPhone()||!accountId)return false;
 const m=/^\s*CONFIRMO\s+(CW-\d+)\s*$/i.exec(message);
 if(!m)return false;
 const db=followupDb();
 const ack=db.prepare("UPDATE level2_followups SET state='confirmed',confirmed_at=?,updated_at=CURRENT_TIMESTAMP,error=NULL WHERE jira_key=? AND phone=? AND state IN ('sent','review','pending')").run(new Date().toISOString(),m[1].toUpperCase(),phone);
 return ack.changes>0;
}
export function followupOverview(){
 return followupDb().prepare(`SELECT jira_key,phone,state,error,created_at,due_at,confirmed_at,
  CASE WHEN state IN ('pending','sending','sent','review') AND due_at<=? THEN 1 ELSE 0 END overdue
  FROM level2_followups ORDER BY created_at DESC LIMIT 100`).all(new Date().toISOString());
}
