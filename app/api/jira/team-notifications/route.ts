import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {jiraAddTeamWatchers} from '@/lib/jira';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';export const dynamic='force-dynamic';
function db(){const d=database();d.exec(`CREATE TABLE IF NOT EXISTS automation_team_notifications (
 ticket_id INTEGER NOT NULL, role TEXT NOT NULL, account_id TEXT NOT NULL,
 status TEXT NOT NULL, error TEXT, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(ticket_id,role));`);return d;}
type Pending={ticket_id:number;role:string;account_id:string;jira_key:string;error:string|null};
function pending(){return db().prepare(`SELECT n.ticket_id,n.role,n.account_id,t.jira_key,n.error
 FROM automation_team_notifications n JOIN customer_jira_tickets t ON t.id=n.ticket_id
 WHERE n.status='pending' AND t.status='created' AND t.jira_key IS NOT NULL
 ORDER BY n.changed_at DESC LIMIT 40`).all() as Pending[];}
export async function GET(){try{return NextResponse.json({pending:pending().map(p=>({key:p.jira_key,role:p.role,error:p.error}))},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({pending:[]});}}
export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const rows=pending();let confirmed=0;let failed=0;
 // Reintento manual limitado a avisos pendientes; las confirmaciones no se vuelven a enviar.
 for(const row of rows.slice(0,12)){
  const result=await jiraAddTeamWatchers(row.jira_key,[row.account_id]);
  const error=result.errors[row.account_id]||null;
  db().prepare("UPDATE automation_team_notifications SET status=?,error=?,changed_at=CURRENT_TIMESTAMP WHERE ticket_id=? AND role=? AND status='pending'")
    .run(error?'pending':'confirmed',error,row.ticket_id,row.role);
  if(error)failed++;else confirmed++;
 }
 return NextResponse.json({confirmed,failed,pending:pending().length});
}
