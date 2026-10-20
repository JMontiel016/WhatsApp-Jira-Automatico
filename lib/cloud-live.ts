import {getConfig,cloudDb,getSession,putSession} from './cloud-store';
import {parseMetaMessage,advance,summarize,CloudEvent,CloudState,OutputMessage} from './cloud-menu';
import {deliverCloudMessage} from './cloud-meta';
import {jiraCreate} from '@/lib/jira';
import {saveCloudImage,attachCloudImages} from './cloud-media';
import {scheduleAllowed,controlDb,setting} from '@/lib/automation-controls';
// Seguridad: este módulo no llama ni modifica el conector whatsapp-web.js.
const cleanPhone=(x:string)=> /^\d{8,16}$/.test(x)?x:'';
function isExcluded(phone:string){
 const d=controlDb();
 // El bot Cloud tiene un interruptor propio; no toma el estado del bot anterior.
 const legacy: string[] = setting('automation_excluded_phones').match(/\d{8,16}/g) ?? [];
 if(legacy.includes(phone))return true;
 // Si existe una exclusión para cualquier sesión, se respeta también en Cloud API.
 const deny=d.prepare("SELECT 1 FROM automation_contact_rules WHERE phone=? AND (excluded=1 OR override_mode='disabled') LIMIT 1").get(phone);
 if(deny)return true;
 const staff=d.prepare('SELECT 1 FROM automation_support_staff WHERE phone=? AND active=1 LIMIT 1').get(phone);
 return !!staff;
}
function saveIncoming(id:string,phone:string,msg:unknown){
 const d=cloudDb();
 d.exec(`CREATE TABLE IF NOT EXISTS cloud_menu_messages (
 id TEXT PRIMARY KEY,phone TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_cloud_menu_messages_phone ON cloud_menu_messages(phone,received_at);`);
 const obj=msg as {type?:string};
 return d.prepare('INSERT OR IGNORE INTO cloud_menu_processed(message_id,phone) VALUES (?,?)').run(id,phone).changes>0 &&
  d.prepare('INSERT OR IGNORE INTO cloud_menu_messages(id,phone,kind,payload) VALUES (?,?,?,?)').run(id,phone,String(obj?.type||'unknown'),JSON.stringify(msg)).changes>0;
}
async function sendOutputs(phone:string,outputs:OutputMessage[]){
 const config=getConfig();const d=cloudDb();
 for(const out of outputs){
  const row=d.prepare("INSERT INTO cloud_menu_delivery(phone,payload,state) VALUES (?,?,'sending')").run(phone,JSON.stringify(out));
  try{
   await deliverCloudMessage(phone,config,out);
   d.prepare("UPDATE cloud_menu_delivery SET state='sent' WHERE id=?").run(row.lastInsertRowid);
  }catch(e){
   d.prepare("UPDATE cloud_menu_delivery SET state='review',error=? WHERE id=?").run(e instanceof Error?e.message:'Error',row.lastInsertRowid);
   console.warn('[CLOUD API] Entrega sin confirmar; revisión manual requerida:',e instanceof Error?e.message:'Error');
   // No reintentar envíos inciertos automáticamente para evitar duplicados.
   break;
  }
 }
}
async function createTicket(phone:string,s:CloudState,confirmEventId:string){
 const d=cloudDb();const config=getConfig();
 // Reservar ANTES de enviar a Jira; nunca reintentar tras timeout o 5xx.
 const pending=d.prepare("SELECT id FROM cloud_menu_ticket_jobs WHERE phone=? AND state IN ('sending','review') LIMIT 1").get(phone);
 if(pending)return;
 const job=d.prepare("INSERT OR IGNORE INTO cloud_menu_ticket_jobs(phone,state,confirm_event_id) VALUES (?,'sending',?)").run(phone,confirmEventId);
 if(!job.changes)return;
 const details=summarize(config,s);
 const o=config.options.find(x=>x.id===s.branch);
 const client=(s.answers.empresa||s.answers.nombre||`Cliente ${phone}`).slice(0,90);
 const issue=(s.answers.inconveniente||'Solicitud de soporte').slice(0,100);
 const now=new Date();const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Asuncion',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 try{
  const result=await jiraCreate({id:0,customer:client,phone,message:details,local_date:date,local_time:time,reason:'Cloud API',source:'whatsapp'},
   {title:`${client} - ${issue}`.slice(0,180),customerName:client,system:o?.title==='Futura100'||o?.title==='Talento100'?o.title:'Otros sistemas'});
  d.prepare("UPDATE cloud_menu_ticket_jobs SET state='created',jira_key=?,updated_at=CURRENT_TIMESTAMP WHERE confirm_event_id=?").run(result.key,confirmEventId);
  s.stage='done';s.jiraKey=result.key;putSession(phone,s);
  const evidence=await attachCloudImages(phone,result.key,s.startedAt).catch(e=>({uploaded:0,errors:[e instanceof Error?e.message:'Error adjuntando evidencia']}));
  if(evidence.errors.length)console.warn('[CLOUD API] Evidencia pendiente en Jira:',evidence.errors.join(', '));
  await sendOutputs(phone,[{kind:'text',text:`${config.confirmedText}\nTicket: ${result.key}${s.branch==='sistema_consulta_ti'?'\n'+config.handoffText:''}`}]);
 }catch(e){
  d.prepare("UPDATE cloud_menu_ticket_jobs SET state='review',error=?,updated_at=CURRENT_TIMESTAMP WHERE confirm_event_id=?").run(e instanceof Error?e.message:'Error',confirmEventId);
  console.warn('[CLOUD API] Jira sin confirmación, no reintentar automáticamente:',e instanceof Error?e.message:'Error');
  await sendOutputs(phone,[{kind:'text',text:'Recibimos tu confirmación. El equipo verificará el registro antes de enviarte un número de ticket.'}]);
 }
}
export async function handleCloudMessage(msg:unknown){
 const m=msg as {id?:string;from?:string;type?:string;timestamp?:string;context?:unknown};
 const phone=cleanPhone(m?.from||'');
 if(!phone||!m?.id||typeof m.id!=='string'||m.id.length>300||!/^wamid\./.test(m.id))return;
 // No permitir que el bot viejo y Cloud respondan en paralelo.
 if(setting('automation_enabled')==='1')throw new Error('Desactivá el bot legacy antes de habilitar Cloud API para el mismo número');
 if(!scheduleAllowed(new Date((Number(m.timestamp)||Date.now()/1000)*1000).toISOString()))return;
 if(isExcluded(phone))return;
 const event:CloudEvent|null=parseMetaMessage(m);
 if(!event)return;
 // Cloud API no sincroniza grupos; ignorar cualquier JID grupal o de estado.
 if(String(m.from).includes('@')||m.type==='reaction')return;
 const d=cloudDb();
 if(!saveIncoming(m.id,phone,m))return;
 if(event.kind==='image'){
  try{await saveCloudImage(phone,m.id,event.mediaId||'');await sendOutputs(phone,[{kind:'text',text:'Imagen guardada como evidencia. Continuá con la pregunta pendiente.'}]);}
  catch(e){console.warn('[CLOUD API] Imagen no recuperada:',e instanceof Error?e.message:'Error');await sendOutputs(phone,[{kind:'text',text:'No pudimos guardar esa imagen. Por favor, volvé a enviarla.'}]);}
  return;
 }
 const current=getSession(phone),config=getConfig();
 // En la primera interacción del cliente o con plantilla aprobada, enviar lista real.
 const response=advance(config,current,current.stage==='menu'&&event.kind!=='list_reply'?{kind:'start'}:event);
 putSession(phone,response.state);
 if(response.confirmation){await createTicket(phone,response.state,m.id);return;}
 await sendOutputs(phone,response.messages);
}
