'use strict';
// Prueba aislada: no conecta WhatsApp, SQLite ni Jira ni envía mensajes.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../lib/automation.ts'),'utf8');
const js=ts.transpileModule(source+'\nexport const __menuTest={parseDetails,detailsPrompt,menu};',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const moduleStub={exports:{}};
new Function('require','module','exports','process',js)((id)=>{
 if(id==='./automation-text')return {AUTOMATION_TEXT_DEFAULTS:{menu:'Elegí un sistema'},AUTOMATION_SYSTEM_OPTIONS:[]};
 if(id==='./db')return {database:()=>({exec:()=>{},pragma:()=>[{name:'account_id'},{name:'correction_field'},{name:'parent_key'},{name:'kind'},{name:'texts_json'},{name:'force_enabled'}],prepare:()=>({get:()=>undefined})})};
 return {};
},moduleStub,moduleStub.exports,process);
const {parseDetails,detailsPrompt,menu}=moduleStub.exports.__menuTest;
function ruc(number){let sum=0;number.split('').reverse().forEach((d,i)=>sum+=Number(d)*(2+i%10));let dv=11-sum%11;return number+'-'+(dv===10||dv===11?0:dv)}
const goodRuc=ruc('80012345');
const tests=[
 ['Futura100',`RUC: ${goodRuc}\nEmpresa: Empresa Demo\nInconveniente: No puedo consultar el reporte`,['ruc','company','issue']],
 ['Talento100','Nombre: Persona Demo\nCédula: 1234567\nCorreo: demo@example.com\nInconveniente: No permite ingresar al portal',['name','nationalId','email','issue']],
 ['Consulta TI','Inconveniente: No funciona la impresora',['issue']],
 ['Otro sistema','Sistema: Facturación\nCorreo: user@example.com\nInconveniente: Error al acceder',['otherSystem','email','issue']]
];
for(const [name,input,fields] of tests){const parsed=parseDetails(name,input);assert(parsed.value,`${name}: ${parsed.error}`);for(const field of fields)assert(parsed.value[field],`${name}: missing ${field}`);assert(detailsPrompt(name,{}).includes('un único mensaje'));}
assert(parseDetails('Futura100','RUC: 1234-9\nEmpresa: X\nInconveniente: Error de reporte').error);
assert(parseDetails('Talento100','Nombre: Demo\nCédula: 1234567\nCorreo: malo\nInconveniente: Error de reporte').error);
assert(menu().includes('1. Futura100')&&menu().includes('4. Otro sistema'));
assert(!fs.readFileSync(path.join(__dirname,'../whatsapp/connector.cjs'),'utf8').includes('new Poll('));
console.log('[OK] Menú 1–4 en texto; no crea encuestas');
console.log('[OK] Futura100, Talento100, Consulta TI y Otro sistema: datos en un mensaje');
console.log('[OK] Validación básica de RUC y correo');
console.log('Estas pruebas no verifican conexión real con WhatsApp o Jira.');
