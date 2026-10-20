import {notifySupportRoster} from '@/lib/support-roster-notify';
import fs from 'node:fs';
import path from 'node:path';
import { database, type CaseRecord } from './db';
import { jiraCreate } from './jira';
import { syncTicketEvidence } from './jira-evidence';

import { AUTOMATION_TEXT_DEFAULTS, AUTOMATION_SYSTEM_OPTIONS, AUTOMATION_OPTIONAL_QUESTIONS, type AutomationTextKey } from './automation-text';
import { TEAM_ROLES, type TeamRole } from './jira-team';
import {scheduleAllowed,contactAllowed,isStaffPhone,controlDb,hasRecentManualOutreach} from './automation-controls';
import {notifyRole} from './automation-routing';
// Sin nuevas dependencias en el motor: compatible con los simuladores aislados existentes.
const personal={
 OPTIONAL_QUESTIONS:AUTOMATION_OPTIONAL_QUESTIONS,
 QUESTION_TO_STEP:{ruc:'ruc',talentName:'talent_name',talentId:'talent_id',talentEmail:'talent_email',otherSystem:'other_system',otherEmail:'other_email'} as Record<string,string>,
 nextDetailedStep(system:string,current:Step|''):Step[]{
  const options:Record<string,Step[]>={
   Futura100:['ruc','issue'],Talento100:['talent_name','talent_id','talent_email','issue'],
   'Consulta TI':['issue'],'Otro sistema':['other_system','other_email','issue']
  };
  const seq=options[system]||['issue'];
  return seq.slice(current?Math.max(0,seq.indexOf(current)+1):0);
 }
};
import {parseExtraFields,type ExtraField} from './automation-extra-fields';
// Helpers sin dependencias para selección de sistemas y modo rápido.
const flow = require('./automation-flow.cjs') as {
 SYSTEMS:string[]; availableSystems:(v:string)=>string[]; parseSelection:(v:string,a:string[],multi:boolean)=>string[]|null;
 firstRequest:(v:string,a:string[],multi:boolean)=>{systems:string[];issue:string}|null;
 keyword:(v:string)=>boolean; menuText:(a:string[],multi:boolean)=>string;
};

