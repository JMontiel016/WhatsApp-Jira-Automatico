import fs from 'node:fs';
import path from 'node:path';
import { database, type CaseRecord } from './db';
import { jiraCreate } from './jira';
import { syncTicketEvidence } from './jira-evidence';

// Flujo sin IA ni servicios externos. Los estados se guardan en SQLite.
// No se crean tickets por saludos ni por mensajes históricos.
type Step = 'choose'|'futura_ruc'|'futura_issue'|'talento_name'|'talento_ci'|'talento_email'|'talento_issue'|'ti_issue'|'other_name'|'other_email'|'other_issue'|'evidence'|'await_download'|'creating'|'done'|'review'|'cancelled';
type FormData = {system?:string;ruc?:string;name?:string;ci?:string;email?:string;otherSystem?:string;issue?:string};
type Session = {phone:string;step:Step;first_case_id:number;media_case_id:number|null;ticket_id:number|null;form_json:string;updated_at:string};
type Item = CaseRecord & {media_path?:string|null;media_name?:string|null;has_media?:number;media_error?:string|null;source?:string;direction?:string};
export type BotInput = {message:Item;isNew:boolean;outside:boolean;isGroup:boolean;outbound:boolean;hasMedia:boolean;mediaReady:boolean;receivedAt:string};
const menu = '¿Sobre qué necesitás soporte?\n\n1. Futura100\n2. Talento100\n3. Consulta TI\n4. Otro sistema\n\nRespondé con el número de la opción.';
const evidence = 'Gracias. Podés enviar ahora una imagen o documento del inconveniente. Si no tenés adjuntos, escribí LISTO para registrar el ticket.';
const norm = (s:string) => s.trim().replace(/\s+/g,' ');
const clean = (s:string) => norm(s).slice(0,500);
const emailValid = (s:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length<=160;
const isReady = (m:Item) => !!m.media_path && fs.existsSync(path.join(process.cwd(),'data','media',path.basename(m.media_path)));
function schema(){
 const d=database();
 d.exec('CREATE TABLE IF NOT EXISTS bot_sessions (phone TEXT PRIMARY KEY, step TEXT NOT NULL, first_case_id INTEGER NOT NULL, media_case_id INTEGER, ticket_id INTEGER, form_json TEXT NOT NULL DEFAULT \'{}\', updated_at TEXT NOT NULL)');
 d.exec('CREATE INDEX IF NOT EXISTS idx_bot_sessions_step ON bot_sessions(step)');
 return d;
}
function setting(name:string,defaultValue=''){return (schema().prepare('SELECT value FROM settings WHERE name=?').get(name) as {value:string}|undefined)?.value||defaultValue;}
function save(s:Session){schema().prepare('INSERT INTO bot_sessions(phone,step,first_case_id,media_case_id,ticket_id,form_json,updated_at) VALUES (@phone,@step,@first_case_id,@media_case_id,@ticket_id,@form_json,@updated_at) ON CONFLICT(phone) DO UPDATE SET step=excluded.step,first_case_id=excluded.first_case_id,media_case_id=excluded.media_case_id,ticket_id=excluded.ticket_id,form_json=excluded.form_json,updated_at=excluded.updated_at').run({...s,updated_at:new Date().toISOString()});}
function read(phone:string){return schema().prepare('SELECT * FROM bot_sessions WHERE phone=?').get(phone) as Session|undefined;}
function hello(iso:string) {
 const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'America/Asuncion'}).format(new Date(iso)));
 const greeting=hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches';
 return greeting+'. ¡Espero que estés bien! Te damos la bienvenida al soporte técnico. Estamos fuera del horario de atención, pero podemos registrar tu solicitud automáticamente.\n\n'+menu;
}
function fields(s:Session){try{return JSON.parse(s.form_json) as FormData;}catch{return {} as FormData;}}
function update(s:Session,step:Step,data:FormData){s.step=step;s.form_json=JSON.stringify(data);save(s);}
function messageRange(s:Session,until:number){return schema().prepare("SELECT * FROM cases WHERE phone=? AND source='whatsapp' AND direction='in' AND id>=? AND id<=? ORDER BY id").all(s.phone,s.first_case_id,until) as Item[];}
function safeName(s:Session,f:FormData,rows:Item[]) {
 const profile=schema().prepare('SELECT name FROM contact_profiles WHERE phone=?').get(s.phone) as {name?:string|null}|undefined;
 const contact=(profile?.name||rows[0]?.customer||'').trim();
 if(f.name)return f.name;
 if(contact&&!/^WhatsApp\s+\S+$/i.test(contact))return contact;
 if(f.ruc)return 'Empresa RUC '+f.ruc;
 return 'Cliente '+s.phone;
}
// Solo se confirma al cliente una clave real recibida desde Jira.
// Estado sending/review bloquea reintentos ante respuestas inciertas.
async function finalize(s:Session,until:number):Promise<string> {
 const d=schema();const f=fields(s);
 if(!f.system || !f.issue || ['creating','done','review'].includes(s.step))return 'Esta solicitud ya está en proceso de revisión.';
 if(process.env.ENABLE_REAL_JIRA!=='true')return 'Tu solicitud está completa, pero Jira todavía no está habilitado. Un operador deberá revisarla. No se generó un número de ticket.';
 const rows=messageRange(s,until);
 if(!rows.length)return 'No se encontraron los mensajes de la solicitud. Contactá a soporte.';
 const existing=d.prepare("SELECT id,status,jira_key FROM customer_jira_tickets WHERE phone=? AND status IN ('sending','review') ORDER BY id DESC LIMIT 1").get(s.phone) as {id:number;status:string;jira_key:string|null}|undefined;
 if(existing){update(s,'review',f);return 'La solicitud está pendiente de verificación en Jira. No se generará otro ticket para evitar duplicados.';}
 const client=safeName(s,f,rows);
 const title=(client+' - '+f.issue.replace(/[\r\n]+/g,' ')).slice(0,240);
 const details=['Sistema: '+f.system];
 if(f.otherSystem)details.push('Nombre del sistema: '+f.otherSystem);
 if(f.ruc)details.push('RUC: '+f.ruc);
 if(f.name)details.push('Nombre: '+f.name);
 if(f.ci)details.push('Cédula: '+f.ci);
 if(f.email)details.push('Correo: '+f.email);
 details.push('Inconveniente: '+f.issue,'','Mensajes y evidencias de WhatsApp:');
 for(const r of rows)details.push('['+r.local_date+' '+r.local_time+'] '+r.message);
 const missing=rows.filter(r=>r.has_media&&!isReady(r));
 if(missing.length)details.push('ADVERTENCIA: '+missing.length+' adjunto(s) siguen pendientes de descarga; comprobar evidencias antes de cerrar.');
 const assignment=setting('automation_assignee_id');
 const created=d.prepare("INSERT INTO customer_jira_tickets(phone,kind,parent_key,title,assignee_id,status) VALUES (?,'issue',NULL,?,?,'sending')").run(s.phone,title,assignment||null);
 s.ticket_id=Number(created.lastInsertRowid);update(s,'creating',f);
 try{
  const jira=await jiraCreate({...rows[0],customer:client,message:details.join('\n').slice(0,19000),source:'whatsapp'}, {title,customerName:client,system:f.system==='Consulta TI'?'Otros sistemas':f.system==='Otro sistema'?'Otros sistemas':f.system,assigneeId:assignment||undefined});
  d.transaction(()=>{
   d.prepare("UPDATE customer_jira_tickets SET status='created',jira_key=?,jira_id=? WHERE id=?").run(jira.key,jira.id,s.ticket_id);
   const insert=d.prepare('INSERT OR IGNORE INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)');
   rows.forEach(r=>insert.run(s.ticket_id,r.id));
  })();
  update(s,'done',f);
  const attachments=await syncTicketEvidence(jira.key,rows.map(r=>r.id)).catch(()=>({errors:['Sin confirmación de adjuntos'],uploaded:0}));
  const evidenceNotice=missing.length||attachments.errors.length?'\nAlgunas evidencias necesitan revisión por soporte.':'';
  return 'Tu solicitud fue registrada correctamente.\nTicket: *'+jira.key+'*\nSistema: '+f.system+'\nUn integrante de soporte la atenderá cuando esté disponible.'+evidenceNotice+'\n\nPara registrar otro inconveniente, escribí NUEVO.';
 }catch(error){
  d.prepare("UPDATE customer_jira_tickets SET status='review',error=? WHERE id=?").run((error instanceof Error?error.message:'Creación no confirmada').slice(0,500),s.ticket_id);
  update(s,'review',f);
  console.warn('[BOT] Jira no confirmado. Revisar ticket local #'+s.ticket_id);
  return 'Recibimos tu solicitud, pero no pudimos confirmar su número en Jira. Nuestro equipo debe verificarla antes de volver a intentar.';
 }
}
export async function runAutomation(v:BotInput):Promise<string|null>{
 // Iniciar el bot es opcional y nunca responde en grupos ni a mensajes salientes.
 if(setting('automation_enabled')!=='1'||v.isGroup||v.outbound)return null;
 const d=schema();const m=v.message;
 let session=read(m.phone);
 // Segunda entrega del MISMO evento con la descarga terminada.
 if(!v.isNew){
  if(session?.step==='await_download'&&session.media_case_id===m.id&&v.mediaReady){
   return finalize(session,m.id);
  }
  if(session?.step==='done'&&session.ticket_id&&v.mediaReady){
   const ticket=d.prepare("SELECT jira_key FROM customer_jira_tickets WHERE id=? AND status='created'").get(session.ticket_id) as {jira_key:string}|undefined;
   if(ticket){d.prepare('INSERT OR IGNORE INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)').run(session.ticket_id,m.id);await syncTicketEvidence(ticket.jira_key,[m.id]).catch(()=>{});}
  }
  return null;
 }
 // Rechaza eventos anteriores al arranque: abrir historial nunca debe disparar el bot.
 if(Math.abs(Date.now()-Date.parse(v.receivedAt))>120000)return null;
 const input=norm(m.message);const cmd=input.toUpperCase();
 if(session?.step==='done'&&v.hasMedia&&session.ticket_id){
  const ticket=d.prepare("SELECT jira_key FROM customer_jira_tickets WHERE id=? AND status='created'").get(session.ticket_id) as {jira_key:string}|undefined;
  if(ticket){d.prepare('INSERT OR IGNORE INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)').run(session.ticket_id,m.id);if(v.mediaReady)await syncTicketEvidence(ticket.jira_key,[m.id]).catch(()=>{});}
  return null;
 }
 if(session?.step==='done'&&cmd!=='NUEVO')return null;
 if(session?.step==='review'||session?.step==='creating')return null;
 if(cmd==='CANCELAR'&&session){update(session,'cancelled',fields(session));return 'Solicitud cancelada. Si necesitás iniciar otra, escribí NUEVO.';}
 if(!v.outside && (!session||session.step==='cancelled'||session.step==='done'))return null;
 const last=session?Date.parse(session.updated_at):0;
 const expired=!!session && Date.now()-last>24*60*60*1000;
 if(!session||expired||['done','cancelled'].includes(session.step)||cmd==='NUEVO'){
  if(!v.outside)return null;
  session={phone:m.phone,step:'choose',first_case_id:m.id,media_case_id:null,ticket_id:null,form_json:'{}',updated_at:new Date().toISOString()};
  save(session);return hello(v.receivedAt);
 }
 if(!v.outside)return null;
 if(cmd==='MENU'){update(session,'choose',{});return menu;}
 const f=fields(session);
 switch(session.step){
  case 'choose': {
   if(!['1','2','3','4'].includes(input))return 'Seleccioná una opción válida (1, 2, 3 o 4).\n\n'+menu;
   f.system=({'1':'Futura100','2':'Talento100','3':'Consulta TI','4':'Otro sistema'} as Record<string,string>)[input];
   const next:Record<string,Step>={'1':'futura_ruc','2':'talento_name','3':'ti_issue','4':'other_name'};
   update(session,next[input],f);
   return ({'1':'Indicá el RUC de la empresa (con dígito verificador).','2':'Indicá tu nombre y apellido.','3':'Describí el inconveniente o consulta de TI con el mayor detalle posible.','4':'¿Cuál es el nombre del otro sistema?'} as Record<string,string>)[input];
  }
  case 'futura_ruc':
   if(!/^[0-9]{4,12}(-[0-9])?$/.test(input))return 'Indicá un RUC válido (solo números y, si corresponde, guion y dígito verificador).';
   f.ruc=input;update(session,'futura_issue',f);return 'Describí el inconveniente que presenta Futura100.';
  case 'talento_name':
   if(input.length<3||input.length>120)return 'Ingresá tu nombre y apellido.';
   f.name=clean(input);update(session,'talento_ci',f);return 'Indicá tu número de cédula.';
  case 'talento_ci':
   if(!/^[0-9.]{4,20}$/.test(input))return 'Ingresá el número de cédula (solo números, con puntos opcionales).';
   f.ci=input;update(session,'talento_email',f);return 'Indicá tu correo electrónico.';
  case 'talento_email':
   if(!emailValid(input))return 'El correo no parece válido. Probá nuevamente, por ejemplo: usuario@empresa.com';
   f.email=input;update(session,'talento_issue',f);return 'Contanos qué inconveniente presenta Talento100.';
  case 'other_name':
   if(input.length<2||input.length>120)return 'Escribí el nombre del sistema.';
   f.otherSystem=clean(input);update(session,'other_email',f);return 'Indicá tu correo electrónico.';
  case 'other_email':
   if(!emailValid(input))return 'Ingresá un correo electrónico válido.';
   f.email=input;update(session,'other_issue',f);return 'Describí el inconveniente que presenta '+f.otherSystem+'.';
  case 'futura_issue':case 'talento_issue':case 'ti_issue':case 'other_issue':
   if(v.hasMedia)return 'Primero describí el inconveniente por escrito. Luego podrás enviar una imagen.';
   if(input.length<8)return 'Describí el inconveniente con al menos 8 caracteres.';
   f.issue=clean(input);update(session,'evidence',f);
   return (f.system==='Consulta TI'?'Vamos a derivar tu consulta al equipo de soporte TI.\n':'')+evidence;
  case 'evidence':
   if(v.hasMedia){session.media_case_id=m.id;update(session,'await_download',f);if(v.mediaReady)return finalize(session,m.id);return 'Recibimos tu archivo. Estamos esperando que WhatsApp permita guardarlo para adjuntarlo al ticket.';}
   if(['LISTO','SIN IMAGEN','NO','OMITIR'].includes(cmd))return finalize(session,m.id);
   return 'Enviá una imagen o documento, o escribí LISTO si no necesitás adjuntar uno.';
  case 'await_download':
   if(['LISTO','SIN IMAGEN','OMITIR'].includes(cmd))return finalize(session,m.id);
   return 'La imagen sigue pendiente de descarga. Podés esperar o escribir LISTO para registrar el ticket sin ese adjunto.';
  default:return null;
 }
}
