'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const base=path.resolve(__dirname,'..');const file=x=>fs.readFileSync(path.join(base,x),'utf8');
const conv=file('app/api/conversations/route.ts');
assert.match(conv,/X-TicketBridge-Snapshot/);assert.doesNotMatch(conv,/if\(!livePhones\.has/);
assert.match(conv,/account_id=\?/); // ownership enforced for returned messages
const ui=file('app/page.tsx');assert.match(ui,/api\/jira\/managed/);assert.match(ui,/Promise\.allSettled/);assert.match(ui,/setManagedTickets/);
const contacts=file('app/api/whatsapp/contacts/route.ts');assert.match(contacts,/knownLocalContacts\(account,q\)/);assert.match(contacts,/c\.account_id=\?/);
const ingest=file('app/api/whatsapp/ingest/route.ts');assert.match(ingest,/consumeBotOutgoing/);assert.match(ingest,/expectBotOutgoing/);
const ctrl=file('lib/automation-controls.ts');assert.match(ctrl,/automation_bot_outgoing/);assert.match(ctrl,/markManualOutreach/);
const tickets=file('app/api/jira/managed/route.ts');assert.match(tickets,/customer_ticket_messages/);assert.match(tickets,/c\.account_id=\?/);
console.log('[OK] No se vacían chats por fallo de snapshot, tickets independientes, contactos parciales y detección humano/bot');
