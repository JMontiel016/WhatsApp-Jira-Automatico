'use strict';
// Tests sin salida a red ni tickets: usa Node 22 SQLite y una respuesta simulada.
const ts=require('typescript'),fs=require('fs'),vm=require('vm');
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync(':memory:');
d.exec("CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('automation_level2_phone','595981777888'); INSERT INTO settings VALUES ('automation_level2_minutes','30');");
let sent=[];
process.env.JIRA_BASE_URL='https://prueba.atlassian.net';
process.env.WHATSAPP_LOCAL_SECRET='PRUEBA_LOCAL_DE_32_CARACTERES_ZZZ';
const mockFetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({sent:true,id:'wamessage-1'})}};
const src=fs.readFileSync(require('path').join(__dirname,'../lib/level2-followup.ts'),'utf8');
const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={};
vm.runInNewContext(code,{exports:mod,require:n=>n==='./db'?{database:()=>d}:require(n),process,console,Date,fetch:mockFetch,URL,AbortSignal}, {filename:'level2-followup.ts'});
function assert(ok,m){if(!ok)throw Error('FAIL '+m);console.log('PASS '+m)}
(async()=>{
 await mod.recordLevel2Ticket(8,'CW-555');
 assert(sent.length===1,'Se envía un solo mensaje');
 assert(sent[0].text==='https://prueba.atlassian.net/browse/CW-555','Nivel 2 recibe solo el enlace');
 assert(sent[0].phone==='595981777888','Destinatario es teléfono Nivel 2 configurado');
 const one=mod.followupOverview()[0];
 assert(one.state==='sent','Confirmación de envío persistente');
 assert(new Date(one.due_at)-new Date(one.created_at)===30*60*1000,'Plazo de seguimiento 30 minutos');
 await mod.recordLevel2Ticket(8,'CW-555');assert(sent.length===1,'Evita aviso duplicado');
 assert(!mod.confirmFromLevel2('595981111111','595981000000@c.us','CONFIRMO CW-555'),'Rechaza confirmación de un tercero');
 assert(mod.confirmFromLevel2('595981777888','595981000000@c.us','CONFIRMO CW-555'),'Acepta confirmación verificable de Nivel 2');
 assert(mod.followupOverview()[0].state==='confirmed','Detiene seguimiento al confirmar');
 // La plantilla es opcional, y conserva tanto el número como el vínculo real.
 d.prepare('INSERT INTO settings(name,value) VALUES (?,?)').run('automation_notice_level2','Soporte TI · {ticket} · Escalado a {nivel}: {link}');
 await mod.recordLevel2Ticket(9,'CW-556');
 assert(sent.length===2,'Un aviso adicional para un ticket distinto');
 assert(sent[1].text==='Soporte TI · CW-556 · Escalado a N2: https://prueba.atlassian.net/browse/CW-556','Mensaje configurable de N2 con enlace');
 console.log('PASS: seguimiento Level2 aislado finalizado.');
})().catch(error=>{console.error(error);process.exitCode=1});
