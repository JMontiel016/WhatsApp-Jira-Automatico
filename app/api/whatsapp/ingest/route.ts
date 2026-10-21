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
import {markManualOutreach,expectBotOutgoing,consumeBotOutgoing} from '@/lib/automation-controls';
import {confirmFromLevel2} from '@/lib/level2-followup';
import {confirmSupportTicket} from '@/lib/automation-routing';
import {jiraMoveToInProgress} from '@/lib/jira';
export const runtime='nodejs';
export async function POST(request:NextRequest){
  const expected=process.env.WHATSAPP_LOCAL_SECRET || '';
  const supplied=request.headers.get('x-local-connector-secret')||'';
  if(expected.length<24 || supplied.length!==expected.length || !timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return NextResponse.json({error:'No autorizado'},{status:401});
  const parsed=z.object({eventId:z.string().min(1).max(300),accountId:z.string().min(7).max(90),waMessageId:z.string().max(300).optional(),phone:z.string().min(5).max(60),chatId:z.string().max(65).optional(),isGroup:z.boolean().optional(),isSavedContact:z.boolean().optional(),senderName:z.string().max(120).optional(),ack:z.number().int().min(-1).max(4).optional(),customer:z.string().max(120),avatarUrl:z.string().max(1500).optional(),message:z.string().trim().min(1).max(3000),receivedAt:z.string().datetime({offset:true}),historyOnly:z.boolean().optional(),outbound:z.boolean().optional(),hasMedia:z.boolean().optional(),media:z.object({mime:z.string().min(3).max(120),filename:z.string().max(180),data:z.string().max(17_000_000)}).optional(),mediaError:z.string().max(500).optional()}).safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'Mensaje inválido'},{status:400});
  const v=parsed.data; const rule=evaluate(v.receivedAt); const d=database();
  const dedupe=createHash('sha256').update('wweb:'+v.eventId).digest('hex');
  // Guardamos el JID exacto del chat (puede terminar en @lid, no siempre @c.us).
  const chatId = v.chatId && (v.isGroup ? /^[0-9-]{5,50}@g\.us$/.test(v.chatId) && v.chatId===v.phone : /^\d{5,40}@(c\.us|lid)$/.test(v.chatId) && v.chatId.split('@')[0]===v.phone) ? v.chatId : null;
  if(v.isGroup && (!chatId||v.phone!==chatId))return NextResponse.json({error:'ID de grupo inválido'},{status:400});
  // Registrar cada mensaje bajo la cuenta vinculada, no en un buzón global.
  if(!/^\d{5,40}@(c\.us|lid)$/.test(v.accountId))return NextResponse.json({error:'Cuenta de WhatsApp inválida'},{status:400});
  // Mensajería solo de lectura: cualquier mensaje fuera de horario queda pendiente.
  // La clave única del evento impide duplicar el mismo mensaje en reintentos.
  const eligible=!v.historyOnly && rule.outside && !v.outbound;
  const inserted=d.prepare('INSERT OR IGNORE INTO cases(phone,customer,message,received_at,local_date,local_time,reason,outside_hours,status,dedupe_key,source,direction,has_media,wa_chat_id,is_group,sender_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(v.phone,v.customer,v.message,v.receivedAt,rule.date,rule.hour,rule.reason,eligible?1:0,eligible?'pending':'ignored',dedupe,'whatsapp',v.outbound?'out':'in',v.hasMedia?1:0,chatId,v.isGroup?1:0,v.senderName||null);
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
  // No reasignar mensajes históricos que ya pertenecen a otra cuenta.
  d.prepare("UPDATE cases SET account_id=? WHERE dedupe_key=? AND account_id=''").run(v.accountId,dedupe);
  const ownership=d.prepare('SELECT account_id FROM cases WHERE dedupe_key=?').get(dedupe) as {account_id:string}|undefined;
  if(ownership?.account_id && ownership.account_id!==v.accountId)return NextResponse.json({error:'El mensaje pertenece a otra cuenta vinculada'},{status:409});
  // Solo el conector autenticado puede afirmar el estado real del contacto.
  // La ausencia de la propiedad significa desconocido, no 'no guardado'.
  if(!v.historyOnly&&!v.outbound&&!v.isGroup&&typeof v.isSavedContact==='boolean'){
    d.prepare(`INSERT INTO automation_saved_contacts(account_id,phone,is_saved,checked_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(account_id,phone) DO UPDATE SET is_saved=excluded.is_saved,checked_at=CURRENT_TIMESTAMP`)
      .run(v.accountId,v.phone,v.isSavedContact?1:0);
  }
  const c=d.prepare('SELECT * FROM cases WHERE dedupe_key=?').get(dedupe) as CaseRecord;
  // Todo envío real realizado por un humano (también desde el teléfono)
  // pausa el bot, aunque ya haya mensajes entrantes en la conversación.
  // Los envíos del propio bot se identifican por expectativas SHA-256 breves.
  if(v.outbound&&!v.historyOnly&&!v.isGroup&&inserted.changes===1){
    const sentByBot=consumeBotOutgoing(v.accountId,v.phone,v.message,v.receivedAt);
    if(!sentByBot&&Math.abs(Date.now()-Date.parse(v.receivedAt))<2*60*1000){
      markManualOutreach(v.accountId,v.phone);
    }
  }
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
      return NextResponse.json({status:c.status,caseId:c.id,mediaSaved:false,mediaError:msg}, {status:422});
    }
  } else if (v.mediaError && !available) {
    d.prepare('UPDATE cases SET media_error=? WHERE id=?').run(v.mediaError,c.id);
  }
  // Historial recuperado: guardar solamente. JAMÁS iniciar el bot,
  // confirmar guardias ni crear nuevos tickets por mensajes anteriores.
  if(v.historyOnly===true)return NextResponse.json({status:c.status,caseId:c.id,automationReply:null,historyOnly:true});
  // Soporte nivel 2 confirma desde su número real de WhatsApp.
  // Esta respuesta de control jamás crea tickets automáticos adicionales.
  const newAck=!v.outbound&&!v.isGroup?confirmSupportTicket(v.accountId,v.phone,v.message):null;
  const level2Ack=!!newAck||(!v.outbound&&!v.isGroup&&confirmFromLevel2(v.phone,v.accountId,v.message));
  const supportLevel2=(d.prepare("SELECT value FROM settings WHERE name='automation_level2_phone'").get() as {value:string}|undefined)?.value||'';
  if(level2Ack){
    const key=newAck||/^\s*CONFIRMO\s+(CW-\d+)\s*$/i.exec(v.message)?.[1];
    if(key)void jiraMoveToInProgress(key.toUpperCase()).then(r=>{
      if(r.changed){d.prepare("UPDATE customer_jira_tickets SET jira_status='En curso',jira_status_category='indeterminate',jira_synced_at=CURRENT_TIMESTAMP WHERE jira_key=? AND status='created'").run(key.toUpperCase());d.prepare("UPDATE automation_ticket_stage SET progress='in_progress',updated_at=CURRENT_TIMESTAMP WHERE ticket_id IN (SELECT id FROM customer_jira_tickets WHERE jira_key=?)").run(key.toUpperCase());}
      else console.warn('[JIRA] La transición a En curso no está disponible:',r.reason);
    }).catch(e=>console.warn('[JIRA] No se pudo pasar a En curso:',e));
  }
  if(level2Ack||(!v.outbound&&v.phone===supportLevel2))return NextResponse.json({status:c.status,caseId:c.id,automationReply:null,level2Confirmed:level2Ack});
  // Guardado local antes de enviar una respuesta o crear un ticket.
  let automationReply:string|null=null;
  try {
    const latest=d.prepare('SELECT * FROM cases WHERE id=?').get(c.id) as CaseRecord & {media_path?:string|null};
    automationReply=await runAutomation({message:latest,isNew:inserted.changes===1,outside:rule.outside,isGroup:!!v.isGroup,outbound:!!v.outbound,hasMedia:!!v.hasMedia,mediaReady:!!latest.media_path&&fs.existsSync(path.join(process.cwd(),'data','media',path.basename(latest.media_path))),receivedAt:v.receivedAt});
  }catch(err){console.error('[BOT] Error procesando el flujo:',err);}
  // El menú se entrega dentro de automationReply, sin enviar encuestas.
  // El apagado del bot domina una respuesta calculada simultáneamente.
  if((d.prepare("SELECT value FROM settings WHERE name='automation_enabled'").get() as {value:string}|undefined)?.value!=='1')automationReply=null;
  if(automationReply&&!v.outbound&&!v.isGroup)expectBotOutgoing(v.accountId,v.phone,automationReply);
  return NextResponse.json({automationMenu:false,status:c.status,caseId:c.id,reason:rule.reason,jiraKey:c.jira_key,automationReply,mediaSaved:Boolean(v.media&& (available||d.prepare('SELECT media_path FROM cases WHERE id=?').get(c.id)))});
}
