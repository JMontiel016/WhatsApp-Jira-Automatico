-- Migración aditiva/idempotente. No borrar ni actualizar mensajes, evidencias, sesiones o tickets.
CREATE TABLE IF NOT EXISTS automation_contact_rules(
 account_id TEXT NOT NULL,phone TEXT NOT NULL,excluded INTEGER NOT NULL DEFAULT 0,
 override_mode TEXT NOT NULL DEFAULT 'default' CHECK(override_mode IN ('default','enabled','disabled')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(account_id,phone)
);
CREATE TABLE IF NOT EXISTS automation_support_staff(
 id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('level1','level2','manager')),
 phone TEXT NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,
 notify INTEGER NOT NULL DEFAULT 1,call_enabled INTEGER NOT NULL DEFAULT 0,
 followup INTEGER NOT NULL DEFAULT 1,minutes INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(account_id,role,phone)
);
CREATE TABLE IF NOT EXISTS automation_ticket_stage(
 ticket_id INTEGER PRIMARY KEY,role TEXT NOT NULL DEFAULT 'level1',
 progress TEXT NOT NULL DEFAULT 'pending',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS automation_ticket_link_delivery(
 ticket_id INTEGER NOT NULL,staff_id INTEGER NOT NULL,role TEXT NOT NULL,
 link TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'sending',error TEXT,wa_message_id TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(ticket_id,staff_id,role)
);
CREATE TABLE IF NOT EXISTS automation_call_requests(
 ticket_id INTEGER NOT NULL,staff_id INTEGER NOT NULL,state TEXT NOT NULL,
 reason TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,voice_text TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(ticket_id,staff_id)
);

CREATE TABLE IF NOT EXISTS automation_ticket_ack(ticket_id INTEGER PRIMARY KEY,staff_id INTEGER NOT NULL,confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
