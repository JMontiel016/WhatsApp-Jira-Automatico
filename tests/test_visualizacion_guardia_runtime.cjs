'use strict';
// Prueba de comportamiento con better-sqlite3 y typescript del proyecto.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const Database=require('better-sqlite3');
const d=new Database(':memory:');
// Esquema mínimo; no usa ni altera data/app.sqlite.
d.exec(`CREATE TABLE cases(id INTEGER PRIMARY KEY,account_id TEXT,source TEXT,phone TEXT,jira_key TEXT);
 CREATE TABLE customer_jira_tickets(id INTEGER PRIMARY KEY,phone TEXT,status TEXT,jira_key TEXT,title TEXT,jira_closed_at TEXT);
 CREATE TABLE customer_ticket_messages(ticket_id INTEGER,message_id INTEGER);
 CREATE TABLE contact_profiles(phone TEXT,name TEXT);
 CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT);`);
const root=path.resolve(__dirname,'..');
function importTs(relative,imports){
 const filename=path.join(root,relative);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const file=new Module(filename,module);file.filename=filename;file.paths=Module._nodeModulePaths(path.dirname(filename));
 const original=file.require.bind(file);
 file.require=x=>Object.hasOwn(imports,x)?imports[x]:original(x);
 file._compile(code,filename);
 return file.exports;
}
const controls=importTs('lib/automation-controls.ts',{'./db':{database:()=>d},'./rules':{evaluate:()=>({outside:true,weekend:false,holiday:false})}});
const account='595981234567@c.us',phone='595981123456';
controls.expectBotOutgoing(account,phone,'Hola, Soporte TI');
assert.equal(controls.consumeBotOutgoing(account,phone,'Hola, Soporte TI',new Date().toISOString()),true);
assert.equal(controls.consumeBotOutgoing(account,phone,'Hola, Soporte TI',new Date().toISOString()),false);
assert.equal(controls.markManualOutreach(account,phone),true);
assert.equal(controls.hasRecentManualOutreach(account,phone,new Date().toISOString()),true);
assert.equal(controls.hasRecentManualOutreach(account,phone,new Date(Date.now()+25*60*60*1000).toISOString()),false);
console.log('[OK] Humano frente al bot: no se marca envío automático y la atención manual pausa 24 horas.');
// Tickets: verificamos el aislamiento entre cuentas y la recuperación sin listado de chats.

d.prepare('INSERT INTO cases VALUES (1,?,?,?,?)').run(account,'whatsapp',phone,'CW-123');
d.prepare('INSERT INTO cases VALUES (2,?,?,?,?)').run('595981999999@c.us','whatsapp','595981900000','CW-999');
d.prepare('INSERT INTO customer_jira_tickets(id,phone,status,jira_key,title) VALUES (1,?,?,?,?)').run(phone,'created','CW-123','Atención');
d.prepare('INSERT INTO customer_jira_tickets(id,phone,status,jira_key,title) VALUES (2,?,?,?,?)').run('595981900000','created','CW-999','Otra cuenta');
d.prepare('INSERT INTO customer_ticket_messages VALUES(1,1)').run();
d.prepare('INSERT INTO customer_ticket_messages VALUES(2,2)').run();
const mockedNext={NextResponse:{json:(payload)=>({status:200,data:payload})}};
const routes=importTs('app/api/jira/managed/route.ts',{'next/server':mockedNext,'@/lib/db':{database:()=>d},'@/lib/active-account':{linkedAccount:async()=>account}});
(async()=>{const reply=await routes.GET();assert.equal(reply.data.length,1);assert.equal(reply.data[0].jira_key,'CW-123');console.log('[OK] Tickets: se listan sin depender de chats y sin mezclar cuentas.');})().catch(e=>{console.error(e);process.exitCode=1;});
