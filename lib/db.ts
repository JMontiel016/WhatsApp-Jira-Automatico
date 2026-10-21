import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let db: Database.Database | undefined;
export function database() {
  if (db) return db;
  const dir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  db = new Database(path.join(dir,'app.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL, customer TEXT NOT NULL, message TEXT NOT NULL,
      received_at TEXT NOT NULL, local_date TEXT NOT NULL, local_time TEXT NOT NULL,
      reason TEXT NOT NULL, outside_hours INTEGER NOT NULL,
      status TEXT NOT NULL, jira_key TEXT, jira_id TEXT,
      dedupe_key TEXT NOT NULL UNIQUE, error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Migración no destructiva: distinguir los eventos reales de las simulaciones.
  const cols = db.pragma('table_info(cases)') as Array<{name:string}>;
  if (!cols.some(c => c.name === 'source')) db.exec("ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT 'simulator'");
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_tickets (
    phone TEXT PRIMARY KEY, jira_key TEXT, jira_id TEXT, status TEXT NOT NULL DEFAULT 'sending', error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  // Tickets históricos ya creados desde una fila WhatsApp se asocian con su cliente.
  db.exec(`INSERT OR IGNORE INTO conversation_tickets(phone,jira_key,jira_id,status)
    SELECT phone,jira_key,jira_id,'created' FROM cases
    WHERE source='whatsapp' AND jira_key IS NOT NULL GROUP BY phone;`);
  const mediaCols = db.pragma('table_info(cases)') as Array<{name:string}>;
  if (!mediaCols.some(c=>c.name==='media_path')) db.exec('ALTER TABLE cases ADD COLUMN media_path TEXT');
  if (!mediaCols.some(c=>c.name==='media_type')) db.exec('ALTER TABLE cases ADD COLUMN media_type TEXT');
  const attachmentCols = db.pragma('table_info(cases)') as Array<{name:string}>;
  if (!attachmentCols.some(c=>c.name==='media_name')) db.exec('ALTER TABLE cases ADD COLUMN media_name TEXT');
  if (!attachmentCols.some(c=>c.name==='media_error')) db.exec('ALTER TABLE cases ADD COLUMN media_error TEXT');
  if (!attachmentCols.some(c=>c.name==='media_source')) db.exec("ALTER TABLE cases ADD COLUMN media_source TEXT NOT NULL DEFAULT 'whatsapp'");
  if (!attachmentCols.some(c=>c.name==='has_media')) db.exec('ALTER TABLE cases ADD COLUMN has_media INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS contact_profiles (phone TEXT PRIMARY KEY, name TEXT, avatar_url TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  // Evidencia de agenda WhatsApp segregada por cuenta. No deducir de nombres o historiales.
  db.exec(`CREATE TABLE IF NOT EXISTS automation_saved_contacts (
    account_id TEXT NOT NULL, phone TEXT NOT NULL, is_saved INTEGER NOT NULL CHECK(is_saved IN (0,1)),
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,phone)
  )`);
  const directionCols = db.pragma('table_info(cases)') as Array<{name:string}>;
  if (!directionCols.some(c=>c.name==='direction')) db.exec("ALTER TABLE cases ADD COLUMN direction TEXT NOT NULL DEFAULT 'in'");
  if (!directionCols.some(c=>c.name==='wa_message_id')) db.exec('ALTER TABLE cases ADD COLUMN wa_message_id TEXT');
  if (!directionCols.some(c=>c.name==='wa_chat_id')) db.exec('ALTER TABLE cases ADD COLUMN wa_chat_id TEXT');
  const profileCols = db.pragma('table_info(contact_profiles)') as Array<{name:string}>;
  if (!profileCols.some(c=>c.name==='chat_id')) db.exec('ALTER TABLE contact_profiles ADD COLUMN chat_id TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS customer_jira_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL, jira_key TEXT, jira_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('issue','subtask')),
    parent_key TEXT, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sending',
    error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customer_ticket_messages (
    ticket_id INTEGER NOT NULL REFERENCES customer_jira_tickets(id),
    message_id INTEGER NOT NULL REFERENCES cases(id),
    PRIMARY KEY(ticket_id,message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_customer_jira_tickets_phone ON customer_jira_tickets(phone);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_jira_tickets_key ON customer_jira_tickets(jira_key) WHERE jira_key IS NOT NULL;`);
  const ticketCols=db.pragma('table_info(customer_jira_tickets)') as Array<{name:string}>;
  if(!ticketCols.some(c=>c.name==='assignee_id'))db.exec('ALTER TABLE customer_jira_tickets ADD COLUMN assignee_id TEXT');
  if(!ticketCols.some(c=>c.name==='assignee_name'))db.exec('ALTER TABLE customer_jira_tickets ADD COLUMN assignee_name TEXT');
  // Estado en Jira, separado del estado LOCAL de creación 'created'.
  if(!ticketCols.some(c=>c.name==='jira_status'))db.exec('ALTER TABLE customer_jira_tickets ADD COLUMN jira_status TEXT');
  if(!ticketCols.some(c=>c.name==='jira_status_category'))db.exec('ALTER TABLE customer_jira_tickets ADD COLUMN jira_status_category TEXT');
  if(!ticketCols.some(c=>c.name==='jira_synced_at'))db.exec('ALTER TABLE customer_jira_tickets ADD COLUMN jira_synced_at TEXT');
  if(!ticketCols.some(c=>c.name==='jira_closed_at'))db.exec('ALTER TABLE customer_jira_tickets ADD COLUMN jira_closed_at TEXT');
  // Conservar referencias de tickets creados antes de esta migración.
  db.exec(`INSERT OR IGNORE INTO customer_jira_tickets(phone,jira_key,jira_id,kind,title,status,created_at)
    SELECT phone,jira_key,jira_id,'issue','Ticket anterior '||jira_key,'created',created_at
    FROM conversation_tickets WHERE jira_key IS NOT NULL;`);
  db.exec(`INSERT OR IGNORE INTO customer_jira_tickets(phone,jira_key,jira_id,kind,title,status,created_at)
    SELECT phone,jira_key,jira_id,'issue','Ticket anterior '||jira_key,'created',created_at
    FROM cases WHERE source='whatsapp' AND jira_key IS NOT NULL;`);
  const caseInfo=db.pragma('table_info(cases)') as Array<{name:string}>;
  if(!caseInfo.some(c=>c.name==='wa_ack'))db.exec('ALTER TABLE cases ADD COLUMN wa_ack INTEGER');
  if(!caseInfo.some(c=>c.name==='is_group'))db.exec('ALTER TABLE cases ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0');
  if(!caseInfo.some(c=>c.name==='sender_name'))db.exec('ALTER TABLE cases ADD COLUMN sender_name TEXT');
  const profileInfo=db.pragma('table_info(contact_profiles)') as Array<{name:string}>;
  if(!profileInfo.some(c=>c.name==='is_group'))db.exec('ALTER TABLE contact_profiles ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS message_receipts(
    wa_message_id TEXT PRIMARY KEY, ack INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chat_preferences(
    phone TEXT PRIMARY KEY, last_read_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
    force_unread INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0
  );`);
  const chatPrefCols=db.pragma('table_info(chat_preferences)') as Array<{name:string}>;
  if(!chatPrefCols.some(c=>c.name==='favorite'))db.exec('ALTER TABLE chat_preferences ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  if(!chatPrefCols.some(c=>c.name==='remote_unread'))db.exec('ALTER TABLE chat_preferences ADD COLUMN remote_unread INTEGER NOT NULL DEFAULT 0');
  if(!chatPrefCols.some(c=>c.name==='force_unread_at'))db.exec("ALTER TABLE chat_preferences ADD COLUMN force_unread_at TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS message_flags (
    message_id INTEGER PRIMARY KEY REFERENCES cases(id),
    pinned INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS message_reactions (
    wa_message_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(wa_message_id,actor_id)
  );
  CREATE INDEX IF NOT EXISTS idx_message_reactions_wa_id ON message_reactions(wa_message_id);`);
  // Los mensajes importados antes de instalar esta mejora no se presentan todos como no leídos.
  if(!db.prepare("SELECT value FROM settings WHERE name='chat_preferences_migrated_v1'").get()){
    db.exec(`INSERT OR IGNORE INTO chat_preferences(phone,last_read_at)
      SELECT phone,MAX(received_at) FROM cases WHERE source='whatsapp' GROUP BY phone`);
    db.prepare('INSERT INTO settings(name,value) VALUES (?,?)').run('chat_preferences_migrated_v1','1');
  }
  // Identidad de WhatsApp: no mostrar conversaciones de otro número vinculado.
  const accountCols=db.pragma('table_info(cases)') as Array<{name:string}>;
  if(!accountCols.some(c=>c.name==='account_id'))db.exec("ALTER TABLE cases ADD COLUMN account_id TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS idx_cases_account ON cases(account_id,id)');
  db.exec(`CREATE TABLE IF NOT EXISTS automation_polls (
    poll_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, account_id TEXT NOT NULL,
    phone TEXT NOT NULL, answered_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES (?,?)').run('start','08:00');
  db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES (?,?)').run('end','18:00');
  return db;
}
export type CaseRecord = { id:number; phone:string; customer:string; message:string; received_at:string; local_date:string; local_time:string; reason:string; outside_hours:number; status:string; jira_key:string|null; jira_id:string|null; error:string|null };
