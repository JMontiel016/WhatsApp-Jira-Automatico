import {database} from './db';
import {createHash} from 'node:crypto';
import {evaluate} from './rules';

export type SupportRole='level1'|'level2'|'manager';
export type Staff={id:number;account_id:string;role:SupportRole;phone:string;name:string;active:number;notify:number;call_enabled:number;followup:number;minutes:number|null};
export function controlDb(){
 const d=database();
 const ticketCols=d.pragma('table_info(customer_jira_tickets)') as Array<{name:string}>;
 if(!ticketCols.some(c=>c.name==='jira_closed_at'))d.exec('ALTER TABLE customer_jira_tickets ADD COLUMN jira_closed_at TEXT');
 const caseCols=d.pragma('table_info(cases)') as Array<{name:string}>;
 if(!caseCols.some(c=>c.name==='account_id'))d.exec("ALTER TABLE cases ADD COLUMN account_id TEXT NOT NULL DEFAULT ''");
 d.exec(`
 CREATE TABLE IF NOT EXISTS automation_contact_rules(account_id TEXT NOT NULL,phone TEXT NOT NULL,excluded INTEGER NOT NULL DEFAULT 0,override_mode TEXT NOT NULL DEFAULT 'default' CHECK(override_mode IN ('default','enabled','disabled')),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,phone));
 CREATE TABLE IF NOT EXISTS automation_support_staff(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('level1','level2','manager')),phone TEXT NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,notify INTEGER NOT NULL DEFAULT 1,call_enabled INTEGER NOT NULL DEFAULT 0,followup INTEGER NOT NULL DEFAULT 1,minutes INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(account_id,role,phone));
 CREATE TABLE IF NOT EXISTS automation_ticket_stage(ticket_id INTEGER PRIMARY KEY,role TEXT NOT NULL DEFAULT 'level1',progress TEXT NOT NULL DEFAULT 'pending',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS automation_ticket_link_delivery(ticket_id INTEGER NOT NULL,staff_id INTEGER NOT NULL,role TEXT NOT NULL,link TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'sending',error TEXT,wa_message_id TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(ticket_id,staff_id,role));
 CREATE TABLE IF NOT EXISTS automation_ticket_ack(ticket_id INTEGER PRIMARY KEY,staff_id INTEGER NOT NULL,confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS automation_call_requests(ticket_id INTEGER NOT NULL,staff_id INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,voice_text TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(ticket_id,staff_id));
 CREATE TABLE IF NOT EXISTS automation_manual_outreach(account_id TEXT NOT NULL,phone TEXT NOT NULL,last_sent_at TEXT NOT NULL,PRIMARY KEY(account_id,phone));
 CREATE TABLE IF NOT EXISTS automation_bot_outgoing(account_id TEXT NOT NULL,phone TEXT NOT NULL,text_hash TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(account_id,phone,text_hash));
 `);
 return d;
}
export function setting(key:string,otherwise=''){return (controlDb().prepare('SELECT value FROM settings WHERE name=?').get(key) as {value:string}|undefined)?.value??otherwise;}
export function enabled(key:string,otherwise='0'){return setting(key,otherwise)==='1';}
export function scheduleAllowed(iso:string){
 const r=evaluate(iso);
 const key=r.holiday?'automation_allow_holidays':r.weekend?'automation_allow_weekends':r.outside?'automation_allow_outside':'automation_allow_inside';
 return enabled(key,key==='automation_allow_outside'||key==='automation_allow_weekends'||key==='automation_allow_holidays'?'1':'0');
}
export function contactAllowed(account:string,phone:string){
 const d=controlDb();const row=d.prepare('SELECT excluded,override_mode FROM automation_contact_rules WHERE account_id=? AND phone=?').get(account,phone) as {excluded:number;override_mode:string}|undefined;
 if(row?.excluded===1||row?.override_mode==='disabled')return false;
 // Una preferencia individual explícita tiene prioridad sobre una lista heredada.
 if(row && row.excluded===0)return true;
 const legacy: string[] = setting('automation_excluded_phones').match(/\d{8,16}/g) ?? [];
 if(legacy.includes(phone))return false;
 return true;
}
export function listStaff(account:string,role?:SupportRole):Staff[]{
 return controlDb().prepare('SELECT * FROM automation_support_staff WHERE account_id=? AND (? IS NULL OR role=?) ORDER BY role,name,id').all(account,role||null,role||null) as Staff[];
}
export function isStaffPhone(account:string,phone:string){return !!controlDb().prepare('SELECT 1 FROM automation_support_staff WHERE account_id=? AND phone=? AND active=1').get(account,phone);}

/** El agente humano inicia o retoma la atención: durante 24 h no se dispara el formulario automático.
 * Se registra SOLO tras un envío manual confirmado; los mensajes del propio bot no pasan por aquí. */
export function markManualOutreach(account:string,phone:string){
 if(!/^\d{5,40}@(c\.us|lid)$/.test(account)||!/^\d{5,40}$/.test(phone))return false;
 controlDb().prepare(`INSERT INTO automation_manual_outreach(account_id,phone,last_sent_at) VALUES (?,?,?)
 ON CONFLICT(account_id,phone) DO UPDATE SET last_sent_at=excluded.last_sent_at`).run(account,phone,new Date().toISOString());
 return true;
}
export function hasRecentManualOutreach(account:string,phone:string,now:string){
 const row=controlDb().prepare('SELECT last_sent_at FROM automation_manual_outreach WHERE account_id=? AND phone=?').get(account,phone) as {last_sent_at:string}|undefined;
 const sent=row?Date.parse(row.last_sent_at):NaN, at=Date.parse(now);
 return Number.isFinite(sent)&&Number.isFinite(at)&&at>=sent&&at-sent<24*60*60*1000;
}

// Distinguir respuesta automática de intervención humana incluso desde el teléfono.
// Se registra ANTES de que el conector envíe la respuesta; no almacena contenido.
function botTextHash(value:string){return createHash('sha256').update(value).digest('hex');}
export function expectBotOutgoing(account:string,phone:string,text:string){
 if(!/^\d{5,40}@(c\.us|lid)$/.test(account)||!/^\d{5,40}$/.test(phone)||!text)return;
 const d=controlDb();
 d.prepare(`INSERT INTO automation_bot_outgoing(account_id,phone,text_hash,expires_at) VALUES(?,?,?,?)
 ON CONFLICT(account_id,phone,text_hash) DO UPDATE SET expires_at=excluded.expires_at`).run(account,phone,botTextHash(text),new Date(Date.now()+5*60000).toISOString());
}
export function consumeBotOutgoing(account:string,phone:string,text:string,receivedAt:string){
 if(!text)return false;
 const d=controlDb(),stamp=new Date(receivedAt).toISOString(),hash=botTextHash(text);
 const result=d.prepare('DELETE FROM automation_bot_outgoing WHERE account_id=? AND phone=? AND text_hash=? AND expires_at>=?').run(account,phone,hash,stamp);
 if(result.changes>0)return true;
 // Purgar únicamente las expectativas vencidas; nunca tocar mensajes reales.
 d.prepare('DELETE FROM automation_bot_outgoing WHERE expires_at<?').run(new Date().toISOString());
 return false;
}
