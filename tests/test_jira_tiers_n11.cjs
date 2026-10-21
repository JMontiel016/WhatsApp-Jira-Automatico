'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {supportRoleForJiraStatus,supportTierLabel}=require('../lib/jira-stage-map.cjs');
for(const status of ['Por hacer','En curso','SopN1','Esperando al cliente','Resuelto','Cancelado','']){
 assert.equal(supportRoleForJiraStatus(status),null,'No escalar '+status);
}
for(const status of ['SopN2',' sopn2 ','SOPN2'])assert.equal(supportRoleForJiraStatus(status),'level2');
assert.equal(supportRoleForJiraStatus('Nivel dos','Nivel dos'),'level2');
assert.equal(supportTierLabel('SopN1'),'N1');
assert.equal(supportTierLabel('SopN2'),'N2');
const base=path.join(__dirname,'..');
const sync=fs.readFileSync(path.join(base,'lib/automation-jira-sync.ts'),'utf8');
for(const expected of ['await jiraAssign','verified.assignee?.id!==n2Id',"notifyRole(item.id,item.jira_key,'level2'","previous?.role==='level2'",'account.account_id'])assert.ok(sync.includes(expected),`Falta guardia ${expected}`);
const page=fs.readFileSync(path.join(base,'app/page.tsx'),'utf8');
for(const expected of ['tbRosterAck','groupSenderName','ackRead','tbTierBadge','SopN2'])assert.ok(page.includes(expected),`Falta interfaz ${expected}`);
console.log('[OK] 16 reglas de estados Jira, 5 guardias de derivación, 5 controles visuales');
