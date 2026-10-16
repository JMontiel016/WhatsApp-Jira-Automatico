'use strict';
/**
 * TicketBridge: rescate opcional de mensajes de grupo que versiones antiguas
 * guardaron con el número del participante. No modifica mensajes vinculados
 * a tickets, no elimina registros y crea una copia SQLite consistente.
 *
 * node scripts/reagrupar-mensajes-grupos.cjs          # solo diagnóstico
 * node scripts/reagrupar-mensajes-grupos.cjs --apply  # backup + corrección
 */
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const apply = process.argv.includes('--apply');
const dbFile = path.resolve(__dirname, '..', 'data', 'app.sqlite');
const validGroupId = value => typeof value === 'string' && /^[0-9-]{5,50}@g\.us$/.test(value);

function groupFromMessageId(id) {
  if (typeof id !== 'string' || id.length > 300) return '';
  // El "remote" en un ID real: false_120363...@g.us_3EB0...(_participante)
  const match = /^(?:true|false)_([0-9-]{5,50}@g\.us)_[^\s_]{5,150}(?:_[^\s_]{3,150})?$/.exec(id);
  return match ? match[1] : '';
}
function participantFromId(id) {
  const match = /^(?:true|false)_[0-9-]{5,50}@g\.us_[^\s_]{5,150}_([0-9]{5,40}@(?:c\.us|lid))$/.exec(id || '');
  return match ? match[1].split('@')[0] : '';
}
function sourceGroup(row) {
  const fromId = groupFromMessageId(row.wa_message_id);
  if (fromId) return fromId;
  return validGroupId(row.wa_chat_id) ? row.wa_chat_id : '';
}

async function main() {
  if (!fs.existsSync(dbFile)) throw new Error('No existe data/app.sqlite. Ejecutá el script dentro del proyecto con su base de datos original.');
  const db = new Database(dbFile, {readonly: !apply, fileMustExist:true});
  try {
    const cols = new Set(db.pragma('table_info(cases)').map(c => c.name));
    for (const required of ['id','phone','source','wa_message_id','wa_chat_id','is_group','jira_key','customer','sender_name']) {
      if (!cols.has(required)) throw new Error('Falta columna '+required+'; iniciá Next.js para completar migraciones de la base de datos.');
    }
    const rows = db.prepare(`SELECT c.id,c.phone,c.customer,c.message,c.wa_message_id,c.wa_chat_id,c.is_group,c.jira_key,c.sender_name,
      EXISTS (SELECT 1 FROM customer_ticket_messages ctm WHERE ctm.message_id=c.id) AS linked
      FROM cases c WHERE c.source='whatsapp' AND (c.phone NOT LIKE '%@g.us' OR c.is_group=0)`).all();
    const profiles = new Map(db.prepare('SELECT phone,name FROM contact_profiles WHERE is_group=1 OR phone LIKE ?').all('%@g.us').map(p=>[p.phone,p.name]));
    const selected=[];
    let linked=0;
    for(const row of rows){
      if (/^\[Adjunto WhatsApp: (notification_template|gp2|notification|e2e_notification)\]/i.test(row.message||''))continue;
      const group=sourceGroup(row);
      if(!group || (row.phone===group&&row.is_group===1))continue;
      if(row.linked || row.jira_key){ linked++; continue; }
      selected.push({id:row.id,oldPhone:row.phone,group,name:profiles.get(group)||('Grupo '+group.split('@')[0]),sender:row.sender_name||participantFromId(row.wa_message_id)||null});
    }
    console.log('[GRUPOS] Mensajes identificables sin riesgo:',selected.length);
    console.log('[GRUPOS] Asociados a tickets (no modificar):',linked);
    for(const row of selected.slice(0,12))console.log('  caso #'+row.id+' · '+row.oldPhone+' → '+row.group);
    if(selected.length>12)console.log('  ... y otros',selected.length-12);
    if(!apply){ console.log('[GRUPOS] Diagnóstico solamente. Para aplicar: node scripts/reagrupar-mensajes-grupos.cjs --apply');return; }
    if(!selected.length){ console.log('[GRUPOS] No hay casos para corregir.');return; }
    const backupDir=path.resolve(__dirname, '..', 'data', 'backups');
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const backup=path.join(backupDir,'app-antes-reagrupar-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
    await db.backup(backup);
    console.log('[GRUPOS] Copia coherente creada:',backup);
    const update=db.prepare(`UPDATE cases SET phone=?,customer=?,wa_chat_id=?,is_group=1,
      sender_name=COALESCE(NULLIF(sender_name,''),?) WHERE id=? AND source='whatsapp' AND jira_key IS NULL
      AND NOT EXISTS(SELECT 1 FROM customer_ticket_messages WHERE message_id=cases.id)`);
    const tx=db.transaction((items)=>{
      let count=0;
      for(const item of items){count+=update.run(item.group,item.name,item.group,item.sender,item.id).changes;}
      return count;
    });
    const updated=tx(selected);
    console.log('[GRUPOS] Mensajes corregidos:',updated,'(archivos multimedia intactos)');
    console.log('[GRUPOS] Se conservaron',linked,'mensajes ya vinculados a tickets.');
  } finally {db.close();}
}
main().catch(err=>{console.error('[GRUPOS] ERROR:',err.message);process.exitCode=1;});
