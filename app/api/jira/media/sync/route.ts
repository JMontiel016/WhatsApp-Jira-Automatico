import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {syncTicketEvidence} from '@/lib/jira-evidence';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 const denied=rejectCrossOrigin(request);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const input=await request.json().catch(()=>null);
 const phone=input?.phone,key=input?.key;
 if(typeof phone!=='string'||!(/^[0-9]{5,40}$/.test(phone)||/^[0-9-]{5,50}@g\.us$/.test(phone))||typeof key!=='string'||!/^CW-[0-9]+$/.test(key))return NextResponse.json({error:'Datos inválidos'},{status:400});
 const db=database();
 const valid=db.prepare("SELECT id FROM customer_jira_tickets WHERE phone=? AND jira_key=? AND status='created'").get(phone,key);
 if(!valid)return NextResponse.json({error:'Ticket no relacionado con la conversación'},{status:404});
 const ids=(db.prepare(`SELECT c.id FROM cases c INNER JOIN customer_ticket_messages m ON m.message_id=c.id
  INNER JOIN customer_jira_tickets t ON t.id=m.ticket_id
  WHERE t.phone=? AND t.jira_key=? AND c.media_path IS NOT NULL`).all(phone,key) as Array<{id:number}>).map(m=>m.id);
 const result=await syncTicketEvidence(key,ids,true);
 return NextResponse.json({ok:true,...result});
}
