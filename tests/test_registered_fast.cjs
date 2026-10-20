'use strict';
// Aislado: no llama Jira, WhatsApp ni toca SQLite real.
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'),path=require('node:path');
const ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');
db.pragma=v=>db.prepare('PRAGMA '+v).all();
db.transaction=cb=>(...args)=>{db.exec('BEGIN');try{const v=cb(...args);db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
db.exec(`CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE contact_profiles(phone TEXT PRIMARY KEY,name TEXT,is_group INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cases(id INTEGER PRIMARY KEY,phone TEXT,customer TEXT,message TEXT,source TEXT,direction TEXT,local_date TEXT,local_time TEXT,account_id TEXT,received_at TEXT,has_media INTEGER DEFAULT 0, media_path TEXT);
CREATE TABLE customer_jira_tickets(id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT,kind TEXT,parent_key TEXT,title TEXT,assignee_id TEXT,status TEXT,jira_key TEXT,jira_id TEXT,jira_status_category TEXT,jira_closed_at TEXT,error TEXT);
CREATE TABLE customer_ticket_messages(ticket_id INTEGER,message_id INTEGER,PRIMARY KEY(ticket_id,message_id));
CREATE TABLE automation_ticket_stage(ticket_id INTEGER,role TEXT,progress TEXT,UNIQUE(ticket_id,role));`);
const put=db.prepare('INSERT INTO settings(name,value) VALUES (?,?)');
[['automation_enabled','1'],['automation_flow_human','1'],['automation_flow_short','1'],['automation_flow_confirm','0'],['automation_level1_id','acc-level-one'],['automation_level2_id','acc-level-two'],['automation_text_welcome','Bienvenido a Soporte TI.']].forEach(p=>put.run(...p));
let jiraCalls=[];
const mocks={
 './db':{database:()=>db},
 './jira':{jiraCreate:async (_c,o)=>{jiraCalls.push(o);return {key:'CW-'+(300+jiraCalls.length),id:String(jiraCalls.length)};}},
 './jira-evidence':{syncTicketEvidence:async()=>({uploaded:0,errors:[]})},
 './automation-controls':{scheduleAllowed:()=>true,contactAllowed:()=>true,isStaffPhone:()=>false,controlDb:()=>db,hasRecentManualOutreach:()=>false},
 './automation-routing':{notifyRole:async()=>({state:'simulated'})},
};
const dir=path.resolve(__dirname,'../lib');
let text,extraFields;
function load(filename){
 const source=fs.readFileSync(filename,'utf8');
 const js=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};const req=id=>{
  if(id==='./automation-text')return text;
  if(id==='./automation-extra-fields')return extraFields;
  if(id==='./automation-flow.cjs')return require(path.join(dir,'automation-flow.cjs'));
  if(id in mocks)return mocks[id];
  return require(id);
 };
 vm.runInNewContext(js,{exports,require:req,process,console,Buffer,Date,Intl,setTimeout,clearTimeout,URL},{filename});return exports;
}
text=load(path.join(dir,'automation-text.ts'));
extraFields=load(path.join(dir,'automation-extra-fields.ts'));
const bot=load(path.join(dir,'automation.ts'));
process.env.ENABLE_REAL_JIRA='true';
let id=10;const account='595981000000@c.us';
async function send(phone,body,opts={}){
 const stamp=new Date().toISOString(),messageId=id++;
 db.prepare('INSERT INTO cases(id,phone,customer,message,source,direction,local_date,local_time,account_id,received_at,has_media) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
 .run(messageId,phone,'Cliente',body,'whatsapp',opts.outbound?'out':'in','2026-10-19','12:00',opts.account||account,stamp,opts.media?1:0);
 const message={id:messageId,phone,customer:'Cliente',message:body,source:'whatsapp',direction:opts.outbound?'out':'in',local_date:'2026-10-19',local_time:'12:00',account_id:opts.account||account,received_at:stamp,has_media:opts.media?1:0};
 return bot.runAutomation({message,isNew:true,outside:true,isGroup:!!opts.group,outbound:!!opts.outbound,hasMedia:!!opts.media,mediaReady:false,receivedAt:stamp});
}
(async()=>{
 // Cliente antiguo: nombre conocido y actividad anterior de la MISMA cuenta.
 const phone='595981123456';
 db.prepare('INSERT INTO contact_profiles(phone,name,is_group) VALUES(?,?,0)').run(phone,'Empresa Verificada');
 db.prepare('INSERT INTO cases(id,phone,customer,message,source,direction,local_date,local_time,account_id,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(1,phone,'Empresa Verificada','Consulta anterior','whatsapp','in','2026-10-01','12:00',account,'2026-10-01T15:00:00.000Z');
 const hello=await send(phone,'Hola');
 assert.match(hello,/en qué podemos ayudarle/i);
 assert.doesNotMatch(hello,/1\. Futura100|RUC|seleccioná escribiendo/i);
 assert.match(hello,/imagen o documento/i);
 const summary=await send(phone,'No puedo generar recibos');
 assert.match(summary,/Resumen/);
 assert.match(summary,/No puedo generar recibos/);
 assert.match(summary,/CONFIRMAR/);
 assert.doesNotMatch(summary,/LISTO|RUC|cédula/i);
 assert.equal(jiraCalls.length,0,'No crear sin confirmar aunque la configuración general deshabilite la confirmación');
 const media=await send(phone,'[Imagen]',{media:true});
 assert.match(media,/Archivos recibidos: 1/);
 assert.equal(jiraCalls.length,0);
 const correction=await send(phone,'CORREGIR');
 assert.match(correction,/nuevamente el inconveniente/i);
 const res=await send(phone,'No puedo generar las facturas');
 assert.match(res,/Archivos recibidos: 1/);
 const created=await send(phone,'CONFIRMAR');
 assert.match(created,/CW-301/);
 assert.equal(jiraCalls.length,1);
 assert.equal(jiraCalls[0].system,'Otros sistemas');
 assert.ok(!jiraCalls[0].title.includes('RUC'));
 assert.equal(await send(phone,'Más información'),null,'Ticket abierto no reinicia bot');
 assert.equal(jiraCalls.length,1,'Solo un ticket');
 db.prepare("UPDATE settings SET value='0' WHERE name='automation_flow_short'").run();
 const contactNew='595981777777';
 const newHello=await send(contactNew,'Hola');
 assert.match(newHello,/Futura100/,'Cliente nuevo mantiene el formulario estándar');
 assert.match(await send(contactNew,'1'),/RUC/);
 const otherAccount='595981999999@c.us';
 const foreign='595981888888';
 db.prepare('INSERT INTO contact_profiles(phone,name,is_group) VALUES(?,?,0)').run(foreign,'Empresa antigua');
 db.prepare('INSERT INTO cases(id,phone,customer,message,source,direction,local_date,local_time,account_id,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(2,foreign,'Empresa antigua','Antes','whatsapp','in','2026-10-01','12:00',account,'2026-10-01T15:00:00.000Z');
 const foreignHello=await send(foreign,'Hola',{account:otherAccount});
 assert.match(foreignHello,/Futura100/,'No reconocer registros de otra cuenta');
 assert.equal(await send('595981999000','hola',{group:true}),null,'No responde en grupos');
 assert.equal(await send('595981999001','hola',{outbound:true}),null,'No responde a soporte');
 console.log('[OK] 13 escenarios: registro previo, sin RUC, archivo opcional, una confirmación, corrección, Jira sin duplicados, cliente nuevo y aislamiento por cuenta.');
})().catch(e=>{console.error(e);process.exitCode=1;});
