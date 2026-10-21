import {database} from '@/lib/db';
import {DEFAULT_CONFIG,validateConfig,CloudConfig,CloudState,newState} from './cloud-menu';
export function cloudDb(){
 const d=database();
 d.exec(`CREATE TABLE IF NOT EXISTS cloud_menu_config (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cloud_menu_sessions (phone TEXT PRIMARY KEY,state TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cloud_menu_processed (message_id TEXT PRIMARY KEY,phone TEXT NOT NULL,at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cloud_menu_ticket_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT NOT NULL,confirm_event_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('sending','created','review')),jira_key TEXT,error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cloud_menu_delivery (id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'sending',error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 `);
 return d;
}
export function getConfig():CloudConfig{
 const d=cloudDb();const value=(d.prepare('SELECT value FROM cloud_menu_config WHERE id=1').get() as {value:string}|undefined)?.value;
 if(!value)return structuredClone(DEFAULT_CONFIG);
 return validateConfig(JSON.parse(value));
}
export function saveConfig(value:unknown){const c=validateConfig(value);
 cloudDb().prepare(`INSERT INTO cloud_menu_config(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(c));
 return c;
}
export function getSession(phone:string):CloudState{
 const row=cloudDb().prepare('SELECT state FROM cloud_menu_sessions WHERE phone=?').get(phone) as {state:string}|undefined;
 if(!row)return newState();
 try{return JSON.parse(row.state) as CloudState;}catch{return newState();}
}
export function putSession(phone:string,s:CloudState){cloudDb().prepare(`INSERT INTO cloud_menu_sessions(phone,state) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET state=excluded.state,updated_at=CURRENT_TIMESTAMP`).run(phone,JSON.stringify(s));}
