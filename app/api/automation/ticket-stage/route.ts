import {NextRequest,NextResponse} from 'next/server';
import {rejectCrossOrigin} from '@/lib/security';
import {controlDb,type SupportRole} from '@/lib/automation-controls';
import {notifyRole,ticketHistory} from '@/lib/automation-routing';
import {jiraAssign,jiraDetails,jiraMoveToInProgress} from '@/lib/jira';
import {linkedAccount} from '@/lib/active-account';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){const account=await linkedAccount();if(!account)return NextResponse.json({error:'WhatsApp no conectado'},{status:503});const d=controlDb();const tickets=d.prepare("SELECT t.id,t.jira_key,t.kind,COALESCE(s.role,'level1') AS role,COALESCE(s.progress,'pending') AS progress FROM customer_jira_tickets t LEFT JOIN automation_ticket_stage s ON s.ticket_id=t.id WHERE t.status='created' AND t.jira_key IS NOT NULL AND EXISTS(SELECT 1 FROM customer_ticket_messages m JOIN cases c ON c.id=m.message_id WHERE m.ticket_id=t.id AND c.account_id=?) ORDER BY t.id DESC LIMIT 100").all(account) as Array<{id:number}>;const ids=new Set(tickets.map(x=>x.id));const history=ticketHistory();return NextResponse.json({tickets,notifications:(history.notifications as Array<{ticket_id:number}>).filter(x=>ids.has(x.ticket_id)),stages:(history.stages as Array<{ticket_id:number}>).filter(x=>ids.has(x.ticket_id))},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 const parsed=z.object({ticketId:z.number().int().positive(),role:z.enum(['level1','level2','manager']),progress:z.enum(['pending','in_progress','finished']).default('pending')}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Nivel o estado inválido'},{status:400});
 const account=await linkedAccount();if(!account)return NextResponse.json({error:'Cuenta de WhatsApp no conectada'},{status:503});
 const {ticketId,role,progress}=parsed.data;const d=controlDb();
 const item=d.prepare("SELECT t.jira_key,c.account_id FROM customer_jira_tickets t JOIN customer_ticket_messages m ON m.ticket_id=t.id JOIN cases c ON c.id=m.message_id WHERE t.id=? AND t.status='created' AND t.jira_key IS NOT NULL ORDER BY c.id LIMIT 1").get(ticketId) as {jira_key:string;account_id:string}|undefined;
 if(!item||item.account_id!==account)return NextResponse.json({error:'Ticket confirmado no encontrado en esta cuenta'},{status:404});
 // No almacenar un estado Jira inventado. La transición debe ser real y comprobada.
 if(progress!=='pending'){
  if(process.env.ENABLE_REAL_JIRA!=='true')return NextResponse.json({error:'No se puede validar el estado mientras Jira está deshabilitado'},{status:503});
  try{
   const remote=await jiraDetails(item.jira_key);
   if(progress==='finished'&&remote.statusCategory!=='done')return NextResponse.json({error:'Finalizá primero el ticket en Jira. Su estado todavía no es Finalizado.'},{status:409});
   if(progress==='in_progress'&&!['indeterminate','done'].includes(remote.statusCategory)){
    const moved=await jiraMoveToInProgress(item.jira_key);
    if(!moved.changed)return NextResponse.json({error:moved.reason||'Transición no disponible en Jira'},{status:409});
   }
  }catch(e){return NextResponse.json({error:'No se pudo verificar el estado real en Jira: '+(e instanceof Error?e.message:'Error')},{status:502});}
 }
 const id=(d.prepare("SELECT value FROM settings WHERE name=?").get('automation_'+role+'_id') as {value:string}|undefined)?.value||'';
 if(id&&process.env.ENABLE_REAL_JIRA==='true'&&role!=='manager'){
  try{await jiraAssign(item.jira_key,id);}catch(error){return NextResponse.json({error:'Jira no confirmó la asignación: '+(error instanceof Error?error.message:'Error')},{status:502});}
 }
 const previous=d.prepare('SELECT role,progress FROM automation_ticket_stage WHERE ticket_id=?').get(ticketId) as {role:string;progress:string}|undefined;
 d.prepare(`INSERT INTO automation_ticket_stage(ticket_id,role,progress,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
 ON CONFLICT(ticket_id) DO UPDATE SET role=excluded.role,progress=excluded.progress,updated_at=CURRENT_TIMESTAMP`).run(ticketId,role,progress);
 if(progress!=='pending')d.prepare("UPDATE automation_call_requests SET state='cancelled',reason='Atención confirmada o ticket finalizado',updated_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND state='pending_integration'").run(ticketId);
 const changed=previous?.role!==role;
 const notification=changed?await notifyRole(ticketId,item.jira_key,role as SupportRole,item.account_id):null;
 return NextResponse.json({ok:true,changed,notification});
}
