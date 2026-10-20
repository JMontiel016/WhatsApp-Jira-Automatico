import {NextRequest,NextResponse} from 'next/server';
import {followupOverview,followupDb,sendLevel2Link} from '@/lib/level2-followup';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json({items:followupOverview()},{headers:{'Cache-Control':'no-store'}});}
// Reenvío solo con confirmación humana cuando la entrega anterior fue incierta.
// Nunca repetir un POST a WhatsApp automáticamente tras un timeout.
export async function POST(r:NextRequest){
 const denied=rejectCrossOrigin(r);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(r.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const input=await r.json().catch(()=>null);
 if(!input||!/^CW-\d+$/.test(input.key)||input.confirm!=='NO_FUE_ENTREGADO')return NextResponse.json({error:'Se requiere una confirmación de verificación del envío'},{status:400});
 const d=followupDb();
 const pending=d.prepare("UPDATE level2_followups SET state='pending',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE jira_key=? AND state='review'").run(input.key);
 if(!pending.changes)return NextResponse.json({error:'El aviso no necesita un reenvío o está pendiente de confirmación'},{status:409});
 const item=d.prepare('SELECT ticket_id FROM level2_followups WHERE jira_key=?').get(input.key) as {ticket_id:number};
 const result=await sendLevel2Link(item.ticket_id);
 return NextResponse.json({ok:result.sent,error:result.reason||null});
}
