'use client';
import {useEffect,useRef,useState} from 'react';
import {Activity,CalendarDays,CheckCircle2,Clock3,ExternalLink,MessageCircle,Plus,RefreshCw,Send,Server,Settings2,ShieldCheck,Ticket,Trash2,WifiOff,Palette,ImageOff,Film,Mic,FileText} from 'lucide-react';
type C={id:number;source?:string;customer:string;phone:string;message:string;local_date:string;local_time:string;reason:string;outside_hours:number;status:string;jira_key:string|null;error:string|null};
type Conversation={phone:string;customer:string;avatar_url?:string|null;outside:boolean;ticket:{jira_key:string|null,status:string,error:string|null}|null;tickets:Array<{id:number,jira_key:string,title:string,kind:string,parent_key:string|null,created_at:string}>;events:Array<C & {received_at:string,media_path:string|null,media_type?:string|null,media_name?:string|null,media_error?:string|null;media_source?:string|null;has_media?:number;direction?:string;usedInTicket?:boolean}>};
type Holiday={date:string;name:string};
type Rule={outside:boolean;reason:string;date:string;hour:string};
type JiraDetail={key:string;summary:string;status:string;description:string;attachments:Array<{id:string;filename:string;mime:string;size:number}>;localMedia?:Array<{id:number;media_type:string;media_name:string;media_source?:string}>;url:string};
async function req<T>(url:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const raw=await r.text();let result:unknown;
 try{result=JSON.parse(raw);}catch{
  const html=raw.trimStart().startsWith('<')||r.headers.get('content-type')?.includes('text/html');
  if(html)throw new Error(r.status===404?'La consulta de Jira no está disponible (HTTP 404). Verificá que app/api/jira/details/route.ts esté instalado y reiniciá Next.js.':`No se pudo consultar el servicio (HTTP ${r.status}). El servidor respondió con HTML en vez de datos; revisá la terminal de Next.js.`);
  throw new Error(`Respuesta inválida del servidor (HTTP ${r.status}). Revisá la terminal de Next.js.`);
 }
 if(!r.ok){const detail=result&&typeof result==='object'?result as {error?:unknown;message?:unknown;code?:unknown;missingEvidence?:unknown}:{};const failure=new Error(String(detail.error||detail.message||`Error HTTP ${r.status}`));Object.assign(failure,{status:r.status,code:detail.code,missingEvidence:detail.missingEvidence});throw failure;}
 return result as T;
}
const pad=(v:number)=>String(v).padStart(2,'0');
const jiraLink=(key:string)=>/^CW-[0-9]+$/.test(key)?`https://grupobepa.atlassian.net/browse/${key}`:null;
function ticketDateLabel(value:string){
 if(!value)return 'Fecha no disponible';
 const d=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');
 return Number.isNaN(d.getTime())?value.slice(0,16):new Intl.DateTimeFormat('es-PY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Asuncion'}).format(d);
}
function ticketFileSize(value:number){if(!Number.isFinite(value)||value<=0)return '';return value>=1024*1024?`${(value/1024/1024).toFixed(1)} MB`:`${Math.ceil(value/1024)} KB`;}
function initialDate(){const now=new Date();return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;}

