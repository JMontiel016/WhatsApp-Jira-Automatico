import {syncMessageEvidenceToLinkedTickets} from '@/lib/jira-evidence';
import {NextRequest,NextResponse} from 'next/server';
import {database,CaseRecord} from '@/lib/db';
import {evaluate} from '@/lib/rules';
import {createHash,timingSafeEqual} from 'node:crypto';
import {saveRecoveredMedia} from '@/lib/media';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {runAutomation} from '@/lib/automation';
export const runtime='nodejs';
export async function POST(request:NextRequest){
  const expected=process.env.WHATSAPP_LOCAL_SECRET || '';
  const supplied=request.headers.get('x-local-connector-secret')||'';
  if(expected.length<24 || supplied.length!==expected.length || !timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return NextResponse.json({error:'No autorizado'},{status:401});
  const parsed=z.object({eventId:z.string().min(1).max(300),waMessageId:z.string().max(300).optional(),phone:z.string().min(5).max(60),chatId:z.string().max(65).optional(),isGroup:z.boolean().optional(),senderName:z.string().max(120).optional(),ack:z.number().int().min(-1).max(4).optional(),customer:z.string().max(120),avatarUrl:z.string().max(1500).optional(),message:z.string().trim().min(1).max(3000),receivedAt:z.string().datetime({offset:true}),outbound:z.boolean().optional(),hasMedia:z.boolean().optional(),media:z.object({mime:z.string().min(3).max(120),filename:z.string().max(180),data:z.string().max(17_000_000)}).optional(),mediaError:z.string().max(500).optional()}).safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'Mensaje inválido'},{status:400});
  const v=parsed.data; const rule=evaluate(v.receivedAt); const d=database();
  const dedupe=createHash('sha256').update('wweb:'+v.eventId).digest('hex');
  // Guardamos el JID exacto del chat (puede terminar en @lid, no siempre @c.us).
  const chatId = v.chatId && (v.isGroup ? /^[0-9-]{5,50}@g\.us$/.test(v.chatId) && v.chatId===v.phone : /^\d{5,40}@(c\.us|lid)$/.test(v.chatId) && v.chatId.split('@')[0]===v.phone) ? v.chatId : null;
  if(v.isGroup && (!chatId||v.phone!==chatId))return NextResponse.json({error:'ID de grupo inválido'},{status:400});
  // Mensajería solo de lectura: cualquier mensaje fuera de horario queda pendiente.
  // La clave única del evento impide duplicar el mismo mensaje en reintentos.
  const eligible=rule.outside && !v.outbound;
  const inserted = d.prepare('INSERT OR IGNORE INTO cases(phone,customer,message,received_at,local_date,local_time,reason,outside_hours,status,dedupe_key,source,direction,has_media,wa_chat_id,is_group,sender_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(v.phone,v.customer,v.message,v.receivedAt,rule.date,rule.hour,rule.reason,eligible?1:0,eligible?'pending':'ignored',dedupe,'whatsapp',v.outbound?'out':'in',v.hasMedia?1:0,chatId,v.isGroup?1:0,v.senderName||null);
  // El nombre/foto son información opcional de la sesión vinculada; no se inventan.
  const safeAvatar = v.avatarUrl && /^https:\/\/[^\s]+$/.test(v.avatarUrl) ? v.avatarUrl : null;
  if (!v.outbound) d.prepare(`INSERT INTO contact_profiles(phone,name,avatar_url,is_group) VALUES (?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET
    name=CASE WHEN excluded.name IS NOT NULL THEN excluded.name ELSE contact_profiles.name END,
    avatar_url=CASE WHEN excluded.avatar_url IS NOT NULL THEN excluded.avatar_url ELSE contact_profiles.avatar_url END,
    is_group=excluded.is_group,
    updated_at=CURRENT_TIMESTAMP`).run(v.phone, v.customer && v.customer !== 'WhatsApp '+v.phone ? v.customer : null, safeAvatar,v.isGroup?1:0);
  d.prepare('UPDATE cases SET wa_message_id=COALESCE(wa_message_id,?),wa_chat_id=COALESCE(wa_chat_id,?) WHERE dedupe_key=?').run(v.waMessageId||v.eventId,chatId,dedupe);
  if(v.outbound&&v.ack!==undefined){
    d.prepare(`INSERT INTO message_receipts(wa_message_id,ack) VALUES(?,?) ON CONFLICT(wa_message_id)
     DO UPDATE SET ack=MAX(message_receipts.ack,excluded.ack),updated_at=CURRENT_TIMESTAMP`).run(v.eventId,v.ack);
  }
  d.prepare('UPDATE cases SET wa_ack=COALESCE((SELECT ack FROM message_receipts WHERE wa_message_id=?),wa_ack) WHERE dedupe_key=?').run(v.eventId,dedupe);
  if (chatId) d.prepare(`INSERT INTO contact_profiles(phone,chat_id) VALUES (?,?)
    ON CONFLICT(phone) DO UPDATE SET chat_id=excluded.chat_id,updated_at=CURRENT_TIMESTAMP`).run(v.phone,chatId);
  if(v.hasMedia)d.prepare('UPDATE cases SET has_media=1 WHERE dedupe_key=?').run(dedupe);
  const c=d.prepare('SELECT * FROM cases WHERE dedupe_key=?').get(dedupe) as CaseRecord;
  // Un reintento conserva el mismo dedupe_key y actualiza exactamente esta fila.
  // Si la BD tiene una ruta antigua pero el archivo ya no existe, se recupera.
  const stored=(c as CaseRecord & {media_path?:string|null}).media_path;
  const available=Boolean(stored&&fs.existsSync(path.join(process.cwd(),'data','media',path.basename(stored))));
  if (v.media && !available) {
    try {saveRecoveredMedia(c.id,v.media);
      await syncMessageEvidenceToLinkedTickets(c.id).catch(e=>console.warn('[JIRA MEDIA] No se pudo verificar sincronización:',e instanceof Error?e.message:'Error'));}
    catch(err) {
      const msg=err instanceof Error?err.message:'No se pudo guardar el adjunto';
      d.prepare('UPDATE cases SET media_error=? WHERE id=?').run(msg.slice(0,450),c.id);
      console.warn('[MEDIA] Guardado fallido, caso:',c.id,msg);
      // El conector debe saber que todavía no se persistió y reintentar.
      // El bot se ejecuta después de persistir el evento y los archivos.
  // Una segunda entrega del mismo ID solamente sincroniza la evidencia.
  let automationReply:string|null=null;
  try {
    automationReply=await runAutomation({
      message:d.prepare('SELECT * FROM cases WHERE id=?').get(c.id) as typeof c,
      isNew:inserted.changes===1,outside:rule.outside,isGroup:Boolean(v.isGroup),
      outbound:Boolean(v.outbound),hasMedia:Boolean(v.hasMedia),
      mediaReady:Boolean((d.prepare('SELECT media_path FROM cases WHERE id=?').get(c.id) as {media_path:string|null}).media_path),
      receivedAt:v.receivedAt
    });
  } catch(error) {
    console.error('[BOT] Error al procesar conversación:',error);
  }
  return NextResponse.json({status:c.status,caseId:c.id,mediaSaved:false,mediaError:msg}, {status:422});
    }
  } else if (v.mediaError && !available) {
    d.prepare('UPDATE cases SET media_error=? WHERE id=?').run(v.mediaError,c.id);
  }
  return NextResponse.json({status:c.status,caseId:c.id,reason:rule.reason,jiraKey:c.jira_key,automationReply,mediaSaved:Boolean(v.media&& (available||d.prepare('SELECT media_path FROM cases WHERE id=?').get(c.id)))});
}
