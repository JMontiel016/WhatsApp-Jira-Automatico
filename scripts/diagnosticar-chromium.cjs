#!/usr/bin/env node
'use strict';
/** Diagnóstico sin sesión: NO lee ni modifica .wwebjs_auth ni envía mensajes. */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
let puppeteer;
try {puppeteer = require('puppeteer');}
catch (error) {
 console.error('[ERROR] Puppeteer no está disponible:', String(error.message||error));
 console.error('Ejecutá este script en la carpeta principal del proyecto, después de npm ci.');
 process.exit(1);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(),'ticketbridge-chromium-'));
let browser = null;
const abort = setTimeout(() => {
 console.error('[ERROR] Chromium no finalizó la prueba en 75 segundos.');
 if (browser) {try {browser.process()?.kill('SIGTERM');}catch{}}
 process.exitCode = 2;
},75000);
(async () => {
 try {
  console.log('[DIAGNOSTICO] Probando Chromium con un perfil TEMPORAL, sin sesión WhatsApp.');
  console.log('[DIAGNOSTICO] No se abrirá ninguna ventana; el QR final se mostrará en TicketBridge.');
  browser=await puppeteer.launch({headless:true,userDataDir:root,protocolTimeout:30000,timeout:30000,
   args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  console.log('[OK] Chromium se inició.');
  const page=await browser.newPage();
  await page.goto('https://web.whatsapp.com/',{waitUntil:'domcontentloaded',timeout:30000});
  console.log('[OK] Se pudo abrir web.whatsapp.com. Página:',new URL(page.url()).hostname);
  console.log('[INFO] Esto NO prueba que whatsapp-web.js pueda inyectar su código.');
 }catch(error){
  process.exitCode=1;
  console.error('[ERROR]',String(error?.message||error).slice(0,800));
 }finally{
  clearTimeout(abort);
  if(browser){try{await Promise.race([browser.close(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('close timeout')),5000))]);}
    catch{try{browser.process()?.kill('SIGTERM');}catch{}}}
  try{fs.rmSync(root,{recursive:true,force:true});}catch{}
 }
})().catch(e=>{console.error('[ERROR]',e?.message||e);process.exitCode=1;});
