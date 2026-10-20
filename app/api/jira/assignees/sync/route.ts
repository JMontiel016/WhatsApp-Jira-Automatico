import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {jiraDetails} from '@/lib/jira';
import {followupDb} from '@/lib/level2-followup';
import {controlDb} from '@/lib/automation-controls';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
// Solo lectura del estado y responsable ACTUALES; nunca modificar un issue remoto.
export async function POST(r:NextRequest){
 const denied=rejectCrossOrigin(r);if(denied)return denied;
 if(process.env.ENABLE_REAL_JIRA!=='true')return NextResponse.json({error:'Jira deshabilitado'},{status:503});
 const db=database();
 const tickets=db.prepare("SELECT id,jira_key FROM customer_jira_tickets WHERE status='created' AND jira_key GLOB 'CW-[0-9]*' ORDER BY id DESC LIMIT 50").all() as Array<{id:number;jira_key:string}>;
 let updated=0;const errors:string[]=[];
 // Acceso limitado en lotes para no saturar la API de Jira.
 for(let i=0;i<tickets.length;i+=3){
  await Promise.all(tickets.slice(i,i+3).map(async ticket=>{
   try{
    const detail=await jiraDetails(ticket.jira_key);
    db.prepare("UPDATE customer_jira_tickets SET assignee_id=?,assignee_name=?,jira_status=?,jira_status_category=?,jira_closed_at=CASE WHEN ?='done' THEN COALESCE(?,jira_closed_at) ELSE NULL END,jira_synced_at=CURRENT_TIMESTAMP WHERE id=? AND jira_key=?")
      .run(detail.assignee?.id||null,detail.assignee?.name||null,detail.status||null,detail.statusCategory||null,detail.statusCategory||null,detail.resolutionDate||null,ticket.id,ticket.jira_key);
    // Estado confirmado desde Jira: En curso o finalizado detiene el recordatorio.
    // No depende de que la persona haya enviado CONFIRMO por WhatsApp.
    if(['indeterminate','done'].includes((detail.statusCategory||'').toLowerCase())){
     followupDb().prepare("UPDATE level2_followups SET state='confirmed',confirmed_at=COALESCE(confirmed_at,?),updated_at=CURRENT_TIMESTAMP WHERE jira_key=? AND state IN ('pending','sending','sent','review')")
       .run(new Date().toISOString(),ticket.jira_key);
    }
    if(['indeterminate','done'].includes((detail.statusCategory||'').toLowerCase())){
     const d=controlDb();
     d.prepare("UPDATE automation_ticket_stage SET progress=?,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND progress='pending'").run(detail.statusCategory==='done'?'finished':'in_progress',ticket.id);
     d.prepare("UPDATE automation_call_requests SET state='cancelled',reason='Jira confirmó atención o cierre',updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='pending_integration'").run(ticket.id);
    }
    updated++;
   }catch(error){errors.push(`${ticket.jira_key}: ${error instanceof Error?error.message:'Error'}`);}
  }));
 }
 return NextResponse.json({updated,total:tickets.length,errors:errors.slice(0,12)},{headers:{'Cache-Control':'no-store'}});
}