// Usar siempre la fecha local de Paraguay para los separadores del chat.
function paraguayDateKey(date:Date){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=(type:string)=>parts.find(p=>p.type===type)?.value||'';
 return `${part('year')}-${part('month')}-${part('day')}`;
}
// La comparación se hace con la fecha de Paraguay, no con la del navegador ni con UTC.
function eventDateKey(e:Conversation['events'][number]){
 if(/^\d{4}-\d{2}-\d{2}$/.test(e.local_date||''))return e.local_date;
 const timestamp=new Date(e.received_at);
 return Number.isNaN(timestamp.getTime())?'':paraguayDateKey(timestamp);
}
function chatDateLabel(dayKey:string,todayKey:string){
 if(dayKey===todayKey)return 'Hoy';
 const yesterday=new Date(`${todayKey}T12:00:00Z`);
 yesterday.setUTCDate(yesterday.getUTCDate()-1);
 if(dayKey===yesterday.toISOString().slice(0,10))return 'Ayer';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey))return dayKey;
 return new Intl.DateTimeFormat('es-PY',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${dayKey}T12:00:00Z`));
}

export default function Home(){
 const [theme,setTheme]=useState<'dark'|'light'>('dark');const [accent,setAccent]=useState<'neutral'|'emerald'|'cyan'|'violet'|'orange'|'rose'>('neutral');const [showAppearance,setShowAppearance]=useState(false);const [chatView,setChatView]=useState<'all'|'pending'|'created'>('all');const [preview,setPreview]=useState<{id:number;name:string}|null>(null);const [ticketDraft,setTicketDraft]=useState<{phone:string;customer:string;title:string;assigneeId:string;kind:'issue'|'subtask';parentKey:string;system:'Futura100'|'Talento100'|'Otros sistemas'}|null>(null);const [jiraParents,setJiraParents]=useState<Array<{key:string;summary:string}>>([]);const [parentQuery,setParentQuery]=useState('');const [parentLoading,setParentLoading]=useState(false);const [parentError,setParentError]=useState('');const [contacts,setContacts]=useState<Array<{phone:string;name:string}>>([]);const [contactsError,setContactsError]=useState('');const [assignees,setAssignees]=useState<Array<{id:string;name:string}>>([]);const [assigneeQuery,setAssigneeQuery]=useState('');const [assigneeLoading,setAssigneeLoading]=useState(false);const [assigneeError,setAssigneeError]=useState('');const [waStatus,setWaStatus]=useState({connected:false,service:false});const [replyOpen,setReplyOpen]=useState(false);const [replyText,setReplyText]=useState('');const [openChat,setOpenChat]=useState<string|null>(null);const [chatSearch,setChatSearch]=useState('');const [aliases,setAliases]=useState<Record<string,string>>({});const [selected,setSelected]=useState<Record<string,number[]>>({});const [tab,setTab]=useState<'panel'|'settings'>('panel');const [filter,setFilter]=useState<'all'|'whatsapp'|'simulator'>('whatsapp');const [expanded,setExpanded]=useState<number|null>(null);const [cases,setCases]=useState<C[]>([]);const [conversations,setConversations]=useState<Conversation[]>([]);const [holidays,setHolidays]=useState<Holiday[]>([]);const [settings,setSettings]=useState({start:'08:00',end:'18:00'});const [health,setHealth]=useState({jiraRealEnabled:false,project:'CW'});const [customer,setCustomer]=useState('Cliente de prueba');const [phone,setPhone]=useState('+595981000000');const [message,setMessage]=useState('No puedo ingresar al sistema, aparece un error de conexión.');const [date,setDate]=useState('');const [notice,setNotice]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [rule,setRule]=useState<Rule|null>(null);const [day,setDay]=useState('');const [holidayName,setHolidayName]=useState('');
 const [ticketsPhone,setTicketsPhone]=useState<string|null>(null);
 const [ticketKey,setTicketKey]=useState<string|null>(null);
 const [jiraDetail,setJiraDetail]=useState<JiraDetail|null>(null);
 const [detailLoading,setDetailLoading]=useState(false);
 const [detailError,setDetailError]=useState('');
 const [sendingReply,setSendingReply]=useState(false);
 const [replyError,setReplyError]=useState('');
 const detailsRequestId=useRef(0);
 const historyDiscovered=useRef(new Set<string>());
 const [historyPhone,setHistoryPhone]=useState<string|null>(null);
 const [mediaWarning,setMediaWarning]=useState<Record<string,string>>({});
 const automaticallySynced=useRef(new Map<string,Set<number>>());
 const syncingChats=useRef(new Set<string>());
 const [syncingPhone,setSyncingPhone]=useState<string|null>(null);
 const [brokenImages,setBrokenImages]=useState<Record<number,boolean>>({});
 const isMissingMedia=(e:Conversation['events'][number])=>!e.media_path&&(!!e.media_error||!!e.has_media||/^\[Adjunto WhatsApp:/.test(e.message||''));
 // Recuperación desde el conector QR; sin intentar abrir URLs privadas de la CDN de WhatsApp.
 async function syncMediaForPhone(phone:string,requestedIds?:number[]){
  if(syncingChats.current.has(phone))return;
  const chat=conversations.find(c=>c.phone===phone);
  if(!chat||!waStatus.connected)return;
  const missing=chat.events.filter(e=>(isMissingMedia(e)||brokenImages[e.id])&&(!requestedIds||requestedIds.includes(e.id))).slice().reverse();
  if(!missing.length)return;
  syncingChats.current.add(phone);setSyncingPhone(phone);
  try{
   const limit=Math.min(missing.length,4);
   for(let offset=0;offset<limit;offset+=4){
    const batch=missing.slice(offset,offset+4);
    const result=await req<{ok:boolean;saved:number;failed:number;items:Array<{id:number;ok:boolean;error?:string}>}>('/api/whatsapp/media/sync','POST',{phone,ids:batch.map(e=>e.id)});
    const updated=await req<Conversation[]>('/api/conversations');setConversations(updated);
    if(result.saved)setBrokenImages(prev=>{const next={...prev};for(const item of result.items)if(item.ok)delete next[item.id];return next;});
   }
  }catch(e){console.warn('[Multimedia] No se pudo sincronizar la conversación',e);}
  finally{syncingChats.current.delete(phone);setSyncingPhone(current=>current===phone?null:current);}
 }
 async function refresh(){const [a,b,c,d]=await Promise.all([req<C[]>('/api/tickets'),req<Holiday[]>('/api/holidays'),req<{start:string,end:string}>('/api/settings'),req<typeof health>('/api/health')]);setCases(a);setConversations(await req<Conversation[]>('/api/conversations'));try{setWaStatus(await req<{connected:boolean,service:boolean}>('/api/whatsapp/status'));}catch{}setHolidays(b);setSettings(c);setHealth(d);}
 useEffect(()=>{setDate(initialDate());try{setAliases(JSON.parse(localStorage.getItem('ticketbridge-contact-aliases')||'{}'));setTheme(localStorage.getItem('ticketbridge-theme')==='light'?'light':'dark');const savedAccent=localStorage.getItem('ticketbridge-accent');if(['neutral','emerald','cyan','violet','orange','rose'].includes(savedAccent||''))setAccent(savedAccent as 'neutral'|'emerald'|'cyan'|'violet'|'orange'|'rose');}catch{}refresh().catch(e=>setError(e.message));},[]);
 // Polling solo de lectura: no crea tickets ni envía respuestas.
 useEffect(()=>{if(!chatSearch.trim()){setContacts([]);return;}const timer=setTimeout(()=>{searchContacts(chatSearch)},350);return()=>clearTimeout(timer)},[chatSearch]);
 useEffect(()=>{
  if(tab!=='panel')return;
  let alive=true;
  let inFlight=false;
  async function poll(){
   if(!alive||inFlight||document.visibilityState==='hidden')return;
   inFlight=true;
   try{
    const [newCases,newConversations,status]=await Promise.all([
     req<C[]>('/api/tickets'),
     req<Conversation[]>('/api/conversations'),
     req<{connected:boolean,service:boolean}>('/api/whatsapp/status').catch(()=>null)
    ]);
    if(alive){setCases(newCases);setConversations(newConversations);if(status)setWaStatus(status);}
   }catch{/* Mantener los datos existentes si la conexión se interrumpe. */}
   finally{inFlight=false;}
  }
  const timer=setInterval(poll,6000);
  document.addEventListener('visibilitychange',poll);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
 },[tab]);
 // Detecta imágenes antiguas con comentario que el proyecto original no reconocía como archivo.
 useEffect(()=>{
  if(!openChat||!waStatus.connected||historyDiscovered.current.has(openChat))return;
  const phone=openChat;
  historyDiscovered.current.add(phone);setHistoryPhone(phone);
  void req<{ok:boolean;discovered:number;saved:number;warning?:string}>('/api/whatsapp/media/discover','POST',{phone})
   .then(async result=>{if(result.warning)setMediaWarning(prev=>({...prev,[phone]:result.warning||''}));const fresh=await req<Conversation[]>('/api/conversations');setConversations(fresh);})
   .catch(e=>{console.warn('[Evidencias] Historial no disponible (sin reintento continuo)',e);setMediaWarning(prev=>({...prev,[phone]:'No se pudieron recuperar las imágenes históricas. Podés adjuntar una captura guardada al crear el ticket.'}));})
   .finally(()=>setHistoryPhone(current=>current===phone?null:current));
 },[openChat,waStatus.connected]);
 // Descarga gradual: cuatro adjuntos por petición, sin bloquear el chat ni reintentar en bucle los fallidos.
 useEffect(()=>{
  if(tab!=='panel'||!openChat||!waStatus.connected||syncingChats.current.has(openChat))return;
  const chat=conversations.find(c=>c.phone===openChat);
  if(!chat)return;
  const attempted=automaticallySynced.current.get(openChat)||new Set<number>();
  const next=chat.events.filter(e=>(isMissingMedia(e)||brokenImages[e.id])&&!attempted.has(e.id)).slice().reverse().slice(0,4);
  if(!next.length)return;
  for(const item of next)attempted.add(item.id);
  automaticallySynced.current.set(openChat,attempted);
  void syncMediaForPhone(openChat,next.map(e=>e.id));
 },[openChat,waStatus.connected,tab,conversations,syncingPhone,brokenImages]);
 const filtered=cases.filter(c=>filter==='all'||(filter==='whatsapp'?c.source==='whatsapp':c.source!=='whatsapp'));
 const whatsappCount=cases.filter(c=>c.source==='whatsapp').length;
 const todayKey=paraguayDateKey(new Date());
 async function perform(fn:()=>Promise<void>){setLoading(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:'Error desconocido');}finally{setLoading(false);}}
 async function simulate(){await perform(async()=>{const dt=new Date(date);if(Number.isNaN(dt.getTime()))throw Error('Fecha inválida');const data=await req<{rule:Rule}>('/api/simulate','POST',{customer,phone,message,receivedAt:dt.toISOString(),eventId:crypto.randomUUID()});setRule(data.rule);setNotice(data.rule.outside?'Caso simulado y preparado. Para crear un ticket real, usá el botón Enviar a Jira.':'Mensaje simulado dentro de horario: sin ticket.');});}
 async function create(c:C){if(!confirm(`Se creará un ticket REAL en Jira ${health.project} para el caso #${c.id}. ¿Continuar?`))return;await perform(async()=>{const v=await req<{key:string}>('/api/jira/create','POST',{id:c.id});setNotice(`Ticket ${v.key} creado correctamente en Jira. Hacé clic en el número dentro del historial para abrirlo.`);});}
 async function openTicketDraft(c:Conversation){
  const chosen=selectedIds(c);
  if(!chosen.length){setError('Seleccioná al menos un mensaje para crear el ticket.');return;}

  const displayName=(aliases[c.phone]||c.customer||'').trim();
  const realName=/^(WhatsApp\s+\S+|Contacto sin nombre)$/i.test(displayName)?'':displayName;
  setTicketDraft({phone:c.phone,customer:realName,title:'',assigneeId:'',kind:'issue',parentKey:'',system:'Futura100'});
  setAssigneeQuery('');setAssignees([]);setAssigneeError('');setParentQuery('');setJiraParents([]);setParentError('');setError('');
 }
 // La búsqueda se ejecuta sola 300 ms después de escribir. No requiere un botón.
 useEffect(()=>{
  if(!ticketDraft||ticketDraft.assigneeId||assigneeQuery.trim().length<2){setAssignees([]);setAssigneeLoading(false);setAssigneeError('');return;}
  let active=true;
  setAssigneeLoading(true);setAssigneeError('');
  const timer=setTimeout(async()=>{
   try{
    const items=await req<Array<{id:string;name:string}>>('/api/jira/assignees?q='+encodeURIComponent(assigneeQuery.trim()));
    if(active)setAssignees(items);
   }catch(e){if(active){setAssignees([]);setAssigneeError(e instanceof Error?e.message:'No se pudieron buscar los responsables.')}}
   finally{if(active)setAssigneeLoading(false);}
  },300);
  return()=>{active=false;clearTimeout(timer);};
 },[assigneeQuery,ticketDraft?.assigneeId,Boolean(ticketDraft)]);

 // Tickets principales: también sugerir automáticamente sin botón Buscar.
 useEffect(()=>{
  if(!ticketDraft||ticketDraft.kind!=='subtask'||ticketDraft.parentKey||parentQuery.trim().length<2){setJiraParents([]);setParentLoading(false);setParentError('');return;}
  let active=true;setParentLoading(true);setParentError('');
  const timer=setTimeout(async()=>{
   try{const found=await req<Array<{key:string;summary:string}>>('/api/jira/parents?q='+encodeURIComponent(parentQuery.trim()));if(active)setJiraParents(found);}
   catch(e){if(active){setJiraParents([]);setParentError(e instanceof Error?e.message:'Error consultando Jira');}}
   finally{if(active)setParentLoading(false);}
  },350);
  return()=>{active=false;clearTimeout(timer);};
 },[parentQuery,ticketDraft?.parentKey,ticketDraft?.kind,Boolean(ticketDraft)]);

 async function searchContacts(q:string){if(!q.trim()){setContacts([]);setContactsError('');return;}try{setContacts(await req<Array<{phone:string;name:string}>>('/api/whatsapp/contacts?q='+encodeURIComponent(q.trim())));setContactsError('');}catch(e){setContacts([]);setContactsError(e instanceof Error?e.message:'Conector no disponible');}}
 async function importEvidence(phone:string,id:number,file:File){
  if(file.size>12*1024*1024){setError('La imagen debe pesar menos de 12 MB.');return;}
  await perform(async()=>{
   const form=new FormData();form.set('phone',phone);form.set('id',String(id));form.set('file',file);
   const res=await fetch('/api/whatsapp/media/import',{method:'POST',body:form});
   const result=await res.json();
   if(!res.ok)throw new Error(result.error||'No se pudo agregar la evidencia.');
   setBrokenImages(prev=>{const next={...prev};delete next[id];return next;});
   setNotice('Imagen cargada como evidencia manual. Se mostrará en el chat y se adjuntará al ticket cuando lo crees.');
  });
 }
 async function removeEvidence(phone:string,id:number){
  await perform(async()=>{
   await req<{ok:boolean}>('/api/whatsapp/media/remove','POST',{phone,id});
   setBrokenImages(prev=>{const next={...prev};delete next[id];return next;});
   setNotice('La captura manual se quitó del mensaje.');
  });
 }
 async function createConversation(c:Conversation){
  if(!ticketDraft||ticketDraft.phone!==c.phone)return;
  const eligible=c.events;const chosen=selectedIds(c);const valid=chosen.filter(id=>eligible.some(e=>e.id===id&&canSelectMessage(e)));
  if(!valid.length){setError('Seleccioná al menos un mensaje para el ticket.');return;}
  if(!ticketDraft.customer.trim()){setError('Ingresá el nombre del cliente para registrar el ticket.');return;}
  if(ticketDraft.title.trim().length<5){setError('Escribí el tema del inconveniente (mínimo 5 caracteres).');return;}
  if(ticketDraft.kind==='subtask'&&!ticketDraft.parentKey){setError('Elegí un ticket padre.');return;}
  if(!confirm(`Crear ${ticketDraft.kind==='subtask'?'una SUBTAREA':'un ticket NUEVO'} en Jira CW: ${ticketDraft.customer.trim()} - ${ticketDraft.title.trim()}, con ${valid.length} mensajes seleccionados?`))return;
  await perform(async()=>{
   const payload:{phone:string;messageIds:number[];customer:string;title:string;assigneeId?:string;kind:'issue'|'subtask';system:string;parentKey?:string;allowMissingEvidence?:boolean;allowUnconfirmedJira?:boolean}={phone:c.phone,messageIds:valid,customer:ticketDraft.customer.trim(),title:ticketDraft.title.trim(),assigneeId:ticketDraft.assigneeId||undefined,kind:ticketDraft.kind,system:ticketDraft.system,parentKey:ticketDraft.kind==='subtask'?ticketDraft.parentKey:undefined};
   type Created={key:string;attachments:{uploaded:number;errors:string[]};missingEvidence?:number[];fieldWarnings?:string[]};
   let created:Created|undefined;
   // Reintento exclusivamente cuando el usuario confirma que Jira NO creó un ticket anterior.
   for(let attempt=0;attempt<2&&!created;attempt++){
    try{created=await req<Created>('/api/jira/create','POST',payload);}
    catch(e){
     const problem=e as Error&{code?:string};
     if(problem.code==='UNCONFIRMED_JIRA'&&!payload.allowUnconfirmedJira){
      if(!confirm('Hay un ticket anterior cuyo resultado no pudo confirmarse. Verificá en Jira que NO exista para evitar duplicados.\n\n¿Ya verificaste y querés continuar?'))throw new Error('Operación detenida para evitar tickets duplicados.');
      payload.allowUnconfirmedJira=true;continue;
     }
     throw e;
    }
   }
   if(!created)throw new Error('No se confirmó la creación; verificá Jira antes de reintentar.');
   const v=created;
   setTicketDraft(null);setSelected(prev=>({...prev,[c.phone]:[]}));
   const alerts=[...(v.fieldWarnings||[]),...(v.attachments.errors||[]),...(v.missingEvidence?.length?[`${v.missingEvidence.length} archivo(s) originales NO adjuntados porque WhatsApp no los proporcionó.`]:[])];
   if(alerts.length)setError(`Ticket ${v.key} creado con ${v.attachments.uploaded} adjunto(s). Advertencia: ${alerts.join(' / ')}.`);
   else setNotice(`Ticket ${v.key} creado con ${v.attachments.uploaded} archivo(s) adjunto(s) en Jira.`);
  });
 }
 // Todos los días ofrecen selección manual. La selección inicial incluye
 // solo los mensajes de hoy, nunca los de ayer ni los de fechas anteriores.
 function canSelectMessage(e:Conversation['events'][number]){
  return !e.usedInTicket&&!e.jira_key;
 }
 function canSelectToday(e:Conversation['events'][number]){
  return eventDateKey(e)===todayKey&&canSelectMessage(e);
 }
 function selectedIds(c:Conversation){
  const allowed=new Set(c.events.filter(canSelectMessage).map(e=>e.id));
  const initiallyToday=c.events.filter(canSelectToday).map(e=>e.id);
  return (selected[c.phone]??initiallyToday).filter(id=>allowed.has(id));
 }
 function toggleMsg(c:Conversation,id:number){
  const msg=c.events.find(e=>e.id===id);
  if(!msg||!canSelectMessage(msg))return;
  const current=selectedIds(c);
  setSelected(prev=>({...prev,[c.phone]:current.includes(id)?current.filter(x=>x!==id):[...current,id]}));
 }
 // Un clic explícito en Enviar es la autorización; sin casilla ni confirmaciones emergentes.
 async function sendReply(c:Conversation){
  const text=replyText.trim();
  if(!text||sendingReply)return;
  if(!waStatus.connected){setReplyError('WhatsApp no está conectado. Iniciá npm run whatsapp y esperá la conexión.');return;}
  setSendingReply(true);setReplyError('');
  try{
   await req<{sent:boolean}>('/api/whatsapp/send','POST',{phone:c.phone,message:text});
   setReplyText('');setReplyOpen(false);
   // Los mensajes salientes se incorporan por message_create / ingest; refrescar sin bloquear el chat.
   await refresh().catch(()=>{});
  }catch(e){setReplyError(e instanceof Error?e.message:'No se pudo enviar el mensaje.');}
  finally{setSendingReply(false);}
 }
 function closeTicketPanel(){detailsRequestId.current++;setTicketsPhone(null);setDetailLoading(false);setDetailError('');}
 function showTicketPanel(c:Conversation){
  setTicketsPhone(c.phone);
  setJiraDetail(null);setDetailError('');
  const first=c.tickets?.[0];setTicketKey(first?.jira_key||null);
  if(first?.jira_key)void fetchJiraTicket(c.phone,first.jira_key);
 }
 async function fetchJiraTicket(phone:string,key:string){
  const requestId=++detailsRequestId.current;
  setTicketKey(key);setJiraDetail(null);setDetailError('');setDetailLoading(true);
  try{
   const data=await req<JiraDetail>('/api/jira/details?phone='+encodeURIComponent(phone)+'&key='+encodeURIComponent(key));
   if(detailsRequestId.current===requestId)setJiraDetail(data);
  }catch(e){if(detailsRequestId.current===requestId)setDetailError(e instanceof Error?e.message:'No se pudo consultar la descripción en Jira.');}
  finally{if(detailsRequestId.current===requestId)setDetailLoading(false);}
 }
 useEffect(()=>{
  if(!ticketsPhone)return;
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){detailsRequestId.current++;setTicketsPhone(null);}};
  document.addEventListener('keydown',esc);
  return()=>document.removeEventListener('keydown',esc);
 },[ticketsPhone]);
 async function checkJira(){await perform(async()=>{const v=await req<{user:string}>('/api/jira/test','POST');setNotice(`Jira conectado correctamente como ${v.user}.`);});}
 const eligibleChats=conversations.filter(c=>c.outside);const visibleChats=conversations.filter(c=>chatSearch.trim()?true:chatView==='all'||(chatView==='pending'?c.events.some(e=>e.outside_hours&&e.direction!=='out'&&!e.jira_key&&!e.usedInTicket):(c.tickets?.length??0)>0));const pending=eligibleChats.filter(c=>c.events.some(e=>e.outside_hours&&e.direction!=='out'&&!e.jira_key&&!e.usedInTicket)).length,created=conversations.reduce((sum,c)=>sum+(c.tickets?.length ?? 0),0);
 return <div className={`shell theme-${theme} accent-${accent}`}><aside className="sidebar"><div className="brand"><span className="brandIcon"><Ticket size={23}/></span><div><strong>TicketBridge</strong><small>Laboratorio local · v1.0</small></div></div><div className="navTitle">ESPACIO DE TRABAJO</div><button className={'nav '+(tab==='panel'?'active':'')} onClick={()=>setTab('panel')}><Activity size={18}/> Chat y panel</button><button className={'nav '+(tab==='settings'?'active':'')} onClick={()=>setTab('settings')}><Settings2 size={18}/> Configuración</button><div className="sidebarBottom"><div className="infoDot"/> WhatsApp experimental <small>Sin respuestas automáticas</small></div></aside><main className="main"><header className="top"><div><div className="eyebrow">INTEGRACIÓN / WHATSAPP → JIRA</div><h1>{tab==='panel'?'Centro de conversaciones':'Configuración del sistema'}</h1><p className="sub">Lectura de mensajes entrantes y creación manual en Jira CW.</p></div><div className="appearanceArea"><button className="chip appearanceToggle" onClick={()=>setShowAppearance(v=>!v)} aria-label="Personalizar apariencia"><Palette size={17}/> Apariencia</button>{showAppearance&&<div className="appearanceMenu"><strong>Tema</strong><div className="appearanceOptions"><button onClick={()=>{setTheme('dark');localStorage.setItem('ticketbridge-theme','dark')}} className={theme==='dark'?'selected':''}>Oscuro</button><button onClick={()=>{setTheme('light');localStorage.setItem('ticketbridge-theme','light')}} className={theme==='light'?'selected':''}>Claro</button></div><strong>Color principal</strong><div className="colorSwatches" role="group" aria-label="Elegir color principal">{(['neutral','emerald','cyan','violet','orange','rose'] as const).map(color=><button type="button" key={color} className={'colorSwatch '+(accent===color?'selected':'')} style={{background:({neutral:'#a1a1aa',emerald:'#10b981',cyan:'#06b6d4',violet:'#8b5cf6',orange:'#f97316',rose:'#f43f5e'} as const)[color]}} aria-label={'Color '+({neutral:'gris',emerald:'verde',cyan:'celeste',violet:'violeta',orange:'naranja',rose:'rosa'} as const)[color]} aria-pressed={accent===color} title={color} onClick={()=>{setAccent(color);localStorage.setItem('ticketbridge-accent',color)}}>{accent===color&&<span aria-hidden="true">✓</span>}</button>)}</div></div>}</div></header>
 {error&&<div className="alert err">{error}<button onClick={()=>setError('')}>Cerrar</button></div>}{notice&&<div className="alert ok">{notice}<button onClick={()=>setNotice('')}>Cerrar</button></div>}
 {ticketsPhone&&<div className="ticketModalBackdrop ticketOverviewBackdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)closeTicketPanel()}}>
  <section className="ticketOverview ticketOverviewV2" role="dialog" aria-modal="true" aria-labelledby="ticket-overview-title">
   <header className="ticketOverviewHeader">
    <div className="ticketOverviewHeading"><span className="ticketOverviewHeadingIcon"><Ticket size={21}/></span><div><span className="ticketOverviewEyebrow">JIRA · PROYECTO CW</span><h2 id="ticket-overview-title">Seguimiento de tickets</h2><p>Consultá los tickets relacionados con esta conversación.</p></div></div>
    <button type="button" className="ticketOverviewClose" aria-label="Cerrar ventana de tickets" onClick={closeTicketPanel}>×</button>
   </header>
   <div className="ticketOverviewBody">
    <nav className="ticketOverviewList" aria-label="Seleccionar ticket">
     <div className="ticketOverviewListHeading"><strong>Tickets vinculados</strong><span>{conversations.find(c=>c.phone===ticketsPhone)?.tickets?.length||0}</span></div>
     {(conversations.find(c=>c.phone===ticketsPhone)?.tickets||[]).map(t=><button type="button" key={t.id} className={'ticketOverviewChoice '+(ticketKey===t.jira_key?'active':'')} aria-pressed={ticketKey===t.jira_key} onClick={()=>{if(t.jira_key)void fetchJiraTicket(ticketsPhone,t.jira_key)}}>
      <span className="ticketOverviewChoiceTop"><b>{t.jira_key}</b><span className="ticketOverviewKind">{t.kind==='subtask'?'Subtarea':'Ticket'}</span></span>
      <span className="ticketOverviewChoiceSummary">{t.title||'Ticket sin título'}</span>
      <small><Clock3 size={12}/>{ticketDateLabel(t.created_at)}</small>
     </button>)}
    </nav>
    <article className="ticketOverviewDetail">
     {detailLoading?<div className="ticketOverviewState" role="status"><RefreshCw className="syncSpin" size={20}/><strong>Cargando información...</strong><p>Consultando la descripción y las evidencias del ticket en Jira.</p></div>:
      detailError?<div className="ticketOverviewState ticketOverviewStateError" role="alert"><WifiOff size={25}/><strong>No se pudo cargar el detalle</strong><p>{detailError}</p>{ticketKey&&<button type="button" className="smallButton" onClick={()=>void fetchJiraTicket(ticketsPhone,ticketKey)}><RefreshCw size={14}/> Reintentar consulta</button>}</div>:
      jiraDetail?<>
       <div className="ticketOverviewDetailTitle"><div><span className="ticketOverviewTicketKey">{jiraDetail.key}</span><h3>{jiraDetail.summary||'Ticket sin título'}</h3></div><span className="ticketOverviewStatus">{jiraDetail.status||'Sin estado'}</span></div>
       <section className="ticketOverviewSection"><h4><FileText size={16}/> Descripción</h4><div className="ticketOverviewDescription">{jiraDetail.description?.trim()?jiraDetail.description.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,i)=>{
        const match=/^\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\]\s*(.*)$/.exec(line);
        return match?<div className="ticketOverviewMessageLine" key={i}><time>{match[1]} · {match[2]}</time><span>{match[3]}</span></div>:<p className="ticketOverviewTextLine" key={i}>{line}</p>;
       }):<p className="ticketOverviewHint">Este ticket no tiene descripción.</p>}</div></section>
       {jiraDetail.localMedia?.some(m=>m.media_type?.startsWith('image/'))&&<section className="ticketOverviewSection ticketOverviewPhotos"><h4><ImageOff size={16}/> Imágenes de la conversación</h4><div>{jiraDetail.localMedia.filter(m=>m.media_type?.startsWith('image/')).map(m=><button type="button" key={m.id} onClick={()=>setPreview({id:m.id,name:m.media_name||'Evidencia'})} title="Ampliar evidencia"><img src={'/api/media/'+m.id} alt={m.media_name||'Captura del ticket'}/></button>)}</div></section>}
       <section className="ticketOverviewSection ticketOverviewAttachments"><h4><FileText size={16}/> Evidencias adjuntas en Jira <span>({jiraDetail.attachments?.length||0})</span></h4>{jiraDetail.attachments?.length?<div className="ticketOverviewAttachmentList">{jiraDetail.attachments.map(a=><div className="ticketOverviewAttachment" key={a.id}><FileText size={16}/><span title={a.filename}>{a.filename}</span><small>{ticketFileSize(a.size)}</small></div>)}</div>:<p className="ticketOverviewHint">Este ticket todavía no tiene archivos adjuntos en Jira.</p>}</section>
      </>:<div className="ticketOverviewState"><Ticket size={22}/><p>Seleccioná un ticket para ver sus detalles.</p></div>}
     {ticketKey&&<div className="ticketOverviewFooter"><a className="ticketOverviewGo" href={jiraDetail?.url||jiraLink(ticketKey)||'#'} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Abrir {ticketKey} en Jira</a></div>}
    </article>
   </div>
  </section>
 </div>}
 {ticketDraft&&<div className="ticketModalBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setTicketDraft(null)}}><div className="ticketModal ticketModalImproved" role="dialog" aria-modal="true" aria-label="Preparar ticket Jira CW">
  <div className="ticketModalHeader"><div><div className="ticketModalEyebrow">JIRA · PROYECTO CW</div><h2>Preparar ticket de soporte</h2><p>Configurá la solicitud, revisá los mensajes seleccionados y autorizá la creación.</p></div><button type="button" className="ticketModalClose" onClick={()=>setTicketDraft(null)} aria-label="Cerrar">×</button></div>
  <div className="ticketModalBody">
   {(()=>{const c=conversations.find(c=>c.phone===ticketDraft.phone);if(!c)return null;
    const current=c.events.filter(e=>selectedIds(c).includes(e.id));
    const present=current.filter(e=>!!e.media_path);
    const missing=current.filter(e=>!e.media_path&&(!!e.media_error||!!e.has_media||/^\[Adjunto WhatsApp:/.test(e.message||'')));
    return <div className="draftEvidenceSummary"><strong>Evidencias de los mensajes seleccionados</strong>
      {present.length>0&&<div className="draftEvidencePhotos">{present.map(e=><div className="draftEvidenceItem" key={e.id}>{e.media_type?.startsWith('image/')?<button type="button" className="draftEvidenceThumb" key={e.id} onClick={()=>setPreview({id:e.id,name:e.media_name||'Evidencia'})}><img src={'/api/media/'+e.id} alt={e.media_name||'Imagen adjunta'}/><small>{e.media_source==='manual'?'Carga manual':'WhatsApp'} · #{e.id}</small></button>:<span className="draftEvidenceFile"><FileText size={15}/>{e.media_name||('Archivo #'+e.id)}</span>}{e.media_source==='manual'&&<button type="button" className="draftEvidenceRemove" disabled={loading} aria-label={'Quitar evidencia '+e.id} title="Quitar captura manual" onClick={()=>void removeEvidence(c.phone,e.id)}><Trash2 size={14}/> Quitar</button>}</div>)}</div>}
      {missing.length>0&&<div className="ticketEvidenceWarning"><ImageOff size={18}/><div><span>Faltan {missing.length} archivo(s) originales. Podés agregar capturas guardadas. Si no están disponibles, el ticket podrá crearse sin esos archivos, con una advertencia.</span>
       <div className="evidenceManualUploads">{missing.map(e=><label key={e.id} className="evidenceManualRow"><span>Mensaje #{e.id} · {e.local_time}</span><span className="evidenceManualChoose">Agregar captura guardada<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={loading} onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void importEvidence(c.phone,e.id,file);event.currentTarget.value='';}}/></span></label>)}</div>
       <small>Opcional: si guardaste la captura en tu equipo, podés adjuntarla como evidencia manual. Nunca se presenta como original recuperado de WhatsApp.</small>
      </div></div>}
      {!present.length&&!missing.length&&<small>No hay archivos adjuntos entre los mensajes seleccionados.</small>}
     </div>
   })()}

   <div className="ticketModalTwo"><label>Tipo de solicitud<select value={ticketDraft.kind} onChange={e=>setTicketDraft({...ticketDraft,kind:e.target.value as 'issue'|'subtask',parentKey:''})}><option value="issue">Nuevo ticket independiente</option><option value="subtask" >Subtarea de ticket existente</option></select></label><label>Sistema relacionado<select value={ticketDraft.system} onChange={e=>setTicketDraft({...ticketDraft,system:e.target.value as typeof ticketDraft.system})}><option value="Futura100">Futura100</option><option value="Talento100">Talento100</option><option value="Otros sistemas">Otros sistemas</option></select></label></div>
   {ticketDraft.kind==='subtask'&&<div className="parentSearch"><label>Ticket principal en Jira CW<div className="ticketAssigneeSearch ticketAssigneeAutomatic"><input role="combobox" aria-label="Buscar ticket principal" aria-autocomplete="list" aria-expanded={jiraParents.length>0} placeholder="Número CW-123 o algunas palabras" value={parentQuery} onChange={e=>{setParentQuery(e.target.value);setTicketDraft(current=>current?{...current,parentKey:''}:current);setJiraParents([])}} onKeyDown={e=>{if(e.key==='Escape')setJiraParents([]);if(e.key==='Enter'&&jiraParents[0]){e.preventDefault();setTicketDraft(current=>current?{...current,parentKey:jiraParents[0].key}:current);setParentQuery(jiraParents[0].key+' · '+jiraParents[0].summary);setJiraParents([])}}}/>{parentLoading&&<span className="assigneeSearchSpinner">Buscando…</span>}</div></label><div className="parentResults">{jiraParents.map(t=><button type="button" key={t.key} className="parentOption" onClick={()=>{setTicketDraft(current=>current?{...current,parentKey:t.key}:current);setParentQuery(t.key+' · '+t.summary);setJiraParents([])}}><b>{t.key}</b> · {t.summary}</button>)}{ticketDraft.parentKey&&<small className="assigneeChosen">✓ Ticket seleccionado: {ticketDraft.parentKey}</small>}{parentError&&<small className="assigneeError">{parentError}</small>}</div></div>}
   <div className="ticketModalTwo"><label>Nombre del cliente<input maxLength={120} value={ticketDraft.customer} placeholder="Nombre real del cliente" onChange={e=>setTicketDraft({...ticketDraft,customer:e.target.value})}/></label><label>Tema del inconveniente<input maxLength={180} value={ticketDraft.title} placeholder="Ej.: No se actualiza el documento" onChange={e=>setTicketDraft({...ticketDraft,title:e.target.value})}/></label></div>
   <div style={{marginTop:8,marginBottom:14,padding:'10px 12px',borderRadius:8,border:'1px solid var(--line, #39404b)',overflowWrap:'anywhere'}}><small style={{display:'block',opacity:.7,marginBottom:4}}>Vista previa del título de Jira</small><strong>{ticketDraft.customer.trim()||'Nombre del cliente'} - {ticketDraft.title.trim()||'Tema del inconveniente'}</strong><small style={{display:'block',opacity:.75,marginTop:5}}>CLIENTE y SISTEMA se completan en sus campos de Jira, no en la descripción.</small></div>
   <div className="ticketAssigneeGroup"><div className="ticketSectionLabel">Responsable en Jira CW</div><div className="ticketAssigneeSearch ticketAssigneeAutomatic"><input aria-label="Buscar responsable" role="combobox" aria-autocomplete="list" aria-expanded={!!(assignees.length&&!ticketDraft.assigneeId)} aria-controls="jira-assignee-results" placeholder="Escribí parte del nombre (ej.: marc)" autoComplete="off" value={assigneeQuery} onChange={e=>{setAssigneeQuery(e.target.value);setTicketDraft(current=>current?{...current,assigneeId:''}:current);setAssignees([])}} onKeyDown={e=>{if(e.key==='Escape'){setAssignees([]);e.currentTarget.blur();}if(e.key==='Enter'&&assignees[0]&&!ticketDraft.assigneeId){e.preventDefault();setTicketDraft(current=>current?{...current,assigneeId:assignees[0].id}:current);setAssigneeQuery(assignees[0].name);setAssignees([]);}}}/>{assigneeLoading&&<span className="assigneeSearchSpinner" aria-label="Buscando">Buscando…</span>}</div>{ticketDraft.assigneeId&&<small className="assigneeChosen">✓ Responsable elegido: {assigneeQuery}</small>}{!ticketDraft.assigneeId&&assigneeQuery.length<2&&<small className="assigneeHelp">Escribí dos letras o más; las sugerencias aparecerán automáticamente.</small>}{assigneeError&&<small className="assigneeError" role="alert">{assigneeError}</small>}{assigneeQuery.trim().length>=2&&!assigneeLoading&&!ticketDraft.assigneeId&&!assignees.length&&!assigneeError&&<small className="assigneeHelp">No se encontraron responsables con ese texto.</small>}{!ticketDraft.assigneeId&&assignees.length>0&&<div className="ticketAssigneeResults" id="jira-assignee-results" role="listbox">{assignees.map(a=><button type="button" role="option" aria-selected={false} className="ticketAssigneeOption" key={a.id} onClick={()=>{setTicketDraft(current=>current?{...current,assigneeId:a.id}:current);setAssigneeQuery(a.name);setAssignees([])}}>{a.name}</button>)}</div>}</div>
  </div>{error&&<div className="ticketInlineError" role="alert"><ImageOff size={16}/>{error}</div>}<div className="ticketModalActions ticketModalFooter"><button className="smallButton" onClick={()=>setTicketDraft(null)}>Cancelar</button><button className="primary" disabled={loading||!ticketDraft.customer.trim()||ticketDraft.title.trim().length<5||(ticketDraft.kind==='subtask'&&!ticketDraft.parentKey)} onClick={()=>{const c=conversations.find(c=>c.phone===ticketDraft.phone);if(c)createConversation(c);}}>Confirmar y crear ticket CW</button></div>
 </div></div>}

 {tab==='panel'&&<><section className="metrics"><div className="metric"><div><span>Clientes WhatsApp</span><MessageCircle size={19}/></div><strong>{conversations.length}</strong><small>Conversaciones registradas</small></div><div className="metric"><div><span>Pendientes</span><Clock3 size={19}/></div><strong>{pending}</strong><small>Mensajes elegibles sin ticket CW</small></div><div className="metric"><div><span>Tickets creados</span><CheckCircle2 size={19}/></div><strong>{created}</strong><small>Total de tickets registrados</small></div><div className="metric"><div><span>Jira {health.project}</span><Server size={19}/></div><strong>{health.jiraRealEnabled?'Habilitado':'Deshabilitado'}</strong><small>Envío con autorización manual</small></div></section>
<section className="card"><div className="cardHead"><div><h2><Activity size={19}/> Conversaciones y seguimiento</h2><p>Mensajes, contactos, archivos y tickets en una sola vista. Actualización automática.</p></div><button className="simple" onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={16}/> Actualizar</button></div><div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
 <button className="simple" onClick={()=>setFilter('whatsapp')} style={{opacity:filter==='whatsapp'?1:.55}}>WhatsApp reales ({whatsappCount})</button>

 <button className="simple" onClick={()=>setFilter('all')} style={{opacity:filter==='all'?1:.55}}>Todos ({cases.length})</button>
 </div>{filter!=='simulator'&&<div className="chatLayout">
 <div className="chatRoster"><div className="chatRosterHead">Contactos <span>{visibleChats.length}</span></div><div className="chatFilters"><button className={chatView==='all'?'chosen':''} onClick={()=>setChatView('all')}>Todos ({conversations.length})</button><button className={chatView==='pending'?'chosen':''} onClick={()=>setChatView('pending')}>Pendientes ({pending})</button><button className={chatView==='created'?'chosen':''} onClick={()=>setChatView('created')}>Con ticket ({conversations.filter(c=>c.tickets?.length).length})</button></div><input className="chatSearch" placeholder="Buscar nombre o número..." value={chatSearch} onChange={e=>setChatSearch(e.target.value)}/>
 {chatSearch.trim()&&contactsError&&<small className="contactError">{contactsError}</small>}{chatSearch.trim()&&contacts.filter(c=>!conversations.some(x=>x.phone===c.phone)).map(c=><div className="contactSearchItem" key={c.phone}><strong>{c.name||'WhatsApp '+c.phone}</strong><small>{c.phone}</small><small>Sin mensajes registrados en TicketBridge. El chat aparecerá al registrar un mensaje.</small></div>)}
 {visibleChats.filter(c=>`${aliases[c.phone]||''} ${c.customer} ${c.phone}`.toLowerCase().includes(chatSearch.trim().toLowerCase())).map(c=> <button key={c.phone} className={'chatRosterItem '+(openChat===c.phone?'chosen':'')} onClick={()=>{setOpenChat(c.phone);setReplyOpen(false);setReplyText('');setReplyError('')}}><span className="contactAvatar">{c.avatar_url?<img src={c.avatar_url} alt="Foto del contacto" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none'}}/>:(aliases[c.phone]||c.customer||'?').slice(0,1).toUpperCase()}</span><span className="chatRosterCopy"><strong>{aliases[c.phone]||(!c.customer.startsWith('WhatsApp ')?c.customer:'Contacto sin nombre')}</strong><small>{c.phone}</small><small>{c.events.at(-1)?.message||'Sin mensajes'}</small></span><span className="chatRosterTime">{c.events.at(-1)?.local_time}</span></button>)}
 </div><div className="chatDetail">{(()=>{const c=conversations.find(v=>v.phone===openChat);if(!c)return <div className="chatEmpty">Seleccioná un cliente a la izquierda para ver sus mensajes e imágenes.</div>;const selectedNow=new Set(selectedIds(c));const count=selectedNow.size;const name=aliases[c.phone]||(!c.customer.startsWith('WhatsApp ')?c.customer:'Contacto sin nombre');return <><header className="chatDetailHeader"><span className="contactAvatar">{c.avatar_url?<img src={c.avatar_url} alt="Foto del contacto" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none'}}/>:name.slice(0,1).toUpperCase()}</span><div className="chatDetailWho"><strong>{name}</strong><small>{c.phone} · {c.events.length} mensajes</small></div>{(c.tickets?.length??0)>0?<button type="button" className="ticketHeaderButton" onClick={()=>showTicketPanel(c)}><Ticket size={15}/> {c.tickets.length} ticket(s) <ExternalLink size={12}/></button>:<span className={'tag '+(c.outside?'amber':'neutral')}>{c.outside?'Pendiente':'En horario'}</span>}<a className="openWhatsappWeb" href={'https://web.whatsapp.com/send?phone='+encodeURIComponent(c.phone)} target="_blank" rel="noopener noreferrer" title="Abrir este chat en WhatsApp Web para ver los archivos originales"><ExternalLink size={15}/> WhatsApp Web</a></header><div className="aliasRow"><label>Nombre local (si WhatsApp no proporciona el nombre)<input value={aliases[c.phone]||''} placeholder="Asignar nombre local opcional" onChange={e=>{const next={...aliases,[c.phone]:e.target.value};setAliases(next);localStorage.setItem('ticketbridge-contact-aliases',JSON.stringify(next));}}/></label></div><div className="selectionBar"><span>{count} mensaje(s) seleccionado(s)</span><button className="smallButton" disabled={!c.events.some(canSelectToday)} onClick={()=>setSelected(prev=>({...prev,[c.phone]:c.events.filter(canSelectToday).map(e=>e.id)}))}>Todos hoy</button><button className="smallButton" disabled={!count} onClick={()=>setSelected(prev=>({...prev,[c.phone]:[]}))}>Ninguno</button></div>{(syncingPhone===c.phone||historyPhone===c.phone)&&<div className="chatMediaSyncStatus" role="status"><RefreshCw size={12} className="syncSpin"/> Cargando imágenes y archivos automáticamente…</div>}{mediaWarning[c.phone]&&<div className="chatMediaWarning" role="status"><ImageOff size={14}/>{mediaWarning[c.phone]}</div>}<div className="chatDetailMessages">{c.events.map((e,i)=>{
 const dayKey=eventDateKey(e);
 const previousDay=i>0?eventDateKey(c.events[i-1]):null;
 const isOutgoing=e.direction==='out';
 const isSelected=selectedNow.has(e.id);
 return <div key={e.id} className="chatDayBlock">
  {dayKey!==previousDay&&<div className="chatDaySeparator" role="separator"><span>{chatDateLabel(dayKey,todayKey)}</span></div>}
  <div className={'chatEvent '+(isOutgoing?'outgoing':'incoming')}>
   <label className="chatSelect" title={e.usedInTicket||e.jira_key?'Mensaje asociado a un ticket':'Seleccionar este mensaje para el ticket'}>
    <input type="checkbox" aria-label={`Seleccionar mensaje del ${e.local_date} a las ${e.local_time}`} checked={isSelected}
     disabled={!canSelectMessage(e)} onChange={()=>toggleMsg(c,e.id)}/>
   </label>
   <div className="messageBubble">
    {!(e.message||'').startsWith('[Adjunto WhatsApp:')&&<div className="chatMessageText">{e.message}</div>}
    {e.media_path&&!brokenImages[e.id]&&(e.media_type?.startsWith('image/')?
     <button type="button" className="chatPhotoButton" onClick={()=>setPreview({id:e.id,name:e.media_name||'Foto de WhatsApp'})} title="Ampliar foto">
      <img src={'/api/media/'+e.id} loading="lazy" alt={e.media_name||'Imagen de WhatsApp'} className="chatImage" onError={()=>setBrokenImages(prev=>({...prev,[e.id]:true}))}/>
     </button>:
     e.media_type?.startsWith('video/')?<video className="chatVideo" src={'/api/media/'+e.id} controls playsInline preload="metadata"/>:
     e.media_type?.startsWith('audio/')?<audio className="chatAudio" src={'/api/media/'+e.id} controls preload="none"/>:
     <a className="chatFileLink" href={'/api/media/'+e.id} target="_blank" rel="noopener noreferrer"><FileText size={16}/> {e.media_name||'Abrir documento'} <ExternalLink size={12}/></a>)}
    {(isMissingMedia(e)||brokenImages[e.id])&&<div className="chatMediaFallback">
     <div className="chatMediaFallbackTitle">{(e.message||'').includes('video')?<Film size={20}/>: (e.message||'').includes('audio')?<Mic size={20}/>:<ImageOff size={20}/>}<span>Adjunto de WhatsApp</span></div>
     <small>{!waStatus.connected?'Archivo aún no disponible; WhatsApp está desconectado':syncingPhone===c.phone?'Cargando desde WhatsApp…':automaticallySynced.current.get(c.phone)?.has(e.id)?'Archivo original no disponible en esta sesión':'Pendiente de carga automática'}</small>
    </div>}
    <div className="chatMessageMeta"><time dateTime={e.received_at} title={`${e.local_date} ${e.local_time} · ${e.outside_hours?'Fuera de horario':'En horario'}`}>{e.local_time?.slice(0,5)}</time></div>
   </div>
  </div>
 </div>;
 })}</div><div className="chatDetailActions"><button className="smallButton" onClick={()=>setReplyOpen(v=>!v)}><Send size={14}/> {replyOpen?'Cerrar respuesta':'Responder'}</button>{<button className="smallButton" disabled={loading||!health.jiraRealEnabled||!count} onClick={()=>openTicketDraft({...c,customer:name})}><Plus size={14}/> Nuevo ticket / subtarea CW ({count})</button>}</div>{replyOpen&&<div className="replyComposer"><textarea rows={3} placeholder="Escribí tu respuesta al cliente..." aria-label="Mensaje de respuesta" value={replyText} onChange={e=>{setReplyText(e.target.value);setReplyError('')}} maxLength={3000}/>{replyError&&<small className="replyInlineError" role="alert">{replyError}</small>}<div><small>{waStatus.connected?'WhatsApp conectado · Se enviará al pulsar Enviar.':'WhatsApp desconectado · iniciá npm run whatsapp para responder.'}</small><button className="primary" disabled={sendingReply||!replyText.trim()||!waStatus.connected} onClick={()=>void sendReply(c)}><Send size={14}/> {sendingReply?'Enviando…':'Enviar'}</button></div></div>}</>})()}</div></div>}
 {filter!=='whatsapp'&&<div className="tableWrap"><table><thead><tr><th>CASO</th><th>CLIENTE / MENSAJE</th><th>FECHA PARAGUAY</th><th>REGLA</th><th>ESTADO</th><th>ACCIÓN</th></tr></thead><tbody>{filtered.filter(c=>c.source!=='whatsapp').map(c=><tr key={c.id}><td className="mono">#{c.id}</td><td><b>{c.customer}</b><small>{c.source==='whatsapp'?'WhatsApp real':'Simulación'}</small><small className="messageFull" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:500}}>{expanded===c.id?c.message:c.message.length>140?c.message.slice(0,140)+'…':c.message}</small>{c.message.length>140&&<button className="simple" onClick={()=>setExpanded(expanded===c.id?null:c.id)}>{expanded===c.id?'Ver menos':'Leer mensaje completo'}</button>}</td><td>{c.local_date}<small>{c.local_time}</small></td><td>{c.reason}</td><td><span className={'tag '+(c.status==='created'?'success':c.status==='pending'?'amber':c.status==='ignored'?'neutral':'red')}>{c.status==='created'&&c.jira_key&&jiraLink(c.jira_key)?<a className="jiraTicketLink" target="_blank" rel="noopener noreferrer" href={jiraLink(c.jira_key)!} title="Abrir ticket en Jira">{c.jira_key}<ExternalLink size={13}/></a>:c.status==='created'?'Creado':c.status==='pending'?'Pendiente':c.status==='ignored'?'Sin ticket':'Revisar'}</span>{c.error&&<small title={c.error}>Revisar error</small>}</td><td>{c.status==='pending'?<button disabled={loading||!health.jiraRealEnabled} title={health.jiraRealEnabled?'Crea ticket real':'Habilitá ENABLE_REAL_JIRA=true'} className="smallButton" onClick={()=>create(c)}><Plus size={14}/> Crear ticket CW</button>:c.jira_key?<a target="_blank" rel="noreferrer" href={jiraLink(c.jira_key)||'#'}>Ver ticket <ExternalLink size={13}/></a>:<span className="empty">—</span>}</td></tr>)}{filtered.filter(c=>c.source!=='whatsapp').length===0&&<tr><td colSpan={6} className="emptyRow">No hay registros en esta vista.</td></tr>}</tbody></table></div>}</section></>}
 {tab==='settings'&&<div className="two"><section className="card"><div className="cardHead"><div><h2><CalendarDays size={20}/> Calendario de días no laborables</h2><p>Ingresá fechas efectivas de Paraguay, incluidos traslados y feriados extraordinarios.</p></div></div><label>Fecha<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label><label>Nombre del feriado<input placeholder="Ej. Feriado nacional confirmado" value={holidayName} onChange={e=>setHolidayName(e.target.value)}/></label><button className="primary" disabled={loading||!day||!holidayName} onClick={()=>perform(async()=>{await req('/api/holidays','POST',{date:day,name:holidayName});setDay('');setHolidayName('');setNotice('Feriado guardado.');})}><Plus size={16}/> Guardar feriado</button><div className="note"><CalendarDays size={19}/><p>Para evitar fechas incorrectas, el sistema no inventa feriados. Cargá los confirmados oficialmente. Las fechas se guardan en SQLite.</p></div></section><section className="card"><div className="cardHead"><div><h2>Feriados configurados</h2><p>{holidays.length} feriados configurados</p></div></div>{holidays.length===0?<p className="emptyText">Todavía no cargaste feriados. Hasta entonces, se detectarán fines de semana y horarios, pero no días festivos.</p>:holidays.map(h=><div className="holiday" key={h.date}><div><strong>{h.date}</strong><small>{h.name}</small></div><button title="Eliminar feriado" className="iconButton" onClick={()=>perform(async()=>{await req('/api/holidays','DELETE',{date:h.date});setNotice('Feriado eliminado.');})}><Trash2 size={16}/></button></div>)}</section></div>}
 {tab==='settings'&&<><section className="card"><div className="cardHead"><div><h2><MessageCircle size={19}/> Conexiones</h2><p>Estado del conector y Jira</p></div></div><div className="detail"><span>WhatsApp QR</span><strong>{waStatus.connected?'Conectado':waStatus.service?'Iniciando sesión':'Conector no disponible'}</strong></div><div className="detail"><span>Jira CW</span><strong>{health.jiraRealEnabled?'Habilitado':'Deshabilitado'}</strong></div><p className="emptyText">El conector QR es no oficial. Los mensajes solo se envían cuando confirmás Responder.</p></section><div className="two"><section className="card"><div className="cardHead"><div><h2><Clock3 size={19}/> Horario de atención</h2><p>Zona horaria fija: America/Asuncion.</p></div></div><div className="formGrid"><label>Inicio<input type="time" value={settings.start} onChange={e=>setSettings({...settings,start:e.target.value})}/></label><label>Fin<input type="time" value={settings.end} onChange={e=>setSettings({...settings,end:e.target.value})}/></label></div><button className="primary" disabled={loading} onClick={()=>perform(async()=>{await req('/api/settings','PUT',settings);setNotice('Horario actualizado.');})}>Guardar horario</button><div className="note"><Clock3 size={19}/><p>Los sábados y domingos siempre se consideran fuera del horario. Los feriados cargados también, aunque sean días de semana.</p></div></section><section className="card"><div className="cardHead"><div><h2><Settings2 size={19}/> Conexión Jira</h2><p>Las credenciales se guardan en el archivo local .env.local.</p></div></div><div className="detail"><span>Proyecto</span><strong>{health.project}</strong></div><div className="detail"><span>Creación real</span><strong>{health.jiraRealEnabled?'Habilitada':'Deshabilitada'}</strong></div><div className="detail"><span>Conector WhatsApp</span><strong>Proceso separado (npm run whatsapp)</strong></div><button className="outline" onClick={checkJira} disabled={loading}>Probar credenciales de Jira</button><div className="note"><ShieldCheck size={19}/><p>Este laboratorio escucha solo en 127.0.0.1:3000. Nunca publiques .env.local ni la carpeta data.</p></div></section></div></>}
 {tab==='settings'&&<section className="card"><div className="cardHead"><div><h2><MessageCircle size={19}/> Simulador de mensajes (pruebas)</h2><p>Esta herramienta no recibe mensajes reales de WhatsApp.</p></div></div><div><div className="cardHead"><div><h2><MessageCircle size={19}/> Simulador de mensajes</h2><p>Probá un caso sin acceder a tus conversaciones.</p></div><span className="pill">SIMULACIÓN</span></div><div className="formGrid"><label>Cliente<input value={customer} onChange={e=>setCustomer(e.target.value)} maxLength={120}/></label><label>Teléfono de prueba<input value={phone} onChange={e=>setPhone(e.target.value)} maxLength={30}/></label></div><label>Fecha y hora del mensaje<input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Descripción del problema<textarea rows={4} value={message} onChange={e=>setMessage(e.target.value)} maxLength={3000}/></label><button className="primary" disabled={loading||!date} onClick={simulate}><Send size={16}/> Simular recepción de mensaje</button>{rule&&<div className={'rule '+(rule.outside?'warn':'safe')}><strong>{rule.outside?'Fuera del horario: elegible para Jira':'Dentro del horario: sin ticket'}</strong><span>{rule.reason} · {rule.date} {rule.hour} (Paraguay)</span></div>}</div></section>}
 {preview&&<div className="imageLightbox" role="dialog" aria-modal="true" aria-label="Vista ampliada de imagen" onClick={()=>setPreview(null)}><div className="imageLightboxContent" onClick={e=>e.stopPropagation()}><div><strong>{preview.name}</strong><button className="smallButton" onClick={()=>setPreview(null)}>Cerrar ×</button></div><img src={'/api/media/'+preview.id} alt={preview.name}/><a href={'/api/media/'+preview.id} target="_blank" rel="noopener noreferrer">Abrir archivo original ↗</a></div></div>}<footer>TicketBridge · WhatsApp QR experimental · Respuestas manuales · Jira CW · Paraguay</footer></main></div>;
}
