'use strict';
/** Diagnóstico de solo lectura, sin números, textos ni secretos. */
const path=require('node:path');
const fs=require('node:fs');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..');
require('dotenv').config({path:path.join(root,'.env.local')});
const filename=path.join(root,'data','app.sqlite');
(async()=>{
 if(!fs.existsSync(filename)){console.error('[ERROR] No existe data/app.sqlite en el proyecto actual');process.exitCode=1;return;}
 let state={};
 try{const res=await fetch('http://127.0.0.1:3217/status',{
   headers:{'x-local-connector-secret':process.env.WHATSAPP_LOCAL_SECRET||''},
   signal:AbortSignal.timeout(5000)
 });if(res.ok)state=await res.json();}
 catch(e){console.error('[AVISO] Conector no disponible:',e.message);}
 const account=typeof state.accountId==='string'?state.accountId:'';
 const db=new Database(filename,{readonly:true,fileMustExist:true});
 try{
  console.log('[CONECTOR]',{connected:state.connected===true,ready:state.ready===true,version:state.version||'sin respuesta',accountValid:/^\d{5,40}@(c\.us|lid)$/.test(account)});
  const total=db.prepare('SELECT COUNT(*) n FROM cases').get().n;
  const hasAccount=db.pragma('table_info(cases)').some(c=>c.name==='account_id');
  if(!hasAccount){console.log('[DATOS] El esquema todavía no tiene account_id; se necesita la migración existente de la aplicación.');return;}
  const own=account?db.prepare("SELECT COUNT(*) n FROM cases WHERE source='whatsapp' AND account_id=?").get(account).n:0;
  const orphan=db.prepare("SELECT COUNT(*) n FROM cases WHERE source='whatsapp' AND account_id=''").get().n;
  const other=db.prepare("SELECT COUNT(*) n FROM cases WHERE source='whatsapp' AND account_id<>'' AND account_id<>?").get(account).n;
  const grouped=db.prepare("SELECT COUNT(DISTINCT phone) n FROM cases WHERE source='whatsapp' AND account_id=?").get(account).n;
  const media=db.prepare("SELECT COUNT(*) n FROM cases WHERE source='whatsapp' AND account_id=? AND media_path IS NOT NULL").get(account).n;
  console.log('[BASE DE DATOS]',{totalRows:total,currentAccountMessages:own,currentAccountChats:grouped,currentAccountMedia:media,unassignedLegacyMessages:orphan,rowsFromOtherAccount:other});
  console.log('[SEGURIDAD] No se cambió la pertenencia de ningún mensaje.');
  if(own===0&&total>0)console.log('[ATENCIÓN] La bandeja vacía puede deberse a una asociación de cuenta diferente. No reasignes los datos sin verificar la identidad.');
 }finally{db.close();}
})().catch(e=>{console.error('[ERROR] Diagnóstico:',e.message);process.exitCode=1;});
