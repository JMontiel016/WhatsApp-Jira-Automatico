'use strict';
/** Diagnóstico aislado: nunca reutiliza la sesión de TicketBridge. */
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const {Client,LocalAuth}=require('whatsapp-web.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ticketbridge-qr-diagnostico-'));
const client=new Client({
 authStrategy:new LocalAuth({clientId:'comprobacion-aislada',dataPath:dir}),
 authTimeoutMs:90000,
 puppeteer:{headless:false,timeout:90000,protocolTimeout:180000,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']}
});
let finished=false,hadQR=false;
const finish=async()=>{
 if(finished)return;finished=true;
 console.log('[DIAGNOSTICO] Cerrando navegador de prueba. No se modificó la sesión principal.');
 await Promise.race([client.destroy().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,6000))]);
 try{fs.rmSync(dir,{recursive:true,force:true});}catch{}
 process.exit(0);
};
client.on('qr',()=>{hadQR=true;console.log('[QR] WhatsApp generó el código en el navegador de prueba. No lo escanees: solo verificá que se vea.');});
client.on('authenticated',()=>console.log('[AUTENTICADO] Sesión temporal; no es TicketBridge.'));
client.on('ready',()=>console.log('[LISTO] El navegador temporal terminó de cargar.'));
client.on('auth_failure',e=>console.error('[AUTENTICACION]',String(e).slice(0,350)));
client.on('loading_screen',(n,m)=>console.log('[CARGANDO]',n,String(m||'').slice(0,70)));
process.on('SIGINT',()=>{void finish();});
process.on('SIGTERM',()=>{void finish();});
const timer=setTimeout(()=>{if(!hadQR)console.error('[DIAGNOSTICO] No se recibió QR en dos minutos. Revisá la ventana Chromium y cualquier error de conexión.');void finish();},120000);
timer.unref?.();
console.log('[DIAGNOSTICO] Se abrirá una ventana de Chromium con perfil temporal en',dir);
console.log('[SEGURIDAD] Esta prueba no lee .env.local, SQLite ni .wwebjs_auth.');
client.initialize().catch(e=>{console.error('[ERROR INICIO]',e?.message||String(e));void finish();});
