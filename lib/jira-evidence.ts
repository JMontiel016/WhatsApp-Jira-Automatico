import {database} from '@/lib/db';
import {jiraAttach,jiraDetails} from '@/lib/jira';
import fs from 'node:fs';
import path from 'node:path';

// SOLO mensajes que ya pertenecen al ticket. Nunca crea tickets ni añade
// evidencias de otra conversación. "review" evita reintentos a ciegas cuando
// Jira no confirma un POST: un retry automático podría duplicar el archivo.
function deliveryTable(){
 const db=database();
 db.exec(`CREATE TABLE IF NOT EXISTS jira_media_deliveries (
   jira_key TEXT NOT NULL,
   message_id INTEGER NOT NULL,
   media_path TEXT NOT NULL,
   state TEXT NOT NULL CHECK(state IN ('sending','uploaded','review')),
   detail TEXT,
   changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
   PRIMARY KEY(jira_key,message_id,media_path)
 )`);
 return db;
}
type FileRow={id:number;phone:string;media_path:string|null;media_name:string|null;media_type:string|null;media_source:string|null};
type Delivery={state:string;detail:string|null};
export type EvidenceResult={uploaded:number;already:number;pending:number;errors:string[]};
export async function syncTicketEvidence(key:string,messageIds:number[],manualRetry=false):Promise<EvidenceResult>{
 const result:EvidenceResult={uploaded:0,already:0,pending:0,errors:[]};
 if(!/^CW-[0-9]+$/.test(key))return {...result,errors:['Clave Jira inválida']};
 const db=deliveryTable();
 const ids=[...new Set(messageIds)].filter(id=>Number.isSafeInteger(id)&&id>0).slice(0,500);
 if(!ids.length)return result;
 const query=`SELECT c.id,c.phone,c.media_path,c.media_name,c.media_type,c.media_source
 FROM cases c INNER JOIN customer_ticket_messages l ON l.message_id=c.id
 INNER JOIN customer_jira_tickets t ON t.id=l.ticket_id
 WHERE t.jira_key=? AND t.status='created' AND c.id IN (${ids.map(()=>'?').join(',')})
 ORDER BY c.id`;
 const rows=db.prepare(query).all(key,...ids) as FileRow[];
 const files=rows.filter(r=>{
  if(!(r.media_path&&r.media_type))return false;
  const type=(r.media_type||'').toLowerCase();
  const name=(r.media_name||'').toLowerCase();
  if(type.startsWith('audio/'))return false;
  if(/\.(ogg|opus|mp3|m4a|wav|aac)$/i.test(name))return false;
  return true;
 });
 if(!files.length)return result;
 // Consultar archivos de Jira antes de reintentar, incluidos los que pudieran
 // haberse subido antes de instalar este ajuste.
 let remote:Set<string>;
 try{
  const existing=await jiraDetails(key);
  remote=new Set(existing.attachments.map(a=>a.filename));
 }catch(e){
  result.errors.push('No se verificaron los adjuntos existentes en Jira: '+(e instanceof Error?e.message:'Error'));
  return result;
 }
 for(const row of files){
  const filename=path.basename(row.media_path!);
  const filepath=path.join(process.cwd(),'data','media',filename);
  const uploadName=`${row.media_source==='manual'?'evidencia-importada':'whatsapp'}-${row.id}-${(row.media_name||filename).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,130)}`;
  const prior=db.prepare('SELECT state,detail FROM jira_media_deliveries WHERE jira_key=? AND message_id=? AND media_path=?').get(key,row.id,filename) as Delivery|undefined;
  if(remote.has(uploadName)){
   db.prepare(`INSERT INTO jira_media_deliveries(jira_key,message_id,media_path,state,detail) VALUES (?,?,?,'uploaded',NULL)
   ON CONFLICT(jira_key,message_id,media_path) DO UPDATE SET state='uploaded',detail=NULL,changed_at=CURRENT_TIMESTAMP`).run(key,row.id,filename);
   result.already++;continue;
  }
  if(prior?.state==='uploaded'){
   // No crear duplicados si Jira devuelve lista incompleta o atrasada.
   result.already++;continue;
  }
  if(prior && !manualRetry){
   result.pending++;
   if(prior.state==='review')result.errors.push(`Archivo #${row.id}: envío anterior sin confirmar; revisá Jira antes de reintentar.`);
   continue;
  }
  let bytes:Buffer;
  try{
   bytes=fs.readFileSync(filepath);
   if(bytes.length===0||bytes.length>12*1024*1024)throw new Error('Tamaño de archivo inválido');
  }catch(e){result.errors.push(`Archivo #${row.id}: no está disponible localmente`);continue;}
  // Reserva ANTES del POST. Dos peticiones simultáneas no deben duplicarlo.
  const lock=prior?.state==='review'&&manualRetry
    ?db.prepare(`UPDATE jira_media_deliveries SET state='sending',detail=NULL,changed_at=CURRENT_TIMESTAMP WHERE jira_key=? AND message_id=? AND media_path=? AND state='review'`).run(key,row.id,filename)
    :db.prepare(`INSERT OR IGNORE INTO jira_media_deliveries(jira_key,message_id,media_path,state) VALUES (?,?,?,'sending')`).run(key,row.id,filename);
  if(!lock.changes){result.pending++;continue;}
  try{
   const uploaded=await jiraAttach(key,[{id:row.id,filename:uploadName,mime:row.media_type!,data:bytes}]);
   if(uploaded.uploaded!==1)throw new Error(uploaded.errors.join(' / ')||'Jira no confirmó la subida');
   db.prepare(`UPDATE jira_media_deliveries SET state='uploaded',detail=NULL,changed_at=CURRENT_TIMESTAMP WHERE jira_key=? AND message_id=? AND media_path=?`).run(key,row.id,filename);
   remote.add(uploadName);result.uploaded++;
   console.log('[JIRA MEDIA] Adjunto confirmado:',key,'mensaje local #'+row.id);
  }catch(e){
   const error=(e instanceof Error?e.message:'Jira no confirmó el adjunto').slice(0,400);
   db.prepare(`UPDATE jira_media_deliveries SET state='review',detail=?,changed_at=CURRENT_TIMESTAMP WHERE jira_key=? AND message_id=? AND media_path=?`).run(error,key,row.id,filename);
   result.errors.push(`Archivo #${row.id}: ${error}`);
   console.warn('[JIRA MEDIA] Confirmación pendiente:',key,'mensaje local #'+row.id);
  }
 }
 return result;
}
export async function syncMessageEvidenceToLinkedTickets(messageId:number):Promise<EvidenceResult>{
 const out:EvidenceResult={uploaded:0,already:0,pending:0,errors:[]};
 if(!Number.isSafeInteger(messageId)||messageId<=0)return out;
 const keys=database().prepare(`SELECT DISTINCT t.jira_key FROM customer_jira_tickets t
 INNER JOIN customer_ticket_messages m ON m.ticket_id=t.id
 WHERE m.message_id=? AND t.status='created' AND t.jira_key IS NOT NULL`).all(messageId) as Array<{jira_key:string}>;
 for(const item of keys){
  const r=await syncTicketEvidence(item.jira_key,[messageId]);
  out.uploaded+=r.uploaded;out.already+=r.already;out.pending+=r.pending;out.errors.push(...r.errors);
 }
 return out;
}
