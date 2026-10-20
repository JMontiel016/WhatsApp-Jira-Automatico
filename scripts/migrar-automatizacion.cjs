'use strict';
const fs=require('node:fs');const path=require('node:path');const Database=require('better-sqlite3');
const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.name!=='ticketwhatsapp')throw Error('Ejecutar desde la carpeta TicketWhatsapp correcta');
const dbPath=path.join(root,'data','app.sqlite');
if(!fs.existsSync(dbPath))throw Error('No existe data/app.sqlite; verifique la ruta del proyecto antes de migrar');
(async()=>{
 const d=new Database(dbPath);d.pragma('journal_mode = WAL');
 const folder=path.resolve(root,'..','Respaldos_TicketWhatsapp');fs.mkdirSync(folder,{recursive:true});
 const backup=path.join(folder,'app-antes-automatizacion-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
 try{
  await d.backup(backup);
  const sql=fs.readFileSync(path.join(root,'migraciones','20261017_automatizacion.sql'),'utf8');
  d.exec(sql);
  const fields=d.pragma('table_info(customer_jira_tickets)');
  if(!fields.some(f=>f.name==='jira_closed_at'))d.exec('ALTER TABLE customer_jira_tickets ADD COLUMN jira_closed_at TEXT');
  const cases=d.pragma('table_info(cases)');
  if(!cases.some(f=>f.name==='account_id'))d.exec("ALTER TABLE cases ADD COLUMN account_id TEXT NOT NULL DEFAULT ''");
  console.log('[OK] Migración aditiva aplicada; respaldo:',backup);
 }finally{d.close();}
})().catch(e=>{console.error('[ERROR]',e.message);process.exitCode=1});
