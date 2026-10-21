'use strict';
// Prueba aislada del motor: SQLite en memoria, Jira y WhatsApp simulados.
// Nunca envía mensajes ni crea tickets reales.
const fs=require('fs'),vm=require('vm'),path=require('path');
const ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');
db.pragma=x=>db.prepare('PRAGMA '+x).all();
db.transaction=cb=>(...args)=>{db.exec('BEGIN');try{const v=cb(...args);db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}};
db.exec(`CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE contact_profiles(phone TEXT PRIMARY KEY,name TEXT);
CREATE TABLE cases(id INTEGER PRIMARY KEY,phone TEXT,customer TEXT,message TEXT,source TEXT,direction TEXT,local_date TEXT,local_time TEXT,account_id TEXT,received_at TEXT,has_media INTEGER DEFAULT 0);
CREATE TABLE customer_jira_tickets(id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, kind TEXT, parent_key TEXT,title TEXT,assignee_id TEXT,status TEXT,jira_key TEXT,jira_id TEXT,jira_status_category TEXT,jira_closed_at TEXT,error TEXT);
CREATE TABLE customer_ticket_messages(ticket_id INTEGER,message_id INTEGER,PRIMARY KEY(ticket_id,message_id));
CREATE TABLE automation_ticket_stage(ticket_id INTEGER,role TEXT,progress TEXT,UNIQUE(ticket_id,role));`);
const values=[['automation_enabled','1'],['automation_level1_id','acc-level-one'],['automation_level2_id','acc-level-two'],['automation_manager_id','acc-manager'],['automation_text_welcome','Bienvenido a Soporte TI.']];
const put=db.prepare('INSERT INTO settings(name,value) VALUES(?,?)');values.forEach(x=>put.run(...x));
let jiraCalls=[];
const mock={
 './db':{database:()=>db},
 './jira':{jiraCreate:async (_c,opts)=>{jiraCalls.push(opts);return {key:'CW-'+(300+jiraCalls.length),id:String(jiraCalls.length)};},jiraAddTeamWatchers:async()=>({errors:{}})},
 './jira-evidence':{syncTicketEvidence:async()=>({uploaded:0,errors:[]})},
 './jira-team':{TEAM_ROLES:{level1:'Nivel 1',level2:'Nivel 2',manager:'Encargado'}},
 './level2-followup':{recordLevel2Ticket:async()=>{}},
 './automation-controls':{scheduleAllowed:()=>true,contactAllowed:()=>true,isStaffPhone:()=>false,hasRecentManualOutreach:()=>false,controlDb:()=>db},
 './automation-flow.cjs':require('../lib/automation-flow.cjs'),
 './automation-routing':{notifyRole:async()=>({state:'simulated'})},
};
const dir=path.resolve(__dirname,'../lib');
const textPath=path.join(dir,'automation-text.ts');
function load(file,extra={}){
 const source=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exp={};const req=(id)=>{
   if(id==='./automation-text')return text;
   if(id==='./automation-extra-fields')return extraFields;
   if(id in extra)return extra[id];
   if(id in mock)return mock[id];
   return require(id);
 };
 const context={exports:exp,require:req,process,console,Buffer,Date,Intl,setTimeout,clearTimeout,URL};
 vm.runInNewContext(js,context,{filename:file});return exp;
}
const text=load(textPath);
const extraFields=load(path.join(dir,'automation-extra-fields.ts'));
const bot=load(path.join(dir,'automation.ts'));
const now=()=>new Date().toISOString();
process.env.ENABLE_REAL_JIRA='true';
let caseId=1;let phone='595981123456';const account='595981000000@c.us';
async function incoming(body,{outbound=false,media=false,newMessage=true,group=false}={}){
 const timestamp=now(),id=caseId++;
 const ruleDate=new Date().toISOString().slice(0,10);
 const result=db.prepare('INSERT INTO cases(id,phone,customer,message,source,direction,local_date,local_time,account_id,received_at,has_media) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,phone,'Prueba',''+body,'whatsapp',outbound?'out':'in',ruleDate,'22:30',account,timestamp,media?1:0);
 return bot.runAutomation({message:{id,phone,customer:'Prueba',message:body,source:'whatsapp',direction:outbound?'out':'in',local_date:ruleDate,local_time:'22:30',account_id:account,received_at:timestamp,has_media:media?1:0},isNew:newMessage,outside:true,isGroup:group,outbound,hasMedia:media,mediaReady:false,receivedAt:timestamp});
}
function check(ok,message){if(!ok)throw Error('FAIL '+message);console.log('PASS '+message)}

(async()=>{
 const update=db.prepare('INSERT INTO settings(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value');
 function put(name,value){update.run(name,value)}
 db.exec('CREATE TABLE automation_saved_contacts(account_id TEXT,phone TEXT,is_saved INTEGER,checked_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,phone))');
 put('automation_saved_contact_mode','short');
 put('automation_saved_contact_confirm','1');
 put('automation_flow_short','0');
 put('automation_flow_confirm','1');
 // Guardado de verdad: primera interacción solo sistema + inconveniente.
 phone='595981100101';
 db.prepare('INSERT INTO automation_saved_contacts(account_id,phone,is_saved) VALUES (?,?,?)').run(account,phone,1);
 check((await incoming('Hola')).includes('Soporte TI'),'Contacto guardado recibe menú');
 const savedPrompt=await incoming('1');
 check(/inconveniente/i.test(savedPrompt)&&!/ruc/i.test(savedPrompt),'Guardado no solicita RUC');
 check((await incoming('No puedo generar reporte')).includes('Resumen'),'Guardado confirma según su regla');
 check(jiraCalls.length===0,'Confirmación de guardado evita ticket prematuro');
 check((await incoming('1')).includes('CW-'),'Guardado crea ticket tras confirmación');
 // Un nombre en contacto no autoriza omitir RUC.
 phone='595981100102';
 db.prepare('INSERT INTO contact_profiles(phone,name) VALUES (?,?)').run(phone,'Cliente conocido solo por chat');
 check((await incoming('Hola')).includes('Soporte TI'),'Cliente no comprobado inicia flujo general');
 check(/ruc/i.test(await incoming('1')),'Nombre de chat no implica contacto guardado');
 // Verificado como no guardado: mismo flujo general.
 phone='595981100103';
 db.prepare('INSERT INTO automation_saved_contacts(account_id,phone,is_saved) VALUES (?,?,?)').run(account,phone,0);
 await incoming('Hola');
 check(/ruc/i.test(await incoming('1')),'No guardado conserva preguntas generales');
 // Si se desactiva confirmación solo para guardados, ticket inmediato.
 put('automation_saved_contact_confirm','0');
 phone='595981100104';
 db.prepare('INSERT INTO automation_saved_contacts(account_id,phone,is_saved) VALUES (?,?,?)').run(account,phone,1);
 await incoming('Hola'); await incoming('1');
 const before=jiraCalls.length;
 const created=await incoming('Error al ingresar');
 check(/CW-/.test(created)&&jiraCalls.length===before+1,'Modo sin confirmación crea una sola vez tras inconveniente');
 await incoming('Otro mensaje');
 check(jiraCalls.length===before+1,'No duplica un ticket abierto');
 console.log('[OK] Reglas verificadas con SQLite en memoria, sin WhatsApp/Jira reales');
})().catch(e=>{console.error(e);process.exitCode=1});
