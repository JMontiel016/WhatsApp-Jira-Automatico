#!/usr/bin/env node
'use strict';
/* Verifica código, configuración mínima y servicios locales sin revelar secretos. */
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
let failures=0;
const out=(ok,title,detail='')=>{console.log((ok?'[OK] ':'[REVISAR] ')+title+(detail?' — '+detail:''));if(!ok)failures++;};
const required=['package.json','package-lock.json','app/page.tsx','app/globals.css','lib/db.ts','lib/automation.ts','lib/jira.ts','lib/jira-evidence.ts','whatsapp/connector.cjs','app/api/whatsapp/ingest/route.ts','app/api/whatsapp/pairing-qr/route.ts'];
for (const p of required)out(fs.existsSync(path.join(project,p)),p);
const pack=require(path.join(project,'package.json'));
out(Boolean(pack.scripts?.dev && pack.scripts?.whatsapp && pack.scripts?.build),'Comandos npm configurados');
try{execFileSync(process.execPath,['--check',path.join(project,'whatsapp/connector.cjs')],{stdio:'ignore'});out(true,'Sintaxis del conector');}catch{out(false,'Sintaxis del conector');}
const version=require('node:fs').readFileSync(path.join(project,'lib/whatsapp-version.ts'),'utf8').match(/WHATSAPP_CONNECTOR_VERSION\s*=\s*'([^']+)'/)?.[1]||'';
const connector=fs.readFileSync(path.join(project,'whatsapp/connector.cjs'),'utf8');
out(Boolean(version && connector.includes("version: '"+version+"'")),'Versión de Next y conector coincide',version);
const cfg=path.join(project,'.env.local');
if(fs.existsSync(cfg)){
 const conf=fs.readFileSync(cfg,'utf8');
 const match=conf.match(/^WHATSAPP_LOCAL_SECRET=(.+)$/m);
 out(Boolean(match&&match[1].trim().length>=24&& !match[1].includes('REEMPLAZAR')),'Secreto local configurado');
}else out(false,'.env.local pendiente: bash preparar.sh');
const api=['3000/api/whatsapp/status','3217/status'];
(async()=>{
 for(const a of api){
  const url='http://127.0.0.1:'+a;
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1800)});const data=await response.json();
   const connected=typeof data.connected==='boolean'?data.connected:false;
   out(response.ok && !data.error,'Servicio '+url,connected?'conectado':'sin vinculación');
  }catch{console.log('[SIN INICIAR] '+url+' (normal antes de npm run dev / npm run whatsapp)');}
 }
 console.log('\nDiagnóstico terminado. Un chequeo de sintaxis no sustituye una prueba real de WhatsApp ni Jira.');
 process.exitCode=failures?1:0;
})();