// Máquina de estados persistente: no necesita IA, API externa ni tareas en la nube.
type Step = 'extra'|'details'|'choose'|'company'|'ruc'|'talent_name'|'talent_id'|'talent_email'|'other_system'|'other_email'|'issue'|'evidence'|'waiting_media'|'confirm'|'correct_choose'|'correct_value'|'creating'|'done'|'review'|'cancelled';
type Data = { system?: string; company?: string; ruc?: string; name?: string; nationalId?: string; email?: string; otherSystem?: string; issue?: string; extra?:Record<string,string> };
type Session = { phone: string; account_id: string; step: Step; first_case_id: number; media_case_id: number|null; ticket_id: number|null; data_json: string; updated_at: string; correction_field?:string; parent_key?:string|null; kind?:string; texts_json?:string; fields_json?:string; policy_json?:string };
type Msg = CaseRecord & { account_id?:string; media_path?: string|null; media_type?: string|null; media_name?: string|null; media_error?: string|null; has_media?: number; direction?: string; source?: string };
export type AutomationEvent = { message: Msg; isNew: boolean; outside: boolean; isGroup: boolean; outbound: boolean; hasMedia: boolean; mediaReady: boolean; receivedAt: string };
// Mensajes configurados por el equipo en el panel de ajustes.
function say(key:AutomationTextKey,session?:Session){if(session?.texts_json){try{const saved=JSON.parse(session.texts_json) as Record<string,string>;if(saved[key])return saved[key];}catch{}}return config('automation_text_'+key,AUTOMATION_TEXT_DEFAULTS[key]);}
type FlowPolicy={startMode:'first'|'keyword';shortForm:boolean;confirmation:boolean;multipleSystems:boolean;humanPause:boolean;systems:string[];questionEnabled?:Record<string,boolean>;contactTreatment?:string};
const LEGACY_POLICY:FlowPolicy={startMode:'first',shortForm:false,confirmation:true,multipleSystems:false,humanPause:true,systems:flow.SYSTEMS};
function readFlowPolicy(account:string,phone:string):FlowPolicy{
 let membership:{is_saved:number;checked_at:string}|undefined;
 try{membership=db().prepare('SELECT is_saved,checked_at FROM automation_saved_contacts WHERE account_id=? AND phone=?').get(account,phone) as {is_saved:number;checked_at:string}|undefined;}catch{/* Bases anteriores o pruebas aisladas: no suponer que está guardado. */}
 const recent=membership && Number.isFinite(Date.parse(membership.checked_at+'Z')) && Date.now()-Date.parse(membership.checked_at+'Z')<30*86400000;
 const saved=recent ? membership!.is_saved===1 : null;
 const base:FlowPolicy={
 startMode:config('automation_flow_start','first')==='keyword'?'keyword':'first',
 shortForm:config('automation_flow_short','0')==='1',
 confirmation:config('automation_flow_confirm','1')!=='0',
 multipleSystems:config('automation_flow_multi','0')==='1',
 humanPause:config('automation_flow_human','1')!=='0',
 systems:flow.availableSystems(config('automation_flow_systems',JSON.stringify(flow.SYSTEMS))),
 questionEnabled:Object.fromEntries(personal.OPTIONAL_QUESTIONS.map(k=>[k,config('automation_prompt_enabled_'+k,'1')!=='0']))
 };
 if(saved===true&&config('automation_saved_contact_mode','inherit')==='short'){
   return {...base,shortForm:true,confirmation:config('automation_saved_contact_confirm','1')!=='0',contactTreatment:'saved_short'};
 }
 return {...base,contactTreatment:saved===true?'saved_general':saved===false?'not_saved':'unknown'};
}
// Cada solicitud conserva sus propias reglas aunque el operador edite ajustes después.
function policy(s?:Session):FlowPolicy{
 if(s?.policy_json){try{return {...LEGACY_POLICY,...JSON.parse(s.policy_json)} as FlowPolicy;}catch{}}
 return LEGACY_POLICY;
}
function isQuestionEnabled(s:Session|undefined,key:string){return policy(s).questionEnabled?.[key]!==false;}
function menu(session?:Session){
 const configured=say('menu',session);
 const prompt=/encuesta|votos?/i.test(configured)?AUTOMATION_TEXT_DEFAULTS.menu:configured;
 const p=policy(session);return prompt+'\n\n'+flow.menuText(p.systems,p.shortForm&&p.multipleSystems);
}
const normalize=(v:string)=>v.trim().replace(/\s+/g,' ');
const clean=(v:string,max=500)=>normalize(v).slice(0,max);
const emailOK=(v:string)=>v.length<=160&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function db(){
 const d=database();
 d.exec(`CREATE TABLE IF NOT EXISTS automation_sessions (
  phone TEXT PRIMARY KEY, step TEXT NOT NULL, first_case_id INTEGER NOT NULL,
  media_case_id INTEGER, ticket_id INTEGER, data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_automation_sessions_step ON automation_sessions(step);
 CREATE TABLE IF NOT EXISTS automation_team_notifications (
  ticket_id INTEGER NOT NULL, role TEXT NOT NULL, account_id TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ticket_id,role));`);
 const cols=d.pragma('table_info(automation_sessions)') as Array<{name:string}>;
 if(!cols.some(c=>c.name==='account_id'))d.exec("ALTER TABLE automation_sessions ADD COLUMN account_id TEXT NOT NULL DEFAULT ''");
 for(const [column,type] of [['correction_field','TEXT'],['parent_key','TEXT'],['kind',"TEXT DEFAULT 'issue'"],['texts_json','TEXT'],['fields_json','TEXT'],['policy_json','TEXT']] as const){if(!cols.some(c=>c.name===column))d.exec(`ALTER TABLE automation_sessions ADD COLUMN ${column} ${type}`);}
 d.exec('CREATE TABLE IF NOT EXISTS automation_paused (account_id TEXT NOT NULL,phone TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 1,force_enabled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,phone))');
 const pauseColumns=d.pragma('table_info(automation_paused)') as Array<{name:string}>;
 if(!pauseColumns.some(c=>c.name==='force_enabled'))d.exec('ALTER TABLE automation_paused ADD COLUMN force_enabled INTEGER NOT NULL DEFAULT 0');
 return d;
}
function config(name:string,def='') {return (db().prepare('SELECT value FROM settings WHERE name=?').get(name) as {value:string}|undefined)?.value??def;}
function getSession(phone:string){return db().prepare('SELECT * FROM automation_sessions WHERE phone=?').get(phone) as Session|undefined;}
function save(s:Session){
 s.updated_at=new Date().toISOString();
 db().prepare(`INSERT INTO automation_sessions(phone,step,first_case_id,media_case_id,ticket_id,data_json,updated_at,account_id,correction_field,parent_key,kind,texts_json,fields_json,policy_json)
 VALUES (@phone,@step,@first_case_id,@media_case_id,@ticket_id,@data_json,@updated_at,@account_id,@correction_field,@parent_key,@kind,@texts_json,@fields_json,@policy_json)
 ON CONFLICT(phone) DO UPDATE SET step=excluded.step,first_case_id=excluded.first_case_id,
 media_case_id=excluded.media_case_id,ticket_id=excluded.ticket_id,data_json=excluded.data_json,
 updated_at=excluded.updated_at,account_id=excluded.account_id,correction_field=excluded.correction_field,parent_key=excluded.parent_key,kind=excluded.kind,texts_json=excluded.texts_json,fields_json=excluded.fields_json,policy_json=excluded.policy_json`,).run({...s,correction_field:s.correction_field||null,parent_key:s.parent_key||null,kind:s.kind||'issue',texts_json:s.texts_json||null,fields_json:s.fields_json||null,policy_json:s.policy_json||null});
}
function values(s:Session):Data{try{return JSON.parse(s.data_json) as Data;}catch{return {};}}
function advance(s:Session,step:Step,data:Data){s.step=step;s.data_json=JSON.stringify(data);save(s);}
function fields(s:Session):ExtraField[]{return parseExtraFields(s.fields_json||'[]').filter(f=>f.enabled&&f.system===values(s).system);}
function extraPrompt(s:Session,data:Data):string|null{
 const next=fields(s).find(f=>!Object.hasOwn(data.extra||{},f.id));
 if(!next)return null;
 return `Dato adicional de Soporte TI: *${next.label}* (${next.required?'obligatorio':'opcional'}).${next.required?'':' Escribí OMITIR si no corresponde.'}`;
}
function afterIssue(s:Session,data:Data):string{
 const prompt=extraPrompt(s,data);
 advance(s,prompt?'extra':'evidence',data);
 if(prompt)return prompt;
 if(!isQuestionEnabled(s,'evidence')){advance(s,'confirm',data);return summary(s);}
 return say('evidence',s);
}
async function finishShortRequest(s:Session,data:Data,lastId:number):Promise<string|null>{
 advance(s,'confirm',data);
 // Con confirmación activada, mostrar resumen DIRECTAMENTE (sin exigir LISTO).
 // Con confirmación desactivada, una sola llamada protegida a Jira, solo en modo rápido.
 return policy(s).confirmation?summary(s):createTicket(s,lastId);
}
function greeting(iso:string,s?:Session){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'America/Asuncion'}).format(new Date(iso)));
 const salutation=hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches';
 return isQuestionEnabled(s,'welcome')?`${salutation}. ${say('welcome',s)}\n\n${menu(s)}`:menu(s);
}
// Los clientes envían los campos en UN SOLO mensaje. Se admiten etiquetas o líneas
// en el orden solicitado. Los separadores son saltos de línea, no comas (porque
// el inconveniente puede contener puntuación).
function nextDetailedQuestion(s:Session,data:Data,previous:Step|''):string{
 const remaining=personal.nextDetailedStep(data.system||'',previous);
 const current=remaining.find(step=>{
  const key=Object.keys(personal.QUESTION_TO_STEP).find(k=>personal.QUESTION_TO_STEP[k]===step);
  return !key||isQuestionEnabled(s,key);
 })||'issue';
 advance(s,current,data);
 switch(current){
  case 'ruc':return say('ruc',s);
  case 'talent_name':return say('talentName',s);
  case 'talent_id':return say('talentId',s);
  case 'talent_email':return say('talentEmail',s);
  case 'other_system':return say('otherSystem',s);
  case 'other_email':return say('otherEmail',s);
  default:return data.system==='Futura100'?say('futuraIssue',s):data.system==='Talento100'?say('talentIssue',s):data.system==='Otro sistema'?say('otherIssue',s):say('tiIssue',s);
 }
}
function detailsPrompt(system:string,s:Session){
 const fields=system==='Futura100'?['RUC: 80012345-0','Empresa: Nombre de la empresa','Inconveniente: Describí el problema']:
 system==='Talento100'?['Nombre: Nombre y apellido','Cédula: 1234567','Correo: nombre@empresa.com','Inconveniente: Describí el problema']:
 system==='Otro sistema'?['Sistema: Nombre del sistema','Correo: nombre@empresa.com','Inconveniente: Describí el problema']:
 ['Inconveniente: Describí tu consulta de Soporte TI'];
 return 'Seleccionaste *'+system+'*. Para solicitar Soporte TI, enviá estos datos *juntos en un único mensaje*, una línea por campo:\n\n'+fields.join('\n')+'\n\nLuego podrás agregar imágenes o enviar LISTO para registrar tu solicitud.';
}
function parseDetails(system:string,raw:string):{value?:Data;error?:string}{
 const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 const keys=system==='Futura100'?['ruc','company','issue']:system==='Talento100'?['name','nationalId','email','issue']:system==='Otro sistema'?['otherSystem','email','issue']:['issue'];
 // Permitir texto de inconveniente en varias líneas al final del mensaje.
 if(lines.length<keys.length)return {error:'Faltan datos. Copiá el formato mostrado y completá una línea por campo.'};
 const fieldAliases:Record<string,string[]>={ruc:['ruc'],company:['empresa','nombre de empresa','nombre de la empresa'],name:['nombre','nombre completo'],nationalId:['cedula','cédula','ci'],email:['correo','email','e-mail'],otherSystem:['sistema','otro sistema'],issue:['inconveniente','problema','consulta','descripcion','descripción']};
 const fold=(v:string)=>v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
 const provided:Record<string,string>={};const unlabeled:string[]=[];
 for(const line of lines){
  const match=/^([^:]{2,28})\s*:\s*(.+)$/.exec(line);
  if(match){const k=keys.find(key=>fieldAliases[key]?.some(label=>fold(label)===fold(match[1])));if(k){provided[k]=provided[k]?provided[k]+'\n'+match[2].trim():match[2].trim();continue;}}
  unlabeled.push(line);
 }
 for(const k of keys){if(!provided[k]&&unlabeled.length)provided[k]=k==='issue'?unlabeled.splice(0).join('\n'):unlabeled.shift()||'';}
 if(keys.some(k=>!provided[k]))return {error:'Faltan campos. Enviá todos los datos con sus nombres, cada uno en una línea.'};
 const data:Data={system};
 for(const k of keys){const val=provided[k].trim();if(k==='ruc'&&!validRuc(val))return {error:'RUC inválido: escribilo con el dígito verificador, por por ejemplo 80012345-0 (usá el RUC real).'};
  if(k==='nationalId'&&!/^[0-9.]{4,20}$/.test(val))return {error:'Cédula inválida. Usá solo números y puntos.'};
  if(k==='email'&&!emailOK(val))return {error:'Correo inválido. Revisá el formato nombre@empresa.com.'};
  if(k==='issue'&&(val.length<2||val.length>500))return {error:'El inconveniente debe tener entre 2 y 500 caracteres.'};
  if(k!=='issue'&&k!=='ruc'&&k!=='email'&&(val.length<2||val.length>500))return {error:'Revisá el dato '+k+' (entre 2 y 500 caracteres).'};
  (data as Record<string,string>)[k]=clean(val,k==='email'?160:500);
 }
 return {value:data};
}
function ready(m:Msg){return !!m.media_path&&fs.existsSync(path.join(process.cwd(),'data','media',path.basename(m.media_path)));}
/** Resumen obligatorio ANTES de crear tickets; admite corrección sin reiniciar. */
function summary(s:Session){
 const v=values(s);const lines=['*Resumen de su solicitud*','Sistema: '+(v.system||'')];
 if(v.ruc)lines.push('RUC: '+v.ruc);
 if(v.company)lines.push('Empresa: '+v.company);
 if(v.name)lines.push('Nombre: '+v.name);
 if(v.nationalId)lines.push('Cédula: '+v.nationalId);
 if(v.email)lines.push('Correo: '+v.email);
 if(v.otherSystem)lines.push('Otro sistema: '+v.otherSystem);
 if(v.issue)lines.push('Inconveniente: '+v.issue);
 for(const f of fields(s)){const answer=v.extra?.[f.id];if(answer)lines.push(f.label+': '+answer);}
 lines.push('',say('confirmPrompt',s),'1. Sí, confirmar solicitud','2. Corregir mis datos');
 return lines.join('\n');
}
const labels:Record<string,string>={company:'Empresa',ruc:'RUC',name:'Nombre',nationalId:'Cédula',email:'Correo',otherSystem:'Nombre del sistema',issue:'Inconveniente'};
function correctionList(s:Session){
 const v=values(s);const choices=Object.keys(labels).filter(key=>Object.hasOwn(v,key));
 return say('correctionPrompt',s)+'\n'+[...choices.map(key=>labels[key]),...fields(s).filter(f=>Object.hasOwn(v.extra||{},f.id)).map(f=>f.label)].map((label,i)=>(i+1)+'. '+label).join('\n')+'\nSeleccione una opción o escriba CANCELAR.';
}
/** Validación flexible para personas y empresas; no supone dígito verificador. */
function validRuc(value:string){return value.trim().length>=2&&value.trim().length<=500;}
function correctedValue(field:string,text:string):string|null{
 if(field==='ruc')return validRuc(text)?text:null;
 if(field==='email')return emailOK(text)?text:null;
 if(field==='nationalId')return /^[0-9.]{4,20}$/.test(text)?text:null;
 if(field==='issue')return text.length>=2&&text.length<=500?text:null;
 return text.length>=2&&text.length<=500?text:null;
}
function todayPY(iso:string){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}
function newTextsSnapshot(){const out:Record<string,string>={};for(const key of Object.keys(AUTOMATION_TEXT_DEFAULTS) as AutomationTextKey[])out[key]=say(key);return JSON.stringify(out);}
function items(s:Session,lastId:number){
 return db().prepare(`SELECT * FROM cases WHERE phone=? AND source='whatsapp'
 AND direction='in' AND account_id=? AND id>=? AND id<=? ORDER BY id ASC`).all(s.phone,s.account_id,s.first_case_id,lastId) as Msg[];
}
function realCustomer(s:Session,d:Data,rows:Msg[]){
 const profile=db().prepare('SELECT name FROM contact_profiles WHERE phone=?').get(s.phone) as {name?:string}|undefined;
 const name=d.company||d.name||profile?.name||rows[0]?.customer||'';
 return /^WhatsApp\s+\S+$/i.test(name)||!name?'Cliente '+s.phone:clean(name,100);
}
// Bloqueo antes del POST a Jira: si se pierde la respuesta HTTP, requiere revisión humana.
// No repetir una operación que pudo crear un ticket en Jira.
async function createTicket(s:Session,lastId:number){
 const d=db(),info=values(s);
 if(!info.system||!info.issue)return 'Faltan datos para crear el ticket.';
 if(config('automation_enabled','0')!=='1')return 'La atención automática está desactivada. No se creó ningún ticket.';
 if(['creating','done','review'].includes(s.step))return null;
 if(process.env.ENABLE_REAL_JIRA!=='true')return 'Ya recibimos los datos, pero la creación de Jira está desactivada. Contactá al encargado para habilitarla. No se generó ningún número de ticket.';
 const rows=items(s,lastId);
 if(!rows.length)return 'No encontramos los mensajes de tu solicitud. Contactá al equipo de soporte.';
 const unsettled=d.prepare(`SELECT id FROM customer_jira_tickets WHERE phone=? AND status IN ('sending','review') LIMIT 1`).get(s.phone);
 if(unsettled){advance(s,'review',info);return 'Tu solicitud necesita verificación por el equipo. No generaremos un ticket duplicado.';}
 const customer=realCustomer(s,info,rows);
 const title=(customer+' - '+info.issue.replace(/[\r\n]+/g,' ')).slice(0,240);
 const details=['Sistema: '+info.system];
 if(info.company)details.push('Empresa: '+info.company);
 if(info.ruc)details.push('RUC: '+info.ruc);
 if(info.name)details.push('Nombre: '+info.name);
 if(info.nationalId)details.push('Cédula: '+info.nationalId);
 if(info.email)details.push('Correo: '+info.email);
 if(info.otherSystem)details.push('Sistema indicado: '+info.otherSystem);
 details.push('Inconveniente: '+info.issue);
 for(const f of fields(s)){const answer=info.extra?.[f.id];if(answer)details.push(f.label+': '+answer);}
 details.push('','Mensajes recibidos:');
 for(const msg of rows)details.push(`[${msg.local_date} ${msg.local_time}] ${msg.message}`);
 const missing=rows.filter(msg=>msg.has_media&&!ready(msg));
 if(missing.length)details.push(`AVISO: ${missing.length} adjunto(s) siguen pendientes de descarga; revisar la evidencia cuando se recupere.`);
 // Soporte Nivel 1 = informante; Soporte Nivel 2 = responsable asignado.
 const reporter=config('automation_level1_id').trim();
 const assignee=config('automation_level2_id').trim();
 const assigned=reporter.length>=6?reporter:''; // Nuevo ticket: empieza en Nivel 1; Nivel 2 solo al derivarlo.
 const kind=s.kind==='subtask'?'subtask':'issue';
 const parent=kind==='subtask'?s.parent_key:null;
 const inserted=d.prepare(`INSERT INTO customer_jira_tickets(phone,kind,parent_key,title,assignee_id,status)
 VALUES (?,?,?,?,?,'sending')`).run(s.phone,kind,parent||null,title,assigned||null);
 s.ticket_id=Number(inserted.lastInsertRowid);advance(s,'creating',info);
 try{
  const result=await jiraCreate({...rows[0],customer,message:details.join('\n').slice(0,19000),source:'whatsapp'}, {
   title,customerName:customer,system:['Futura100','Talento100'].includes(info.system)?info.system:'Otros sistemas',
   assigneeId:assigned||undefined,reporterId:reporter||undefined,parentKey:parent||undefined
  });
  d.transaction(()=>{
   d.prepare("UPDATE customer_jira_tickets SET status='created',jira_key=?,jira_id=? WHERE id=?").run(result.key,result.id,s.ticket_id);
   const link=d.prepare('INSERT OR IGNORE INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)');
   rows.forEach(row=>link.run(s.ticket_id,row.id));
  })();
  advance(s,'done',info);
  void notifySupportRoster(result.key,title).catch(e=>console.warn('[MATTERMOST] Aviso interno pendiente:',e));
  if(result.fieldWarnings?.length)console.warn('[JIRA] Advertencias de campos:',result.key,result.fieldWarnings.join(' | '));
  // No agregamos watchers automáticamente a los otros niveles: solamente
  // el nivel de atención elegido recibe enlace, si habilitó WhatsApp.
  // Nivel 1 es el primer escalón. Nivel 2 solo recibe avisos tras derivación.
  controlDb().prepare("INSERT OR IGNORE INTO automation_ticket_stage(ticket_id,role,progress) VALUES(?,'level1','pending')").run(s.ticket_id!);
  try{await notifyRole(s.ticket_id!,result.key,'level1',s.account_id);}catch(e){console.warn('[AVISO NIVEL1] Pendiente:',e);}
  // La sincronización de archivos no debe bloquear la confirmación del ticket.
  // Los registros de entrega evitan reenviar un archivo confirmado.
  void syncTicketEvidence(result.key,rows.map(row=>row.id)).catch(e=>console.warn('[AUTOMATIZACION] Evidencia pendiente:',e));
  const note=missing.length?'\nAlgunos adjuntos están pendientes de revisión.':'';
  return `${say('success',s)}\nTicket: *${result.key}*\nSistema: ${info.system}${note}\n\nSi tenés otro inconveniente, escribí NUEVO.`;
 }catch(err){
  const detail=err instanceof Error?err.message:'Error de comunicación con Jira';
  d.prepare("UPDATE customer_jira_tickets SET status='review',error=? WHERE id=?").run(detail.slice(0,500),s.ticket_id);
  advance(s,'review',info);
  console.warn('[AUTOMATIZACION] Creación sin confirmar:',s.ticket_id,detail);
  return say('ticketReview',s);
 }
}
export async function runAutomation(ev:AutomationEvent):Promise<string|null>{
 // Evitar mensajes automáticos durante la migración si todavía no hay tres guardias válidos.
 if(config('automation_enabled','0')!=='1'||ev.isGroup||ev.message.phone.endsWith('@g.us')||ev.outbound)return null;
 // Si Soporte TI escribió manualmente en las últimas 24 horas, el bot no interrumpe esa atención.
 if(config('automation_flow_human','1')!=='0'&&hasRecentManualOutreach(ev.message.account_id||'',ev.message.phone,ev.receivedAt))return null;
 // Los tres responsables son opcionales. La falta de equipo no habilita el bot ni bloquea la atención.
 const msg=ev.message;
 // Exclusiones generales + teléfonos internos: nunca enviar menús a estos destinatarios.
 const excluded:string[]=config('automation_excluded_phones').match(/\d{8,16}/g)||[];
 const protectedPhones=['automation_level1_phone','automation_level2_phone','automation_manager_phone'].map(key=>config(key).replace(/\D/g,''));
 if(excluded.includes(msg.phone)||protectedPhones.includes(msg.phone)||isStaffPhone(msg.account_id||'',msg.phone)||!contactAllowed(msg.account_id||'',msg.phone)||!scheduleAllowed(ev.receivedAt))return null;
 let session=getSession(msg.phone);
 const preference=db().prepare('SELECT paused,force_enabled FROM automation_paused WHERE account_id=? AND phone=?').get(msg.account_id||'',msg.phone) as {paused:number;force_enabled:number}|undefined;
 if(preference?.paused===1)return null;
 // Una cuenta nueva no reutiliza formularios del número WhatsApp anterior.
 if(session?.account_id!==(msg.account_id||''))session=undefined;
 // Segundo POST del mismo evento: solo cuando WhatsApp termina de descargar un adjunto.
 if(!ev.isNew){
  if(session?.step==='waiting_media'&&session.media_case_id===msg.id&&ev.mediaReady){advance(session,'evidence',values(session));return 'Imagen guardada. Escribí LISTO cuando quieras confirmar y registrar la solicitud.';}
  if(session?.step==='done'&&session.ticket_id&&ev.mediaReady&&msg.id>=session.first_case_id){
   const t=db().prepare("SELECT jira_key FROM customer_jira_tickets WHERE id=? AND status='created'").get(session.ticket_id) as {jira_key:string}|undefined;
   if(t){db().prepare('INSERT OR IGNORE INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)').run(session.ticket_id,msg.id);await syncTicketEvidence(t.jira_key,[msg.id]).catch(()=>{});}
  }
  return null;
 }
 // La sincronización de mensajes antiguos no debe iniciar ni avanzar formularios.
 if(Math.abs(Date.now()-Date.parse(ev.receivedAt))>2*60*1000)return null;
 const text=normalize(msg.message);const command=text.toLocaleUpperCase('es-PY');
 if(session?.step==='done'&&ev.hasMedia&&session.ticket_id&&msg.id>=session.first_case_id&&Date.now()-Date.parse(session.updated_at)<3600000 && (db().prepare('SELECT jira_status_category FROM customer_jira_tickets WHERE id=?').get(session.ticket_id) as {jira_status_category:string|null}|undefined)?.jira_status_category!=='done'){
  const t=db().prepare("SELECT jira_key FROM customer_jira_tickets WHERE id=? AND status='created'").get(session.ticket_id) as {jira_key:string}|undefined;
  if(t){db().prepare('INSERT OR IGNORE INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)').run(session.ticket_id,msg.id);if(ev.mediaReady)await syncTicketEvidence(t.jira_key,[msg.id]).catch(()=>{});}
  return null;
 }
 if(['creating','review'].includes(session?.step||''))return null;
 // Los nuevos mensajes tras el cierre se evalúan por fecha Paraguay y Jira; no reabrir por defecto.
 // Si Jira no confirmó un cierre, el caso existente continúa abierto o sin estado.
 // Un ticket de Jira abierto de este contacto no vuelve a activar el bot,
 // aunque el estado del formulario se haya perdido o reiniciado.
 const activeTicket=db().prepare(`SELECT id FROM customer_jira_tickets
  WHERE phone=? AND status IN ('created','sending','review') AND
  (status!='created' OR jira_status_category IS NULL OR jira_status_category!='done')
  ORDER BY id DESC LIMIT 1`).get(msg.phone) as {id:number}|undefined;
 if(activeTicket)return null;
 // No iniciar un segundo formulario que produciría un ticket duplicado.
 if(session?.step==='done'){
  const prior=db().prepare(`SELECT jira_status_category FROM customer_jira_tickets
   WHERE phone=? AND status='created' AND jira_key IS NOT NULL ORDER BY id DESC LIMIT 1`).get(msg.phone) as {jira_status_category:string|null}|undefined;
  if(prior?.jira_status_category!=='done')return null;
 }
 if((command==='CANCELAR'||command==='0')&&session&& !['done','creating','review'].includes(session.step)){advance(session,'cancelled',values(session));return 'Solicitud cancelada. Para volver a comenzar, escribí NUEVO.';}
 // Horarios y feriados se validaron antes de procesar el mensaje.

 const inactive=session?Date.now()-Date.parse(session.updated_at)>24*60*60*1000:false;
 if((command==='0'||command==='CANCELAR')&&!session)return 'No hay ninguna solicitud activa para cancelar. Si necesitás asistencia, escribí HOLA.';
 if(!session||inactive||['done','cancelled'].includes(session.step)||command==='NUEVO'){
  const current=readFlowPolicy(msg.account_id||'',msg.phone);
  // La modalidad "palabra clave" no interrumpe una conversación normal.
  // "NUEVO" solo reinicia cuando no hay un ticket abierto.
  if(current.startMode==='keyword'&&!flow.keyword(text)&&command!=='NUEVO')return null;
  // Un cierre HOY en Jira permite retomar como subtarea reutilizando los datos
  // del formulario; jamás asociar por mera proximidad de horario.
  const prior=db().prepare(`SELECT jira_key,jira_status_category,jira_closed_at FROM customer_jira_tickets
    WHERE phone=? AND status='created' AND jira_key IS NOT NULL ORDER BY id DESC LIMIT 1`).get(msg.phone) as {jira_key:string;jira_status_category:string|null;jira_closed_at:string|null}|undefined;
  const sameDay=prior?.jira_status_category==='done'&&!!prior.jira_closed_at&&todayPY(prior.jira_closed_at)===todayPY(ev.receivedAt)&&!!session&&!!values(session).system;
  // Un caso abierto no genera automáticamente otro ticket.
  if(prior && prior.jira_status_category && prior.jira_status_category!=='done' && session?.step==='done')
    return 'Su solicitud continúa en atención por nuestro equipo de Soporte TI. Por favor, indique cualquier información adicional relacionada con el inconveniente.';
  const oldData=sameDay && session?values(session):{};
  session={phone:msg.phone,account_id:msg.account_id||'',step:sameDay?'issue':'choose',first_case_id:msg.id,media_case_id:null,ticket_id:null,data_json:JSON.stringify(oldData),updated_at:new Date().toISOString(),kind:sameDay?'subtask':'issue',parent_key:sameDay?prior!.jira_key:null,texts_json:newTextsSnapshot(),fields_json:config('automation_extra_fields','[]'),policy_json:JSON.stringify(current)};
  save(session);
  if(current.shortForm&&!sameDay){
   const quick=flow.firstRequest(text,current.systems,current.multipleSystems);
   if(quick){const data:Data={system:quick.systems.join(', '),issue:quick.issue};return finishShortRequest(session,data,msg.id);}
  }
  return sameDay?'¡Hola! ¿En qué podemos ayudarle?\n\nPor favor, cuéntenos qué inconveniente está presentando.\n\nNuestro equipo de Soporte TI estará asistiendo su solicitud.':greeting(ev.receivedAt,session);
 }
 if(command==='MENU'){advance(session,'choose',{});return menu(session);}
 const data=values(session);
 switch(session.step){
  case 'choose':{
   const p=policy(session);
   if(p.shortForm){
    const selection=flow.parseSelection(text,p.systems,p.multipleSystems);
    if(!selection)return say('invalidChoice',session)+'\n\n'+menu(session);
    data.system=selection.join(', ');
    advance(session,'issue',data);
    return 'Sistema(s): *'+data.system+'*.\nDescribí el inconveniente para Soporte TI (mínimo 2 caracteres).'+
     (p.confirmation?' Luego verás el resumen para confirmar.':' Se registrará la solicitud al recibir tu descripción si Jira está habilitado.');
   }
   const choice=command==='OTROS SISTEMAS'?'Otro sistema':text;
   const selected=flow.parseSelection(choice,p.systems,false);
   if(!selected)return say('invalidChoice',session)+'\n\n'+menu(session);
   data.system=selected[0];
   return nextDetailedQuestion(session,data,'');
  }
  case 'details':{
   if(ev.hasMedia)return 'Primero respondé el dato solicitado; después podrás agregar imágenes.';
   const parsed=parseDetails(data.system||'',msg.message);
   if(!parsed.value)return (parsed.error||'Datos incompletos')+'\n\n'+detailsPrompt(data.system||'',session);
   Object.assign(data,parsed.value);
   return 'Datos recibidos.\n\n'+afterIssue(session,data)+'\n\n*LISTO* muestra el resumen antes de registrar la solicitud en Jira. También podés escribir CORREGIR para cambiar algún dato antes de confirmar.';
  }
  case 'company':
   data.company=clean(text,120);advance(session,'ruc',data);return say('ruc',session);
  case 'ruc':
   if(!validRuc(text))return 'Ingresá el RUC entre 2 y 500 caracteres (por ejemplo, 68547-7).';
   data.ruc=text;return nextDetailedQuestion(session,data,'ruc');
  case 'talent_name':
   if(text.length<2||text.length>500)return 'Indicá tu nombre (entre 2 y 500 caracteres).';
   data.name=clean(text,500);return nextDetailedQuestion(session,data,'talent_name');
  case 'talent_id':
   if(!/^[0-9.]{4,20}$/.test(text))return 'Escribí el número de cédula (solo números, con puntos opcionales).';
   data.nationalId=text;return nextDetailedQuestion(session,data,'talent_id');
  case 'talent_email':
   if(!emailOK(text))return 'Correo no válido. Ejemplo: nombre@empresa.com';
   data.email=text;return nextDetailedQuestion(session,data,'talent_email');
  case 'other_system':
   if(text.length<2||text.length>500)return 'Escribí el nombre del sistema (2 a 500 caracteres).';
   data.otherSystem=clean(text,500);return nextDetailedQuestion(session,data,'other_system');
  case 'other_email':
   if(!emailOK(text))return 'Escribí un correo electrónico válido.';
   data.email=text;return nextDetailedQuestion(session,data,'other_email');
  case 'issue':
   if(ev.hasMedia)return 'Primero contanos el inconveniente por escrito; después podrás enviar la imagen.';
   if(text.length<2||text.length>500)return 'Describí el inconveniente entre 2 y 500 caracteres.';
   data.issue=text;
   if(policy(session).shortForm)return finishShortRequest(session,data,msg.id);
   return (data.system==='Consulta TI'&&isQuestionEnabled(session,'tiHandoff')?say('tiHandoff',session)+'\n\n':'')+afterIssue(session,data);
  case 'extra':{
   const field=fields(session).find(f=>!Object.hasOwn(data.extra||{},f.id));
   if(!field)return afterIssue(session,data);
   if(ev.hasMedia)return 'Primero respondé el dato adicional y después podrás adjuntar imágenes.';
   if(text.toUpperCase()==='OMITIR'&&!field.required){data.extra={...data.extra,[field.id]:''};return afterIssue(session,data);}
   if(text.length<2||text.length>500)return 'Este dato debe tener entre 2 y 500 caracteres'+(field.required?'.':' o escribí OMITIR.') ;
   data.extra={...data.extra,[field.id]:text};return afterIssue(session,data);
  }
  case 'evidence':
   if(ev.hasMedia){session.media_case_id=msg.id;save(session);return ev.mediaReady?'Imagen recibida. Podés adjuntar otra o escribir LISTO para revisar el resumen.':'Archivo recibido, descarga pendiente. Podés enviar más archivos o escribir LISTO; el ticket indicará cualquier evidencia pendiente.';}
   if(['LISTO','OMITIR','SIN IMAGEN','NO'].includes(command)){advance(session,'confirm',data);return summary(session);}
   if(command==='CORREGIR'){advance(session,'correct_choose',data);return correctionList(session);}
   return 'Enviá una imagen o documento, o escribí LISTO para revisar el resumen y luego confirmar. También podés escribir CORREGIR.';
  case 'waiting_media':
   if(['LISTO','OMITIR','SIN IMAGEN'].includes(command)){advance(session,'confirm',data);return summary(session);}
   return 'La imagen está pendiente de descarga. Podés enviar otro adjunto o escribir LISTO para revisar el resumen.';
  case 'confirm':
   if(['1','SI','SÍ','CONFIRMAR','SÍ, CONFIRMAR SOLICITUD'].includes(command))return createTicket(session,msg.id);
   if(['2','CORREGIR','CORREGIR MIS DATOS'].includes(command)){advance(session,'correct_choose',data);return correctionList(session);}
   return 'Para registrar el ticket, responda 1 (Sí, confirmar) o 2 (Corregir datos).';
  case 'correct_choose':{
   const available=[...Object.keys(labels).filter(key=>Object.hasOwn(data,key)),...fields(session).filter(f=>Object.hasOwn(data.extra||{},f.id)).map(f=>'extra.'+f.id)];
   const idx=Number.parseInt(text,10)-1;
   const selected=Number.isInteger(idx)&&idx>=0&&idx<available.length?available[idx]:available.find(key=>(key.startsWith('extra.')?fields(session).find(f=>f.id===key.slice(6))?.label:labels[key])?.toUpperCase()===command);
   if(!selected)return correctionList(session);
   session.correction_field=selected;advance(session,'correct_value',data);
   return 'Por favor, indique el nuevo valor de '+(selected.startsWith('extra.')?fields(session).find(f=>f.id===selected.slice(6))?.label:labels[selected])+'.';
  }
  case 'correct_value':{
   const field=session.correction_field||'';const updated=field.startsWith('extra.')?(text.length>=2&&text.length<=500?text:null):correctedValue(field,text);
   if(!updated)return 'Valor inválido. Revisá el formato e intentá nuevamente.';
   if(field.startsWith('extra.'))data.extra={...data.extra,[field.slice(6)]:updated};
   else (data as Record<string,string>)[field]=updated;
   session.correction_field=undefined;advance(session,'confirm',data);
   return 'Dato actualizado.\n\n'+summary(session);
  }
  default:return null;
 }
}
