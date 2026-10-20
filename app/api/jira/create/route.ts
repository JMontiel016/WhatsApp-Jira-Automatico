import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {database,CaseRecord} from '@/lib/db';
import {jiraCreate} from '@/lib/jira';
import {syncTicketEvidence} from '@/lib/jira-evidence';
import fs from 'node:fs';
import path from 'node:path';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export async function POST(r:NextRequest){
  const denied=rejectCrossOrigin(r);if(denied)return denied;
  const p=z.object({id:z.number().int().positive().optional(),phone:z.string().min(5).max(60).optional(),messageIds:z.array(z.number().int().positive()).min(1).max(500).optional(),title:z.string().trim().min(5).max(180).optional(),customer:z.string().trim().max(120).optional(),kind:z.enum(['issue','subtask']).optional(),parentKey:z.string().regex(/^CW-[0-9]+$/).optional(),system:z.enum(['Futura100','Talento100','Otros sistemas']).optional(),assigneeId:z.string().min(4).max(160).optional(),assigneeName:z.string().trim().max(120).optional(),allowMissingEvidence:z.boolean().optional(),allowUnconfirmedJira:z.boolean().optional()}).refine(v=>!!v.id!==!!v.phone).safeParse(await r.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'ID inválido'},{status:400});
  const d=database();
  if(p.data.phone){
    const phone=p.data.phone;
    const mode=p.data.kind||'issue';
    if(mode==='subtask'&&!p.data.parentKey)return NextResponse.json({error:'Seleccioná el ticket padre para la subtarea'},{status:400});
    const subject=p.data.title?.trim();if(!subject)return NextResponse.json({error:'Escribí el tema del inconveniente'},{status:400});
    const dbClient=d.prepare('SELECT name FROM contact_profiles WHERE phone=?').get(phone) as {name:string|null}|undefined;
    const fallbackName=(dbClient?.name||'').trim();
    const givenName=(p.data.customer||'').trim();
    const customerName=givenName||(!/^(WhatsApp\s+\S+|Contacto sin nombre)$/i.test(fallbackName)?fallbackName:'');
    if(!customerName)return NextResponse.json({error:'Ingresá el nombre del cliente antes de crear el ticket.'},{status:400});
    const titlePrefix=customerName+' - ';
    const title=(subject.toLowerCase().startsWith(titlePrefix.toLowerCase())?subject:titlePrefix+subject).slice(0,240);
    const messages=d.prepare("SELECT * FROM cases WHERE phone=? AND source='whatsapp' ORDER BY received_at ASC,id ASC").all(phone) as CaseRecord[];
    const ids=p.data.messageIds||[];
    const chosen=messages.filter(m=>ids.includes(m.id));
    if(!ids.length||chosen.length!==new Set(ids).size)return NextResponse.json({error:'Seleccioná mensajes válidos de esta conversación'},{status:400});
    // La fecha y la pertenencia a esta conversación se validan por ID/phone.
    // Reutilizar un mismo mensaje en VARIOS tickets o subtareas es una decisión explícita del usuario.
    // Una creación sin confirmar se mantiene visible; nunca generar posibles duplicados sin aceptación explícita.
    const pending=d.prepare("SELECT id,status,title,created_at FROM customer_jira_tickets WHERE phone=? AND status IN ('sending','review') ORDER BY id DESC LIMIT 1").get(phone) as {id:number;status:string;title:string;created_at:string}|undefined;
    if(pending&&!p.data.allowUnconfirmedJira)return NextResponse.json({
      code:'UNCONFIRMED_JIRA',
      error:`Hay una creación anterior sin confirmar (${pending.status}, #${pending.id}: ${pending.title}). Revisá Jira antes de iniciar otra para evitar duplicados.`,
      pending:{status:pending.status,title:pending.title,created_at:pending.created_at}
    },{status:409});
    // Ya no bloquear mensajes previamente vinculados: las relaciones son múltiples
    // (PRIMARY KEY ticket_id,message_id), y las evidencias se deduplican POR ticket.
    // Crear tickets de texto aunque WhatsApp Web no pueda recuperar multimedia.
    // La descarga ocurre en segundo plano al abrir el chat. No provocar un 409
    // ni esperar hasta 30 s al conector, porque el cliente necesita crear el ticket.
    // Se adjuntan SOLO archivos locales efectivamente existentes, sin inventar evidencia.
    const mediaMessages=chosen as Array<CaseRecord & {media_path?:string|null;media_type?:string|null;media_name?:string|null;media_source?:string|null;has_media?:number;media_error?:string|null}>;
    const hasFile=(m:typeof mediaMessages[number])=>!!m.media_path&&fs.existsSync(path.join(process.cwd(),'data','media',path.basename(m.media_path)));
    const evidenceNeeded=mediaMessages.filter(m=>!!m.media_error||!!m.has_media||/^\[Adjunto WhatsApp:/.test(m.message||'')||!!m.media_path);
    const stillMissing=evidenceNeeded.filter(m=>!hasFile(m));
    // No crear silenciosamente un ticket sin la imagen solicitada.
    // El cliente puede decidir continuar SIN evidencia únicamente con
    // autorización expresa, mostrando primero cuáles están pendientes.
    if(stillMissing.length&&!p.data.allowMissingEvidence){
      return NextResponse.json({
        code:'MISSING_EVIDENCE',
        error:`No se creó el ticket: faltan ${stillMissing.length} imagen(es) o archivo(s) de WhatsApp. Recuperalos antes de continuar, o autorizá expresamente continuar sin esos adjuntos.`,
        missingEvidence:stillMissing.map(m=>m.id)
      },{status:409});
    }
    // Recargar los metadatos de archivos que se hayan recuperado automáticamente.
    const chosenReady=d.prepare(`SELECT * FROM cases WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY received_at ASC,id ASC`).all(...ids) as typeof mediaMessages;
    const created=d.prepare("INSERT INTO customer_jira_tickets(phone,kind,parent_key,title,assignee_id,assignee_name,status) VALUES (?,?,?,?,?,?,'sending')").run(phone,mode,mode==='subtask'?p.data.parentKey:null,title,p.data.assigneeId||null,p.data.assigneeId?(p.data.assigneeName||null):null);
    const recordId=Number(created.lastInsertRowid);
    const evidenceNote=stillMissing.length?`\nEvidencia no recuperada: ${stillMissing.length} archivo(s) originales no estaban disponibles en WhatsApp al crear este ticket.`:'';
    const body=(chosen.map(m=>`[${m.local_date} ${m.local_time}] ${m.message}`).join('\n')+
      (chosenReady.some(m=>hasFile(m))?'\nEvidencia en archivos adjuntos: '+chosenReady.filter(m=>hasFile(m)).map(m=>(m.media_source==='manual'?'[aportado manualmente] ':'')+(m.media_name||('Archivo del mensaje '+m.id))).join(', '):'')+evidenceNote).slice(0,19000);
    const first=chosen[0];
    let issue:{key:string,id:string;fieldWarnings?:string[]};
    try{
      issue=await jiraCreate({...first,customer:customerName,message:body,source:'whatsapp'},{title,customerName,system:p.data.system||'Otros sistemas',assigneeId:p.data.assigneeId,parentKey:mode==='subtask'?p.data.parentKey:undefined});
      d.transaction(()=>{
        d.prepare("UPDATE customer_jira_tickets SET status='created',jira_key=?,jira_id=? WHERE id=?").run(issue.key,issue.id,recordId);
        const link=d.prepare('INSERT INTO customer_ticket_messages(ticket_id,message_id) VALUES (?,?)');for(const m of chosen)link.run(recordId,m.id);
      })();
    }catch(e){const error=e instanceof Error?e.message:'Error inesperado';d.prepare("UPDATE customer_jira_tickets SET status='review',error=? WHERE id=?").run(error,recordId);return NextResponse.json({error,review:true},{status:502});}
    // Sincroniza también las fotos recuperadas después; cada evidencia tiene
    // control de idempotencia por ticket y mensaje.
    // Jira YA confirmó el ticket. Si la consulta/subida de adjuntos falla,
    // nunca devolver HTTP 500 por esta fase: el operador reintentaría y
    // podría crear un segundo ticket sin saber que el primero sí existe.
    let uploaded;
    try { uploaded=await syncTicketEvidence(issue.key,ids); }
    catch(e){
      uploaded={uploaded:0,already:0,pending:0,errors:[`Ticket creado; no se pudieron confirmar las evidencias: ${e instanceof Error?e.message:'error desconocido'}`]};
    }
    return NextResponse.json({ok:true,key:issue.key,id:issue.id,attachments:uploaded,fieldWarnings:issue.fieldWarnings||[],missingEvidence:stillMissing.map(m=>m.id)});
  }
  const item=d.prepare('SELECT * FROM cases WHERE id=?').get(p.data.id) as CaseRecord|undefined;
  if(!item)return NextResponse.json({error:'Caso inexistente'},{status:404});
  if(!item.outside_hours)return NextResponse.json({error:'Caso dentro de horario; no corresponde crear automáticamente'},{status:400});
  const withMedia=item as CaseRecord & {source?:string;has_media?:number;media_path?:string|null;media_error?:string|null};
  const missingMedia=withMedia.source==='whatsapp' &&
    (Boolean(withMedia.has_media)||Boolean(withMedia.media_error)||/^\[Adjunto WhatsApp:/.test(item.message)) &&
    (!withMedia.media_path || !fs.existsSync(path.join(process.cwd(),'data','media',path.basename(withMedia.media_path))));
  if(missingMedia&&!p.data.allowMissingEvidence)return NextResponse.json({
    code:'MISSING_EVIDENCE',missingEvidence:[item.id],
    error:'Este mensaje tiene una imagen sin descargar. No se creó el ticket; recuperá el archivo antes o confirmá expresamente que querés continuar sin él.'
  },{status:409});
  // Reservar antes del POST: impide múltiples envíos por doble clic y retries peligrosos.
  const lock=d.prepare("UPDATE cases SET status='sending',error=NULL WHERE id=? AND status='pending'").run(item.id);
  if(!lock.changes)return NextResponse.json({error:'Caso ya enviado, en proceso o bloqueado. Revisá Jira antes de reintentar.'},{status:409});
  try{
    const v=await jiraCreate(item,{title:p.data.title,assigneeId:p.data.assigneeId});
    d.prepare("UPDATE cases SET status='created',jira_key=?,jira_id=? WHERE id=?").run(v.key,v.id,item.id);
    // Tickets individuales también necesitan el archivo original.
    // El mismo control de evidencia evita adjuntos duplicados en Jira.
    const attachments=await syncTicketEvidence(v.key,[item.id]);
    return NextResponse.json({ok:true,key:v.key,id:v.id,attachments,missingEvidence:missingMedia?[item.id]:[]});
  }catch(e){
    const error=e instanceof Error?e.message:'Error inesperado';
    // Si hubo timeout podría haberse creado en Jira: no reintentar automáticamente.
    d.prepare("UPDATE cases SET status='review',error=? WHERE id=?").run(error,item.id);
    return NextResponse.json({error,review:true},{status:502});
  }
}
