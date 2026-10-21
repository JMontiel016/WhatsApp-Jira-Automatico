#!/usr/bin/env node
'use strict';
/** Ejecutar con npm run whatsapp DETENIDO. NO toca ni elimina la sesión real. */
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
let Client,LocalAuth;
try {({Client,LocalAuth}=require('whatsapp-web.js'));}
catch(e){console.error('[ERROR] whatsapp-web.js no instalado:',e.message);process.exit(1)}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ticketbridge-qr-aislado-'));
const client=new Client({authStrategy:new LocalAuth({clientId:'diagnostico',dataPath:temp}),
  authTimeoutMs:80000, qrMaxRetries:0,
  puppeteer:{headless:true,timeout:60000,protocolTimeout:90000,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']}});
let done=false;
let timeout;
let complete;
const finished=new Promise(resolve=>{complete=resolve});
function finish(message,exit=0){if(done)return;done=true;process.exitCode=exit;console.log(message);complete()}
client.on('qr',()=>finish('[OK] whatsapp-web.js GENERÓ QR con un perfil temporal. El perfil real podría estar bloqueado; no lo borres. No escanees este QR de diagnóstico.'));
client.on('authenticated',()=>finish('[OK] Se autenticó el perfil temporal (inesperado en diagnóstico).'));
client.on('auth_failure',e=>finish('[ERROR] Autenticación: '+String(e).slice(0,200),1));
client.on('disconnected',e=>{if(!done)finish('[ERROR] Se desconectó antes del QR: '+String(e).slice(0,200),1)});
(async()=>{
 console.log('[DIAGNOSTICO] Sesión temporal separada. Nunca modifica data/.wwebjs_auth.');
 timeout=setTimeout(()=>finish('[ERROR] No llegó QR durante 90 segundos.',1),90000);
 void Promise.resolve().then(()=>client.initialize())
  .then(()=>{if(!done)finish('[INFO] Inicialización terminó sin emitir un QR.')},e=>finish('[ERROR] '+String(e?.message||e).slice(0,400),1));
 await finished;
})().catch(e=>finish('[ERROR] '+String(e?.message||e).slice(0,400),1)).finally(async()=>{
 clearTimeout(timeout);
 try{await Promise.race([client.destroy(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('cierre lento')),5000))]);}
 catch {try{client.pupBrowser?.process()?.kill('SIGTERM');}catch{}}
 try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
});
// Mantener proceso vivo hasta que haya QR o error, independientemente de initialize().
