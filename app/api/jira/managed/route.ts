import {NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {linkedAccount} from '@/lib/active-account';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 const account=await linkedAccount();
 if(!account)return NextResponse.json([],{headers:{'Cache-Control':'no-store'}});
 const d=database();
 // Un ticket debe tener vinculación exacta con un mensaje de la cuenta, o
 // provenir de un teléfono que nunca tuvo mensajes de otra cuenta vinculada.
 const records=d.prepare(`SELECT t.*,t.phone AS ownerPhone,
 COALESCE(NULLIF(p.name,''),t.phone) AS ownerName
 FROM customer_jira_tickets t
 LEFT JOIN contact_profiles p ON p.phone=t.phone
 WHERE t.status='created' AND t.jira_key IS NOT NULL
 AND (
  EXISTS(SELECT 1 FROM customer_ticket_messages m JOIN cases c ON c.id=m.message_id
         WHERE m.ticket_id=t.id AND c.account_id=?)
  OR EXISTS(SELECT 1 FROM cases c WHERE c.account_id=? AND c.jira_key=t.jira_key)
  OR (NOT EXISTS(SELECT 1 FROM customer_ticket_messages m WHERE m.ticket_id=t.id)
      AND EXISTS(SELECT 1 FROM cases c WHERE c.account_id=? AND c.source='whatsapp' AND c.phone=t.phone)
      AND NOT EXISTS(SELECT 1 FROM cases c WHERE c.phone=t.phone AND c.source='whatsapp'
          AND c.account_id<>'' AND c.account_id<>?))
 ) ORDER BY t.id DESC LIMIT 500`).all(account,account,account,account);
 return NextResponse.json(records,{headers:{'Cache-Control':'no-store'}});
}
