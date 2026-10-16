import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {jiraDetails} from '@/lib/jira';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// Todas las respuestas de este endpoint son JSON, incluso cuando Jira o SQLite fallan.
export async function GET(req:NextRequest){
 const key=req.nextUrl.searchParams.get('key')||'';
 const phone=req.nextUrl.searchParams.get('phone')||'';
 if(!/^CW-[0-9]+$/.test(key)||!(/^[0-9]{5,40}$/.test(phone)||/^[0-9-]{5,50}@g\.us$/.test(phone)))
  return NextResponse.json({error:'Los datos del ticket son inválidos.'},{status:400});
 try{
  const db=database();
  const existing=db.prepare("SELECT 1 FROM customer_jira_tickets WHERE phone=? AND jira_key=? UNION SELECT 1 FROM cases WHERE source='whatsapp' AND phone=? AND jira_key=? LIMIT 1").get(phone,key,phone,key);
  if(!existing)return NextResponse.json({error:'Este ticket no está relacionado con la conversación.'},{status:404});
  const detail=await jiraDetails(key);
  const localMedia=db.prepare(`SELECT DISTINCT c.id,c.media_type,c.media_name,c.media_source
    FROM cases c
    JOIN customer_ticket_messages m ON m.message_id=c.id
    JOIN customer_jira_tickets t ON t.id=m.ticket_id
    WHERE t.phone=? AND t.jira_key=? AND c.media_path IS NOT NULL ORDER BY c.id`).all(phone,key);
  const missingMedia=db.prepare(`SELECT DISTINCT c.id,c.local_time FROM cases c
    JOIN customer_ticket_messages m ON m.message_id=c.id
    JOIN customer_jira_tickets t ON t.id=m.ticket_id
    WHERE t.phone=? AND t.jira_key=? AND (c.media_path IS NULL OR c.media_path='')
    AND (c.has_media=1 OR c.media_error IS NOT NULL OR c.message LIKE '[Adjunto WhatsApp:%') ORDER BY c.id`).all(phone,key);
  return NextResponse.json({...detail,localMedia,missingMedia},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){
  console.error('[JIRA] Falló la consulta del ticket',key,e);
  return NextResponse.json({error:e instanceof Error?e.message:'No fue posible consultar Jira. Revisá la conexión del servidor.'},{status:502,headers:{'Cache-Control':'no-store'}});
 }
}
