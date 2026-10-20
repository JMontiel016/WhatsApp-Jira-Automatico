'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {supportRoleForJiraStatus}=require('../lib/jira-stage-map.cjs');

function scenario({status='SopN2',account='account-A',level2Id='jira-N2',assignError=false,notificationError=false}={}){
 const entries={ticket:{id:10,jira_key:'CW-456'},stageRole:'level1',jiraAssignee:'jira-N1',account,level2Id};
 let assigned=0,notified=0,stageUpdates=0;
 const db={prepare(sql){return {
  all(){ if(sql.includes('FROM customer_jira_tickets WHERE status'))return [entries.ticket]; return []; },
  get(){
   if(sql.includes('SELECT role FROM automation_ticket_stage'))return {role:entries.stageRole};
   if(sql.includes('SELECT c.account_id'))return account?{account_id:account}:undefined;
   if(sql.includes("automation_level2_id"))return level2Id?{value:level2Id}:undefined;
   throw Error('Unexpected get SQL '+sql);
  },
  run(){
   if(sql.includes('INSERT INTO automation_ticket_stage')){stageUpdates++;entries.stageRole='level2';return {changes:1};}
   return {changes:1};
  }
 };}};
 const modules={
  './automation-controls':{controlDb:()=>db},
  './jira':{
   jiraDetails:async()=>({status,statusCategory:status==='SopN2'?'indeterminate':'new',resolutionDate:null,assignee:{id:entries.jiraAssignee}}),
   jiraAssign:async(_key,id)=>{assigned++;if(assignError)throw Error('HTTP 403');entries.jiraAssignee=id;}
  },
  './automation-routing':{notifyRole:async()=>{notified++;if(notificationError)throw Error('Aviso pendiente');return {sent:1};}},
  './jira-stage-map.cjs':{supportRoleForJiraStatus}
 };
 const input=fs.readFileSync(path.join(__dirname,'../lib/automation-jira-sync.ts'),'utf8');
 const source=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={}; const context={exports,require:(name)=>{if(!modules[name])throw Error('Unexpected import '+name);return modules[name]},process:{env:{ENABLE_REAL_JIRA:'true'}},console};
 vm.runInNewContext(source,context,{timeout:1000});
 return {run:()=>exports.refreshJiraStatuses(),values:()=>({assigned,notified,stageUpdates,role:entries.stageRole})};
}
(async()=>{
 const normal=scenario({status:'Por hacer'});const a=await normal.run();assert.equal(a.escalated,0);assert.equal(normal.values().assigned,0);
 const n1=scenario({status:'SopN1'});await n1.run();assert.equal(n1.values().role,'level1');
 const n2=scenario();const once=await n2.run();assert.equal(once.escalated,1);assert.deepEqual(n2.values(),{assigned:1,notified:1,stageUpdates:1,role:'level2'});await n2.run();assert.deepEqual(n2.values(),{assigned:1,notified:1,stageUpdates:1,role:'level2'});
 const denied=scenario({assignError:true});const deniedResult=await denied.run();assert.equal(deniedResult.escalated,0);assert.equal(denied.values().notified,0);assert.equal(denied.values().role,'level1');
 const noAccount=scenario({account:''});const noAccountResult=await noAccount.run();assert.equal(noAccountResult.escalated,0);assert.equal(noAccount.values().notified,0);
 const noId=scenario({level2Id:''});const noIdResult=await noId.run();assert.equal(noIdResult.escalated,0);assert.equal(noId.values().notified,0);
 const notice=scenario({notificationError:true});const nr=await notice.run();assert.equal(nr.escalated,1);assert.equal(nr.errors.length,1);assert.equal(notice.values().role,'level2');await notice.run();assert.equal(notice.values().notified,1);
 console.log('[OK] Jira: N1 mantiene, SopN2 deriva, una sola notificación, rechazo/no-config/no-cuenta y aviso incierto');
})().catch(e=>{console.error(e);process.exitCode=1;});
