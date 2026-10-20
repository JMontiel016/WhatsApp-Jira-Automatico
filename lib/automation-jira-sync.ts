import {controlDb} from './automation-controls';
import {jiraAssign,jiraDetails} from './jira';
import {notifyRole} from './automation-routing';
const {supportRoleForJiraStatus}=require('./jira-stage-map.cjs') as {
 supportRoleForJiraStatus:(status:string,configured?:string)=>'level2'|null
};

// El conector llama periódicamente a esta rutina. Nunca crea tickets, nunca
// mueve el estado de Jira y no envía avisos si la reasignación no fue confirmada.
let running=false;
export async function refreshJiraStatuses(){
 if(process.env.ENABLE_REAL_JIRA!=='true')return {updated:0,escalated:0,errors:[] as string[]};
 if(running)return {updated:0,escalated:0,errors:[] as string[],busy:true};
 running=true;
 let updated=0,escalated=0;
 const errors:string[]=[];
 try{
  const d=controlDb();
  const candidates=d.prepare("SELECT id,jira_key FROM customer_jira_tickets WHERE status='created' AND jira_key GLOB 'CW-[0-9]*' ORDER BY COALESCE(jira_synced_at,'') ASC LIMIT 15").all() as Array<{id:number;jira_key:string}>;
  for(const item of candidates){
   try{
    const remote=await jiraDetails(item.jira_key);
    d.prepare("UPDATE customer_jira_tickets SET jira_status=?,jira_status_category=?,jira_closed_at=CASE WHEN ?='done' THEN COALESCE(?,jira_closed_at,CURRENT_TIMESTAMP) ELSE NULL END,jira_synced_at=CURRENT_TIMESTAMP WHERE id=?")
     .run(remote.status,remote.statusCategory,remote.statusCategory,remote.resolutionDate,item.id);
    updated++;
    if(['indeterminate','done'].includes(remote.statusCategory.toLowerCase())){
     d.prepare("UPDATE automation_ticket_stage SET progress=?,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND progress='pending'")
      .run(remote.statusCategory==='done'?'finished':'in_progress',item.id);
     d.prepare("UPDATE automation_call_requests SET state='cancelled',reason='Jira ya atiende o cerró el ticket',updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='pending_integration'").run(item.id);
    }
    // Solo el estado explícito SopN2 activa la derivación; Por hacer, En curso,
    // Esperando al cliente o SopN1 dejan al responsable de Nivel 1 en su lugar.
    if(supportRoleForJiraStatus(remote.status,process.env.JIRA_N2_STATUS_NAME||'SopN2')!=='level2')continue;
    const previous=d.prepare('SELECT role FROM automation_ticket_stage WHERE ticket_id=?').get(item.id) as {role:string}|undefined;
    if(previous?.role==='level2')continue;
    const account=d.prepare(`SELECT c.account_id FROM customer_ticket_messages m
       JOIN cases c ON c.id=m.message_id WHERE m.ticket_id=? AND c.account_id<>''
       ORDER BY c.id DESC LIMIT 1`).get(item.id) as {account_id:string}|undefined;
    if(!account?.account_id){errors.push(item.jira_key+': no hay cuenta de origen verificable; no se notificó a N2');continue;}
    const n2Id=(d.prepare("SELECT value FROM settings WHERE name='automation_level2_id'").get() as {value:string}|undefined)?.value?.trim()||'';
    if(!n2Id){errors.push(item.jira_key+': configurá el usuario Jira de Soporte N2 antes de derivar');continue;}
    if(remote.assignee?.id!==n2Id){
     await jiraAssign(item.jira_key,n2Id);
     // Un 204 no basta para afirmar que Jira aceptó efectivamente el responsable.
     const verified=await jiraDetails(item.jira_key);
     if(verified.assignee?.id!==n2Id)throw Error('Jira no confirmó el nuevo responsable de Nivel 2');
    }
    const changed=d.prepare(`INSERT INTO automation_ticket_stage(ticket_id,role,progress,updated_at)
      VALUES(?,'level2','pending',CURRENT_TIMESTAMP)
      ON CONFLICT(ticket_id) DO UPDATE SET role='level2',progress='pending',updated_at=CURRENT_TIMESTAMP
      WHERE role<>'level2'`).run(item.id);
    if(changed.changes){
     escalated++;
     // Ya confirmado el cambio de asignado en Jira, se avisa SOLO al grupo N2.
     // La tabla automation_ticket_link_delivery evita avisos repetidos.
     try{await notifyRole(item.id,item.jira_key,'level2',account.account_id);}
     catch(e){errors.push(item.jira_key+': N2 asignado; aviso pendiente: '+(e instanceof Error?e.message:'Error'));}
    }
   }catch(e){errors.push(item.jira_key+': '+(e instanceof Error?e.message:'Error'));}
  }
  return {updated,escalated,errors:errors.slice(0,8)};
 }finally{running=false;}
}
