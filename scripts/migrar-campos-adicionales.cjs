'use strict';
/** Migración aditiva e idempotente del formulario. Ejecutar con los servicios detenidos. */
const path=require('node:path');
const fs=require('node:fs');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..');
const dbPath=path.join(root,'data','app.sqlite');
if(!fs.existsSync(dbPath)){
 console.log('[OMITIDO] No existe data/app.sqlite; TicketBridge creará sus tablas al iniciar.');
 process.exit(0);
}
const db=new Database(dbPath);
try{
 const has=(table)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
 if(!has('automation_sessions')){console.log('[OMITIDO] Tabla automation_sessions todavía no creada; se creará al iniciar el asistente.');process.exit(0);}
 const columns=db.pragma('table_info(automation_sessions)');
 if(columns.some(c=>c.name==='fields_json'))console.log('[OK] fields_json ya existe; no se modificó.');
 else{db.exec('ALTER TABLE automation_sessions ADD COLUMN fields_json TEXT');console.log('[OK] Columna fields_json añadida sin borrar sesiones anteriores.');}
}finally{db.close();}
