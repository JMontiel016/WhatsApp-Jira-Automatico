import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {jiraDetails} from '@/lib/jira';
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
    db.prepare("UPDATE customer_jira_tickets SET assignee_id=?,assignee_name=?,jira_status=?,jira_status_category=?,jira_synced_at=CURRENT_TIMESTAMP WHERE id=? AND jira_key=?")
      .run(detail.assignee?.id||null,detail.assignee?.name||null,detail.status||null,detail.statusCategory||null,ticket.id,ticket.jira_key);
    updated++;
   }catch(error){errors.push(`${ticket.jira_key}: ${error instanceof Error?error.message:'Error'}`);}
  }));
 }
 return NextResponse.json({updated,total:tickets.length,errors:errors.slice(0,12)},{headers:{'Cache-Control':'no-store'}});
}
