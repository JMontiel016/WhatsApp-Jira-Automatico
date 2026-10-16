import {NextRequest,NextResponse} from 'next/server';
import {database,CaseRecord} from '@/lib/db';
import {evaluate} from '@/lib/rules';
import {createHash,timingSafeEqual} from 'node:crypto';
import {saveRecoveredMedia} from '@/lib/media';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(request:NextRequest){
  const expected=process.env.WHATSAPP_LOCAL_SECRET || '';
  const supplied=request.headers.get('x-local-connector-secret')||'';
  if(expected.length<24 || supplied.length!==expected.length || !timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return NextResponse.json({error:'No autorizado'},{status:401});
  const parsed=z.object({eventId:z.string().min(1).max(300),phone:z.string().min(5).max(40),chatId:z.string().max(50).optional(),customer:z.string().max(120),avatarUrl:z.string().max(1500).optional(),message:z.string().trim().min(1).max(3000),receivedAt:z.string().datetime({offset:true}),outbound:z.boolean().optional(),hasMedia:z.boolean().optional(),media:z.object({mime:z.string().min(3).max(120),filename:z.string().max(180),data:z.string().max(17_000_000)}).optional(),mediaError:z.string().max(500).optional()}).safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'Mensaje inválido'},{status:400});
  const v=parsed.data; const rule=evaluate(v.receivedAt); const d=database();
  const dedupe=createHash('sha256').update('wweb:'+v.eventId).digest('hex');
  // Guardamos el JID exacto del chat (puede terminar en @lid, no siempre @c.us).
  const chatId = v.chatId && /^\d{5,40}@(c\.us|lid)$/.test(v.chatId) && v.chatId.split('@')[0]===v.phone ? v.chatId : null;
  // Mensajería solo de lectura: cualquier mensaje fuera de horario queda pendiente.
  // La clave única del evento impide duplicar el mismo mensaje en reintentos.
  const eligible=rule.outside && !v.outbound;
  d.prepare('INSERT OR IGNORE INTO cases(phone,customer,message,received_at,local_date,local_time,reason,outside_hours,status,dedupe_key,source,direction,has_media,wa_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(v.phone,v.customer,v.message,v.receivedAt,rule.date,rule.hour,rule.reason,eligible?1:0,eligible?'pending':'ignored',dedupe,'whatsapp',v.outbound?'out':'in',v.hasMedia?1:0,chatId);
  // El nombre/foto son información opcional de la sesión vinculada; no se inventan.
  const safeAvatar = v.avatarUrl && /^https:\/\/[^\s]+$/.test(v.avatarUrl) ? v.avatarUrl : null;
  if (!v.outbound) d.prepare(`INSERT INTO contact_profiles(phone,name,avatar_url) VALUES (?,?,?)
    ON CONFLICT(phone) DO UPDATE SET
    name=CASE WHEN excluded.name IS NOT NULL THEN excluded.name ELSE contact_profiles.name END,
    avatar_url=CASE WHEN excluded.avatar_url IS NOT NULL THEN excluded.avatar_url ELSE contact_profiles.avatar_url END,
    updated_at=CURRENT_TIMESTAMP`).run(v.phone, v.customer && v.customer !== 'WhatsApp '+v.phone ? v.customer : null, safeAvatar);
  d.prepare('UPDATE cases SET wa_message_id=COALESCE(wa_message_id,?),wa_chat_id=COALESCE(wa_chat_id,?) WHERE dedupe_key=?').run(v.eventId,chatId,dedupe);
  if (chatId) d.prepare(`INSERT INTO contact_profiles(phone,chat_id) VALUES (?,?)
    ON CONFLICT(phone) DO UPDATE SET chat_id=excluded.chat_id,updated_at=CURRENT_TIMESTAMP`).run(v.phone,chatId);
  if(v.hasMedia)d.prepare('UPDATE cases SET has_media=1 WHERE dedupe_key=?').run(dedupe);
  const c=d.prepare('SELECT * FROM cases WHERE dedupe_key=?').get(dedupe) as CaseRecord;
  if (v.media && !(c as CaseRecord & {media_path?:string}).media_path) {
    try{saveRecoveredMedia(c.id,v.media);}
    catch(err){
      const msg=err instanceof Error?err.message:'No se pudo guardar el adjunto';
      d.prepare('UPDATE cases SET media_error=? WHERE id=?').run(msg,c.id);
      console.warn('[MEDIA]',msg);
    }
  } else if (v.mediaError && !(c as CaseRecord & {media_path?:string}).media_path) {
    d.prepare('UPDATE cases SET media_error=? WHERE id=?').run(v.mediaError,c.id);
  }
  return NextResponse.json({status:c.status,caseId:c.id,reason:rule.reason,jiraKey:c.jira_key});
}
