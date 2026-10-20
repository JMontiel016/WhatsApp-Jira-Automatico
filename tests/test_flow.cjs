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
 check((await incoming('Hola')).includes('Bienvenido'),'saludo inicial');
 check((await incoming('1')).includes('RUC'),'Futura100 solo solicita RUC');
 let total=0;for(const [i,v] of '80012345'.split('').reverse().entries())total+=Number(v)*(2+i%10);
 const d=11-total%11;const ruc='80012345-'+(d===11||d===10?0:d);
 check((await incoming(ruc)).includes('inconveniente'),'acepta RUC con dígito verificador');
 check((await incoming('El sistema no abre')).includes('imagen'),'pide evidencia');
 const summary=await incoming('LISTO');
 check(summary.includes('Resumen')&&summary.includes('80012345'),'resumen antes de Jira');
 check(jiraCalls.length===0,'Jira NO crea ticket antes de confirmar');
 check((await incoming('2')).includes('corregir'),'permite corregir');
 check((await incoming('1')).includes('RUC'),'elección del campo');
 check((await incoming(ruc)).includes('Resumen'),'muestra resumen actualizado');
 check(jiraCalls.length===0,'sigue sin crear durante corrección');
 const confirmed=await incoming('1');
 check(confirmed.includes('CW-301')&&jiraCalls.length===1,'crea un único ticket tras confirmar');
 await incoming('mensaje adicional');check(jiraCalls.length===1,'no duplica por mensaje posterior');
 db.prepare("UPDATE customer_jira_tickets SET jira_status_category='done',jira_closed_at=? WHERE id=1").run(new Date().toISOString());
 const ret=await incoming('Tengo otro inconveniente');check(ret?.includes('¿En qué podemos ayudarle?'),'retorno el mismo día sin pedir todos los datos');
 check((await incoming('La consulta ya no carga')).includes('imagen'),'subtarea prepara descripción');
 check((await incoming('LISTO')).includes('Resumen'),'subtarea también exige confirmación');
 await incoming('1');
 check(jiraCalls.length===2&&jiraCalls[1].parentKey==='CW-301','subtarea vinculada al ticket original');
 // Los cuatro formularios pasan por confirmación; la corrección no crea tickets.
 phone='595981123457';
 check((await incoming('Hola'))?.includes('Soporte TI'),'Talento100: saludo');
 check((await incoming('2'))?.includes('nombre'),'Talento100: selecciona opción');
 await incoming('Prueba Apellido');await incoming('1234567');await incoming('usuario@empresa.com');await incoming('No aparece la pantalla de ingreso');
 check((await incoming('LISTO'))?.includes('Cédula: 1234567'),'Talento100: resumen');
 check(jiraCalls.length===2,'Talento100: no crea sin confirmar');
 await incoming('2');await incoming('3');
 check((await incoming('nuevo@empresa.com'))?.includes('nuevo@empresa.com'),'Talento100: corrige solo correo');
 await incoming('1');check(jiraCalls.length===3,'Talento100: creado tras confirmar');
 phone='595981123458';await incoming('Hola');await incoming('3');await incoming('No puedo acceder a mi cuenta de red');
 check((await incoming('LISTO'))?.includes('Consulta TI'),'Consulta TI: resumen sin RUC ni cédula');
 await incoming('1');check(jiraCalls.length===4,'Consulta TI: creado tras confirmar');
 phone='595981123459';await incoming('Hola');await incoming('4');await incoming('Sistema Personalizado');await incoming('otro@empresa.com');await incoming('No puedo enviar el reporte mensual');
 check((await incoming('LISTO'))?.includes('Sistema Personalizado'),'Otro sistema: resumen');
 await incoming('1');check(jiraCalls.length===5,'Otro sistema: creado tras confirmar');
 // No crear si el evento es saliente o si el asistente está desactivado.
 phone='595981123460';check(await incoming('mensaje propio',{outbound:true})===null,'No se auto-responde a mensajes propios');
 db.prepare("UPDATE settings SET value='0' WHERE name='automation_enabled'").run();
 check(await incoming('Hola')===null,'Asistente desactivado no envía mensajes');
 db.prepare("UPDATE settings SET value='1' WHERE name='automation_enabled'").run();
 phone='595981123461';
 check(await incoming('Hola',{group:true})===null,'Grupo no recibe bot');
 db.prepare('INSERT INTO settings(name,value) VALUES (?,?)').run('automation_extra_fields',JSON.stringify([{id:'f_centro123',label:'Sucursal',system:'Futura100',required:true,enabled:true}]));
 phone='595981123462';
 check((await incoming('Hola')).includes('Soporte TI'),'Saludo para campo adicional');
 check((await incoming('1')).includes('RUC'),'Futura con RUC flexible');
 check((await incoming('68547-7')).includes('inconveniente'),'RUC corto personal aceptado');
 check((await incoming('ok')).includes('Sucursal'),'Inconveniente de 2 caracteres y pregunta adicional');
 check((await incoming('Central')).includes('imagen'),'Dato adicional guardado');
 const sumExtra=await incoming('LISTO');
 check(sumExtra.includes('Sucursal: Central'),'Resumen contiene dato adicional');
 check(jiraCalls.length===5,'Extra: no crea Jira sin confirmar');
 check((await incoming('1')).includes('CW-306'),'Extra: ticket creado tras confirmar');
 // Nuevos controles: modo corto opcional, 2 datos, varios sistemas y Jira automático.
 function option(name,value){db.prepare('INSERT INTO settings(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name,value);}
 option('automation_flow_short','1');option('automation_flow_confirm','0');option('automation_flow_multi','1');
 phone='595981123463';
 check((await incoming('Hola')).includes('Futura100'),'Modo corto presenta opciones al primer mensaje');
 check((await incoming('1,2')).includes('Futura100, Talento100'),'Permite elegir varios sistemas');
 const before=jiraCalls.length;
 const quick=await incoming('El sistema no deja guardar un expediente');
 check(quick?.includes('CW-')&&jiraCalls.length===before+1,'Modo corto genera un único ticket sin LISTO ni confirmación cuando se habilitó');
 check(jiraCalls.at(-1).title.includes('expediente'),'Conserva inconveniente en Jira');
 check(await incoming('Tengo más información')===null,'Ticket abierto no dispara otro formulario');
 phone='595981123464';
 const direct=await incoming('Futura100, Talento100: No imprime el reporte');
 check(direct?.includes('CW-'),'Primer mensaje con sistema e inconveniente genera un ticket');
 option('automation_flow_start','keyword');
 phone='595981123465';
 check(await incoming('Hola')===null,'Modo por palabra clave no interrumpe chat normal');
 check((await incoming('SOPORTE'))?.includes('Soporte TI'),'Palabra SOPORTE inicia el flujo');
 option('automation_flow_confirm','1');option('automation_flow_start','first');
 phone='595981123466';await incoming('Hola');await incoming('1');
 const count=jiraCalls.length;
 check((await incoming('Mi sistema informa error de conexión'))?.includes('Resumen'),'Modo corto confirma directamente sin LISTO');
 check(jiraCalls.length===count,'Confirmación activada evita ticket prematuro');
 check((await incoming('1'))?.includes('CW-'),'Confirmación explícita crea un solo ticket');
 console.log('PASS: escenarios aislados y sin conexiones reales completados.');
})().catch(err=>{console.error(err);process.exitCode=1});
