'use client';
import SupportAutomationSettings from './components/SupportAutomationSettings';
import WhatsAppConnectionPanel from './components/WhatsAppConnectionPanel';
import AutomationScenarioSuite from './components/AutomationScenarioSuite';
import SimulationPhoneLab from './components/SimulationPhoneLab';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Activity,CalendarDays,CheckCircle2,Clock3,ExternalLink,MessageCircle,Plus,RefreshCw,Send,Server,Settings2,ShieldCheck,Ticket,Trash2,WifiOff,Palette,ImageOff,Film,Mic,FileText,Pin,Check,CheckCheck,Users,Eye,EyeOff,Star,ShieldOff,ChevronDown,Search,MoreHorizontal,SmilePlus,Paperclip,X,Reply,Copy,Download,Forward,NotebookPen} from 'lucide-react';
type C={id:number;source?:string;customer:string;phone:string;message:string;local_date:string;local_time:string;reason:string;outside_hours:number;status:string;jira_key:string|null;error:string|null};
type Contact={phone:string;name:string;chatId?:string;isGroup?:boolean;unreadCount?:number;displayPhone?:string};
type Conversation={phone:string;customer:string;avatar_url?:string|null;outside:boolean;is_group:boolean;unread_count:number;marked_unread:boolean;pinned:boolean;favorite:boolean;ticket:{jira_key:string|null,status:string,error:string|null}|null;tickets:Array<{id:number,jira_key:string,title:string,kind:string,parent_key:string|null,created_at:string;assignee_name?:string|null;assignee_id?:string|null;jira_status?:string|null;jira_status_category?:string|null;jira_synced_at?:string|null}>;events:Array<C & {received_at:string,media_path:string|null,media_type?:string|null,media_name?:string|null,media_error?:string|null;media_source?:string|null;has_media?:number;direction?:string;usedInTicket?:boolean;wa_ack?:number|null;is_group?:number;sender_name?:string|null;wa_message_id?:string|null;message_pinned?:boolean;message_starred?:boolean;message_note?:string;reactions?:Array<{emoji:string;count:number;mine:boolean}>}>};
type Holiday={date:string;name:string};
type Rule={outside:boolean;reason:string;date:string;hour:string};
type JiraDetail={key:string;summary:string;status:string;description:string;assignee?:{id:string;name:string}|null;attachments:Array<{id:string;filename:string;mime:string;size:number}>;localMedia?:Array<{id:number;media_type:string;media_name:string;media_source?:string}>;missingMedia?:Array<{id:number;local_time:string}>;url:string};
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
// Orden numérico real del correlativo Jira (CW-1000 antes de CW-999).
// No confundir el ID local o la fecha del mensaje con el número del ticket.
function byJiraCorrelative<T extends {jira_key:string|null;id?:number}>(items:T[]):T[]{
 const number=(key:string|null)=>{const match=/^CW-(\d+)$/.exec(key||'');return match?Number(match[1]):-1;};
 return [...items].sort((a,b)=>number(b.jira_key)-number(a.jira_key)||(b.id||0)-(a.id||0));
}

function ticketDateLabel(value:string){
 if(!value)return 'Fecha no disponible';
 const d=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');
 return Number.isNaN(d.getTime())?value.slice(0,16):new Intl.DateTimeFormat('es-PY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Asuncion'}).format(d);
}
const CHAT_EMOJIS=['😀','😃','😂','🤣','😊','😍','🥰','😉','😎','🤔','😢','😮','😅','👍','👎','👏','🙏','❤️','💙','💚','🔥','🎉','✅','👋'];
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
 const [theme,setTheme]=useState<'dark'|'light'>('dark');const [accent,setAccent]=useState<'neutral'|'emerald'|'cyan'|'violet'|'orange'|'rose'>('emerald');const [showAppearance,setShowAppearance]=useState(false);const [chatView,setChatView]=useState<'chats'|'all'|'unread'|'favorites'|'excluded'|'groups'|'pending'|'created'>('chats');const [showMoreFilters,setShowMoreFilters]=useState(false);const [preview,setPreview]=useState<{id:number;name:string}|null>(null);const [ticketDraft,setTicketDraft]=useState<{phone:string;customer:string;title:string;assigneeId:string;kind:'issue'|'subtask';parentKey:string;system:'Futura100'|'Talento100'|'Otros sistemas'}|null>(null);const [jiraParents,setJiraParents]=useState<Array<{key:string;summary:string}>>([]);const [parentQuery,setParentQuery]=useState('');const [parentLoading,setParentLoading]=useState(false);const [parentError,setParentError]=useState('');const [contacts,setContacts]=useState<Contact[]>([]);const [contactsError,setContactsError]=useState('');const [reactionFor,setReactionFor]=useState<number|null>(null);const [reactionBusy,setReactionBusy]=useState<number|null>(null);const [reactionError,setReactionError]=useState('');const [reactionAnchor,setReactionAnchor]=useState<{id:number;phone:string;left:number;top:number}|null>(null);const [assignees,setAssignees]=useState<Array<{id:string;name:string}>>([]);const [assigneeQuery,setAssigneeQuery]=useState('');const [assigneeLoading,setAssigneeLoading]=useState(false);const [assigneeError,setAssigneeError]=useState('');const [waStatus,setWaStatus]=useState<{connected:boolean;service:boolean;compatible?:boolean;accountId?:string|null;version?:string;error?:string|null}>({connected:false,service:false});const [replyOpen,setReplyOpen]=useState(false);const [replyText,setReplyText]=useState('');const [replyAttachment,setReplyAttachment]=useState<{file:File;preview:string|null;mime:string}|null>(null);const [dropActive,setDropActive]=useState(false);const replyFileInput=useRef<HTMLInputElement|null>(null);const [openChat,setOpenChat]=useState<string|null>(null);const [rosterMode,setRosterMode]=useState<'chats'|'contacts'>('chats');const [externalContact,setExternalContact]=useState<Contact|null>(null);const [stateBusy,setStateBusy]=useState<string|null>(null);const [chatSearch,setChatSearch]=useState('');const [aliases,setAliases]=useState<Record<string,string>>({});const [selected,setSelected]=useState<Record<string,number[]>>({});const [tab,setTab]=useState<'panel'|'settings'>('panel');const [filter,setFilter]=useState<'all'|'whatsapp'|'simulator'>('whatsapp');const [expanded,setExpanded]=useState<number|null>(null);const [cases,setCases]=useState<C[]>([]);const [conversations,setConversations]=useState<Conversation[]>([]);const [holidays,setHolidays]=useState<Holiday[]>([]);const [settings,setSettings]=useState({start:'08:00',end:'18:00',automationEnabled:false,automationAssigneeId:''});
 const [health,setHealth]=useState({jiraRealEnabled:false,project:'CW'});const [customer,setCustomer]=useState('Cliente de prueba');const [phone,setPhone]=useState('+595981000000');const [message,setMessage]=useState('No puedo ingresar al sistema, aparece un error de conexión.');const [date,setDate]=useState('');const [notice,setNotice]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [rule,setRule]=useState<Rule|null>(null);const [day,setDay]=useState('');const [holidayName,setHolidayName]=useState('');
 const [automationPrefs,setAutomationPrefs]=useState<Record<string,{paused:boolean;forceEnabled:boolean}>>({});
 const [excludedContacts,setExcludedContacts]=useState<Record<string,{name:string;excluded:number;override:string}>>({});
 const [excludedBusy,setExcludedBusy]=useState<string|null>(null);
 const [excludedError,setExcludedError]=useState('');
 const [exclusionsLoaded,setExclusionsLoaded]=useState(false);
 const isExcluded=(phone:string)=>Boolean(excludedContacts[phone]?.excluded===1||excludedContacts[phone]?.override==='disabled');
 async function reloadExclusions(){
  const response=await req<{items:Array<{phone:string;name?:string;excluded:number;override:string}>}>('/api/automation/people?kind=excluded');
  const result:Record<string,{name:string;excluded:number;override:string}>={};
  for(const entry of response.items||[])result[entry.phone]={name:entry.name||entry.phone,excluded:entry.excluded,override:entry.override};
  setExcludedContacts(result);setExclusionsLoaded(true);setExcludedError('');
 }
 useEffect(()=>{
  if(!waStatus.connected){setExcludedContacts({});setExclusionsLoaded(false);return;}
  void reloadExclusions().catch(e=>setExcludedError(e instanceof Error?e.message:'No se pudieron cargar las exclusiones'));
 },[waStatus.connected,waStatus.accountId]);
 async function toggleClientAutomation(phone:string,name:string,isGroup=false){
  if(isGroup){setError('Los grupos nunca reciben respuestas automáticas.');return;}
  if(!waStatus.connected){setError('Conectá WhatsApp para editar la automatización de este contacto.');return;}
  if(!/^\d{5,40}$/.test(phone)){setError('No se pudo identificar un número válido de WhatsApp para este contacto.');return;}
  const excluded=!isExcluded(phone);
  setExcludedBusy(phone);setExcludedError('');
  try{
   await req('/api/automation/people','POST',{kind:'client',phone,excluded,override:'default'});
   await reloadExclusions();
   setNotice(excluded?`Sin automatización: ${name}`:`Asistente habilitado para ${name}`);
  }catch(e){const text=e instanceof Error?e.message:'No se pudo guardar la preferencia';setExcludedError(text);setError(text);}
  finally{setExcludedBusy(null);}
 }
 const readSyncNextAttempt=useRef(0);
 const [managedTickets,setManagedTickets]=useState<Array<Conversation['tickets'][number] & {ownerPhone:string;ownerName:string}>>([]);
 const [ticketsPhone,setTicketsPhone]=useState<string|null>(null);
 const [ticketKey,setTicketKey]=useState<string|null>(null);const [ticketOwner,setTicketOwner]=useState<string|null>(null);
 const [jiraDetail,setJiraDetail]=useState<JiraDetail|null>(null);
 const [detailLoading,setDetailLoading]=useState(false);
 const [detailError,setDetailError]=useState('');
 useEffect(()=>()=>{if(replyAttachment?.preview)URL.revokeObjectURL(replyAttachment.preview);},[replyAttachment]);
 const [sendingReply,setSendingReply]=useState(false);
 const [quoteTarget,setQuoteTarget]=useState<{phone:string;id:number;message:string;waId:string|null}|null>(null);
 const [msgMenu,setMsgMenu]=useState<{phone:string;id:number;left:number;top:number}|null>(null);
 const [forwardTarget,setForwardTarget]=useState<{phone:string;id:number}|null>(null);
 const [forwardPhone,setForwardPhone]=useState('');
 const [forwardBusy,setForwardBusy]=useState(false);
 const [noteTarget,setNoteTarget]=useState<{phone:string;id:number}|null>(null);
 const [noteText,setNoteText]=useState('');
 const [msgActionBusy,setMsgActionBusy]=useState(false);


 const [settingsSection,setSettingsSection]=useState<'tickets'|'advanced'>('tickets');
 const [toolTab,setToolTab]=useState<'assistant'|'connection'|'tools'>('assistant');
 const lastLinkedAccount=useRef<string|null>(null);
 const [legacyCount,setLegacyCount]=useState(0);
 const [legacyBusy,setLegacyBusy]=useState(false);
 const visibilityNextAt=useRef(0);
 const [visibility,setVisibility]=useState<{connected:boolean;totalMessages:number;visibleMessages:number;unassignedMessages:number;otherAccountMessages:number;totalTickets:number;mediaSaved:number;help:string}|null>(null);
 const [ticketStateFilter,setTicketStateFilter]=useState<'all'|'todo'|'progress'|'done'|'unknown'|'sopn1'|'sopn2'>('all');
 const [ticketSearch,setTicketSearch]=useState('');
 const [ticketAssigneeFilter,setTicketAssigneeFilter]=useState('all');
 const [ticketStatusBusy,setTicketStatusBusy]=useState(false);
 const [ticketStatusMessage,setTicketStatusMessage]=useState('');
 const ticketStatusAttempted=useRef(false);
 const [editingAlias,setEditingAlias]=useState(false);
 const [approval,setApproval]=useState<{heading:string;body:string;accept:string;warning:boolean}|null>(null);
 const [ticketSuccess,setTicketSuccess]=useState<{key:string;uploaded:number;warnings:string[]}|null>(null);
 const approvalResolve=useRef<((value:boolean)=>void)|null>(null);
 function askApproval(heading:string,body:string,accept='Confirmar',warning=false):Promise<boolean>{
  return new Promise(resolve=>{approvalResolve.current=resolve;setApproval({heading,body,accept,warning});});
 }
 function closeApproval(answer:boolean){const done=approvalResolve.current;approvalResolve.current=null;setApproval(null);done?.(answer);}
 useEffect(()=>{if(!approval)return;const handler=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeApproval(false)}};document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler);},[approval]);

 const [replyError,setReplyError]=useState('');
 const [showReplyEmojis,setShowReplyEmojis]=useState(false);
 const replyTextareaRef=useRef<HTMLTextAreaElement|null>(null);
 const sendingReplyRef=useRef(false);
 const detailsRequestId=useRef(0);
 const historyDiscovered=useRef(new Set<string>());const historyImported=useRef(new Set<string>());
 const [historyPhone,setHistoryPhone]=useState<string|null>(null);const [importingPhone,setImportingPhone]=useState<string|null>(null);
 const [mediaWarning,setMediaWarning]=useState<Record<string,string>>({});
 const automaticallySynced=useRef(new Map<string,Set<number>>());
 const syncingChats=useRef(new Set<string>());
 const lastOpenInbound=useRef(new Map<string,number>());const messagesRef=useRef<HTMLDivElement|null>(null);const nearBottomRef=useRef(true);
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
    const result=await req<{ok:boolean;saved:number;failed:number;items:Array<{id:number;ok:boolean;error?:string}>}>('/api/whatsapp/media/sync','POST',{phone,ids:batch.map(e=>e.id),forceIds:batch.filter(e=>brokenImages[e.id]).map(e=>e.id)});
    const updated=await req<Conversation[]>('/api/conversations');setConversations(updated);
    if(result.saved)setBrokenImages(prev=>{const next={...prev};for(const item of result.items)if(item.ok)delete next[item.id];return next;});
    if(result.failed){const failures=result.items.filter(item=>!item.ok).map(item=>item.error).filter(Boolean);setMediaWarning(prev=>({...prev,[phone]:failures[0]||'WhatsApp no entregó el adjunto todavía.'}));}else if(result.saved)setMediaWarning(prev=>({...prev,[phone]:''}));
   }
  }catch(e){console.warn('[Multimedia] No se pudo sincronizar la conversación',e);setMediaWarning(prev=>({...prev,[phone]:e instanceof Error?e.message:'No se pudo sincronizar la imagen'}));}
  finally{syncingChats.current.delete(phone);setSyncingPhone(current=>current===phone?null:current);}
 }
 async function refresh(){const [a,b,c,d]=await Promise.all([req<C[]>('/api/tickets'),req<Holiday[]>('/api/holidays'),req<{start:string,end:string,automation_enabled?:string,automation_assignee_id?:string}>('/api/settings'),req<typeof health>('/api/health')]);try{const status=await req<typeof waStatus>('/api/whatsapp/status');setWaStatus(status);if(status.connected){setCases(a);const [chats,tickets]=await Promise.allSettled([req<Conversation[]>('/api/conversations'),req<typeof managedTickets>('/api/jira/managed')]);if(chats.status==='fulfilled')setConversations(chats.value);if(tickets.status==='fulfilled')setManagedTickets(tickets.value);}else{setConversations([]);setCases([]);setManagedTickets([]);}}catch{/* Si un endpoint falla, no borrar chats o tickets que ya se habían recuperado. */}setHolidays(b);setSettings({...c,automationEnabled:c.automation_enabled==='1',automationAssigneeId:c.automation_assignee_id||''});setHealth(d);}
 useEffect(()=>{setDate(initialDate());try{setAliases(JSON.parse(localStorage.getItem('ticketbridge-contact-aliases')||'{}'));setTheme(localStorage.getItem('ticketbridge-theme')==='light'?'light':'dark');const savedAccent=localStorage.getItem('ticketbridge-accent');if(['neutral','emerald','cyan','violet','orange','rose'].includes(savedAccent||''))setAccent(savedAccent as 'neutral'|'emerald'|'cyan'|'violet'|'orange'|'rose');}catch{}refresh().catch(e=>setError(e.message));},[]);
 // Polling solo de lectura: no crea tickets ni envía respuestas.
 useEffect(()=>{if(chatSearch.trim().length<2){setContacts([]);setContactsError('');return;}const timer=setTimeout(()=>{void searchContacts(chatSearch)},350);return()=>clearTimeout(timer)},[chatSearch,rosterMode,waStatus.connected]);
 useEffect(()=>{
  if(tab!=='panel')return;
  let alive=true;
  let inFlight=false;
  async function poll(){
   if(!alive||inFlight||document.visibilityState==='hidden')return;
   inFlight=true;
   try{
    const status=await req<typeof waStatus>('/api/whatsapp/status').catch(()=>null);
    if(!alive)return;
    if(!status?.connected || status.compatible===false){
      // No consultar /read-sync o /conversations sin una sesión vinculada:
      // evita cientos de HTTP 503 y no mezcla contactos de cuentas anteriores.
      setConversations([]);setCases([]);setManagedTickets([]);setContacts([]);
      setOpenChat(null);setExternalContact(null);
      if(status)setWaStatus(status);
      return;
    }
    // La lectura remota puede fallar temporalmente: no bloquear mensajes o tickets.
    // Si el navegador de WhatsApp no responde, limitar las consultas remotas.
    if(Date.now()>=readSyncNextAttempt.current){
      readSyncNextAttempt.current=Date.now()+30000;
      void req('/api/whatsapp/read-sync')
        .then(()=>{readSyncNextAttempt.current=Date.now()+15000;})
        .catch(()=>{readSyncNextAttempt.current=Date.now()+60000;});
    }
    if(Date.now()>=visibilityNextAt.current){visibilityNextAt.current=Date.now()+15000;void req<typeof visibility>('/api/diagnostics/visibility').then(v=>{if(alive)setVisibility(v)}).catch(()=>{});}
    const [newCases,newConversations,newTickets]=await Promise.allSettled([
      req<C[]>('/api/tickets'),
      req<Conversation[]>('/api/conversations'),
      req<typeof managedTickets>('/api/jira/managed')
    ]);
    if(alive){setWaStatus(status);
      if(newCases.status==='fulfilled')setCases(newCases.value);
      if(newConversations.status==='fulfilled')setConversations(newConversations.value);
      if(newTickets.status==='fulfilled')setManagedTickets(newTickets.value);
    }
   }catch{/* Mantener los datos existentes si la conexión se interrumpe. */}
   finally{inFlight=false;}
  }
  const timer=setInterval(poll,6000);
  document.addEventListener('visibilitychange',poll);
  return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
 },[tab]);
 useEffect(()=>{
  const current=waStatus.connected?waStatus.accountId||null:null;
  if(lastLinkedAccount.current!==current){
    lastLinkedAccount.current=current;
    setOpenChat(null);setExternalContact(null);setSelected({});setContacts([]);
  }
 },[waStatus.connected,waStatus.accountId]);
 // La recuperación del historial anterior solo se hace con aprobación del operador.
 useEffect(()=>{
  if(!waStatus.connected){setLegacyCount(0);return;}
  let live=true;
  void req<{count:number}>('/api/whatsapp/legacy-history').then(v=>{if(live)setLegacyCount(v.count||0)}).catch(()=>{});
  return()=>{live=false;};
 },[waStatus.connected,waStatus.accountId]);
 async function claimLegacyHistory(){
  if(!waStatus.connected||legacyBusy)return;
  if(!window.confirm('¿Confirmás que todas las conversaciones antiguas pertenecen a esta cuenta de WhatsApp? No se borrarán datos. No se podrá asociar ese historial a otro número después.'))return;
  setLegacyBusy(true);
  try{await req('/api/whatsapp/legacy-history','POST',{confirm:'ASOCIAR_HISTORIAL'});setLegacyCount(0);await refresh();setNotice('Historial anterior asociado a esta cuenta de WhatsApp.');}
  catch(e){setError(e instanceof Error?e.message:'No se pudo asociar el historial anterior.');}
  finally{setLegacyBusy(false);}
 }
 // Al abrir la conversación, y cuando llega un mensaje mientras está abierta,
 // solicitamos el visto REAL al conector; no se fabrica un check azul local.
 // Evita que el visto automático deshaga el 'No leído' elegido manualmente
 // mientras la misma conversación permanece abierta.
 const manualUnreadChats=useRef(new Set<string>());
 const lastReadAttempt=useRef(new Map<string,number>());
 useEffect(()=>{
  if(!openChat||tab!=='panel'||!waStatus.connected||document.visibilityState!=='visible'||manualUnreadChats.current.has(openChat))return;
  const incoming=conversations.find(c=>c.phone===openChat)?.events.filter(e=>e.direction!=='out').at(-1);
  if(!incoming)return;
  const previous=lastReadAttempt.current.get(openChat);
  if(previous===incoming.id)return;
  lastReadAttempt.current.set(openChat,incoming.id);
  void changeChatState(openChat,'read');
 },[conversations,openChat,tab,waStatus.connected]);
 // Al abrir una conversación, recuperar una ventana limitada de mensajes reales y sus archivos.
 useEffect(()=>{
  if(!openChat||!waStatus.connected||historyImported.current.has(openChat)||tab!=='panel')return;
  const id=openChat;historyImported.current.add(id);setImportingPhone(id);
  void req<{ok:boolean;processed:number}>('/api/whatsapp/history','POST',{phone:id})
   .then(async()=>{const fresh=await req<Conversation[]>('/api/conversations');setConversations(fresh);})
   .catch(e=>console.warn('[Historial WhatsApp] No disponible',e))
   .finally(()=>setImportingPhone(current=>current===id?null:current));
 },[openChat,waStatus.connected,tab]);
 // Una consulta inicial permite mostrar las reacciones hechas desde el teléfono
 // antes de abrir TicketBridge. Los eventos nuevos llegan al backend en tiempo real.
 useEffect(()=>{
  if(!openChat||!waStatus.connected||tab!=='panel')return;
  let live=true;
  async function loadReactions(){
   try{await req('/api/whatsapp/reactions/sync','POST',{phone:openChat});
    if(live)setConversations(await req<Conversation[]>('/api/conversations'));
   }catch(e){console.warn('[Reacciones] Sincronización pendiente',e);}
  }
  void loadReactions();
  const timer=setInterval(loadReactions,60000);
  return()=>{live=false;clearInterval(timer)};
 },[openChat,waStatus.connected,tab]);
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
 const newestDisplayedMessage=conversations.find(c=>c.phone===openChat)?.events.at(-1)?.id||0;
 useEffect(()=>{const el=messagesRef.current;if(el && nearBottomRef.current)el.scrollTop=el.scrollHeight;},[newestDisplayedMessage,openChat]);
 const filtered=cases.filter(c=>filter==='all'||(filter==='whatsapp'?c.source==='whatsapp':c.source!=='whatsapp'));
 const whatsappCount=cases.filter(c=>c.source==='whatsapp').length;
 const todayKey=paraguayDateKey(new Date());
 async function perform(fn:()=>Promise<void>){setLoading(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:'Error desconocido');}finally{setLoading(false);}}
 async function simulate(){await perform(async()=>{const dt=new Date(date);if(Number.isNaN(dt.getTime()))throw Error('Fecha inválida');const data=await req<{rule:Rule}>('/api/simulate','POST',{customer,phone,message,receivedAt:dt.toISOString(),eventId:crypto.randomUUID()});setRule(data.rule);setNotice(data.rule.outside?'Caso simulado y preparado. Para crear un ticket real, usá el botón Enviar a Jira.':'Mensaje simulado dentro de horario: sin ticket.');});}
 async function create(c:C){
  if(!await askApproval('Confirmar ticket en Jira',`Se creará un ticket real en ${health.project} para el caso #${c.id}.`, 'Crear ticket'))return;
  await perform(async()=>{
   const payload:{id:number;allowMissingEvidence?:boolean}={id:c.id};
   let result:{key:string;attachments?:{uploaded:number;errors:string[]};missingEvidence?:number[]}|null=null;
   try {result=await req('/api/jira/create','POST',payload);}catch(err){
    const problem=err as Error&{code?:string};
    if(problem.code!=='MISSING_EVIDENCE')throw err;
    if(!await askApproval('Faltan evidencias','La imagen original no pudo recuperarse. Si continuás, este ticket se creará sin esa evidencia. Recomendamos cancelar y descargarla primero.', 'Crear sin imagen',true))throw Error('Ticket no creado. Recuperá la imagen primero.');
    payload.allowMissingEvidence=true;
    result=await req('/api/jira/create','POST',payload);
   }
   if(!result)throw Error('No se confirmó la creación del ticket');
   const {key,attachments,missingEvidence}=result;
   if(missingEvidence?.length||attachments?.errors?.length){
    setError(`Ticket ${key} creado, pero hay imágenes pendientes o no confirmadas en Jira. Revisá la pestaña de adjuntos.`);
   }else setNotice(`Ticket ${key} creado con ${attachments?.uploaded||0} archivo(s) adjunto(s) confirmado(s) en Jira.`);
  });
 }
 async function openTicketDraft(c:Conversation){
  const chosen=selectedIds(c);
  if(!chosen.length){setError('Seleccioná al menos un mensaje para crear el ticket.');return;}

  const displayName=(aliases[c.phone]||c.customer||'').trim();
  const realName=/^(WhatsApp\s+\S+|Contacto sin nombre)$/i.test(displayName)?'':displayName;
  setTicketDraft({phone:c.phone,customer:realName,title:'',assigneeId:'',kind:'issue',parentKey:'',system:'Futura100'});
  setAssigneeQuery('');setAssignees([]);setAssigneeError('');setParentQuery('');setJiraParents([]);setParentError('');setError('');setTicketSuccess(null);
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

 async function searchContacts(q:string){
  if(q.trim().length<2){setContacts([]);setContactsError('');return;}
  if(!waStatus.connected || waStatus.compatible===false){setContacts([]);setContactsError('Vinculá primero la cuenta de WhatsApp. Sin sesión lista no se puede consultar la agenda real.');return;}
  try{
   const response=await fetch('/api/whatsapp/contacts?q='+encodeURIComponent(q.trim().slice(0,100)),{cache:'no-store'});
   const source=response.headers.get('X-TicketBridge-Contacts-Source');
   const data=await response.json() as Contact[]|{error?:string};
   if(!response.ok||!Array.isArray(data))throw new Error(!Array.isArray(data)?data.error||'No se pudo consultar WhatsApp':'Agenda inválida');
   const results=new Map<string,Contact>();
   for(const c of data){if(!c.phone)continue;results.set(c.phone,c);}
   setContacts(Array.from(results.values()));setContactsError(source==='local'?'Agenda en vivo temporalmente no disponible: se muestran contactos guardados de esta cuenta.':'');
  }catch(e){setContacts([]);setContactsError('Contactos de WhatsApp no disponibles: '+(e instanceof Error?e.message:'Revisá la conexión'));}
 }
 async function reactToMessage(c:Conversation,id:number,emoji:string){
  if(reactionBusy!==null)return;
  setReactionBusy(id);setReactionError('');
  try{
   await req('/api/whatsapp/reactions','POST',{phone:c.phone,id,emoji});
   setReactionFor(null);setReactionAnchor(null);
   setConversations(await req<Conversation[]>('/api/conversations'));
  }catch(e){setReactionError(e instanceof Error?e.message:'No se pudo sincronizar la reacción con WhatsApp.');}
  finally{setReactionBusy(null);}
 }

 // Menú fuera del contenedor desplazable: no se recorta aunque el mensaje esté abajo.
 function openReactionPicker(ev:React.MouseEvent<HTMLButtonElement>,c:Conversation,id:number){
  if(reactionBusy!==null)return;
  if(reactionFor===id&&reactionAnchor?.phone===c.phone){setReactionFor(null);setReactionAnchor(null);setReactionError('');return;}
  const rect=ev.currentTarget.getBoundingClientRect();
  const estimatedWidth=310;
  const estimatedHeight=250;
  const left=Math.max(8,Math.min(rect.left-14,window.innerWidth-estimatedWidth-8));
  const top=rect.top>estimatedHeight+14?rect.top-estimatedHeight-8:Math.min(rect.bottom+8,Math.max(8,window.innerHeight-estimatedHeight-8));
  setReactionAnchor({id,phone:c.phone,left,top});
  setReactionFor(id);
  setReactionError('');
 }
 async function changeChatState(phone:string,action:'read'|'unread'|'pin'|'unpin'|'favorite'|'unfavorite'){
  if(stateBusy&&action!=='read')return;
  // Bloquear el visto automático ANTES de esperar la respuesta del servidor.
  if(action==='unread'){manualUnreadChats.current.add(phone);lastReadAttempt.current.delete(phone);}
  if(action==='read')manualUnreadChats.current.delete(phone);
  setStateBusy(phone+action);
  try{
   const result=await req<{ok:boolean;warning?:string;syncedWithWhatsApp?:boolean}>('/api/whatsapp/chat-state','POST',{phone,action});
   const updated=await req<Conversation[]>('/api/conversations');setConversations(updated);
   if(result.warning&&(action==='read'||action==='unread'))setNotice(result.warning);
  }catch(e){
   if(action==='unread')manualUnreadChats.current.delete(phone);
   setError(e instanceof Error?e.message:'No se pudo cambiar el estado del chat.');
  }finally{setStateBusy(null);}
 }
 // Cada chat puede pausar el bot o habilitar atención excepcional en horario.
 useEffect(()=>{if(!openChat||!waStatus.connected)return;let active=true;
  void req<{paused:boolean;forceEnabled:boolean}>('/api/automation/conversation?phone='+encodeURIComponent(openChat))
   .then(v=>{if(active)setAutomationPrefs(p=>({...p,[openChat]:v}));}).catch(()=>{});
  return()=>{active=false;};
 },[openChat,waStatus.connected]);
 async function toggleAutomation(phone:string,field:'paused'|'forceEnabled'){
  const old=automationPrefs[phone]||{paused:false,forceEnabled:false};
  const next={...old,[field]:!old[field]};
  try{await req('/api/automation/conversation','POST',{phone,...next});setAutomationPrefs(p=>({...p,[phone]:next}));}
  catch(e){setError(e instanceof Error?e.message:'No se pudieron cambiar los ajustes del chat.');}
 }
 // Cerrar solo la vista de la conversación; conservar mensajes, selección y estados de lectura.
 function closeConversation(){
  setOpenChat(null);
  setExternalContact(null);
  setEditingAlias(false);
  setReactionFor(null);setReactionAnchor(null);setReactionError('');
  setMsgMenu(null);setShowReplyEmojis(false);
  setReplyOpen(false);setReplyText('');setReplyAttachment(null);
  setQuoteTarget(null);setReplyError('');setDropActive(false);
 }
 // Esc cierra primero el menú, el visor o las acciones secundarias. Nunca
 // interrumpe una confirmación, un borrador de ticket ni el panel de Jira.
 useEffect(()=>{
  if(!openChat||tab!=='panel')return;
  const onEscape=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
   if(approval||ticketDraft||ticketsPhone||editingAlias)return;
   if(preview){event.preventDefault();setPreview(null);return;}
   if(forwardTarget){event.preventDefault();setForwardTarget(null);return;}
   if(noteTarget){event.preventDefault();setNoteTarget(null);return;}
   if(msgMenu){event.preventDefault();setMsgMenu(null);return;}
   if(reactionAnchor||reactionFor!==null){event.preventDefault();setReactionFor(null);setReactionAnchor(null);setReactionError('');return;}
   if(showReplyEmojis){event.preventDefault();setShowReplyEmojis(false);return;}
   event.preventDefault();
   closeConversation();
  };
  document.addEventListener('keydown',onEscape);
  return()=>document.removeEventListener('keydown',onEscape);
 },[openChat,tab,approval,ticketDraft,ticketsPhone,editingAlias,preview,forwardTarget,noteTarget,msgMenu,reactionAnchor,reactionFor,showReplyEmojis]);
 function openConversation(phone:string,contact?:Contact){
  setEditingAlias(false);
  // Volver a abrir un chat marcado manualmente permite marcarlo leído.
  if(manualUnreadChats.current.delete(phone))lastReadAttempt.current.delete(phone);
  const existing=conversations.find(c=>c.phone===phone);
  lastOpenInbound.current.set(phone,existing?.events.filter(e=>e.direction!=='out').at(-1)?.id||0);
  nearBottomRef.current=true;setReactionFor(null);setReactionAnchor(null);setReactionError('');setOpenChat(phone);setExternalContact(contact||null);setReplyOpen(Boolean(contact));setQuoteTarget(null);setMsgMenu(null);setReplyText('');setReplyAttachment(null);setShowReplyEmojis(false);setReplyError('');
 }
 const syntheticContact=externalContact && externalContact.phone===openChat && !conversations.some(c=>c.phone===openChat)?{
  phone:externalContact.phone,customer:externalContact.name,avatar_url:null,is_group:Boolean(externalContact.isGroup),unread_count:externalContact.unreadCount||0,marked_unread:false,pinned:false,favorite:false,
  outside:false,ticket:null,tickets:[],events:[]
 } as Conversation:null;
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
  if(!await askApproval('¿Confirmás la creación en Jira?',`${ticketDraft.kind==='subtask'?'Subtarea':'Ticket'}: ${ticketDraft.customer.trim()} - ${ticketDraft.title.trim()}\nSistema: ${ticketDraft.system}\nResponsable: ${assigneeQuery.trim()||'Predeterminado de Jira'}\nMensajes seleccionados: ${valid.length}${ticketDraft.parentKey?'\nTicket padre: '+ticketDraft.parentKey:''}`, 'Crear en Jira'))return;
  await perform(async()=>{
   const payload:{phone:string;messageIds:number[];customer:string;title:string;assigneeId?:string;assigneeName?:string;kind:'issue'|'subtask';system:string;parentKey?:string;allowMissingEvidence?:boolean;allowUnconfirmedJira?:boolean}={phone:c.phone,messageIds:valid,customer:ticketDraft.customer.trim(),title:ticketDraft.title.trim(),assigneeId:ticketDraft.assigneeId||undefined,assigneeName:ticketDraft.assigneeId?assigneeQuery.trim():undefined,kind:ticketDraft.kind,system:ticketDraft.system,parentKey:ticketDraft.kind==='subtask'?ticketDraft.parentKey:undefined};
   type Created={key:string;attachments:{uploaded:number;errors:string[]};missingEvidence?:number[];fieldWarnings?:string[]};
   let created:Created|undefined;
   // Reintento exclusivamente cuando el usuario confirma que Jira NO creó un ticket anterior.
   for(let attempt=0;attempt<3&&!created;attempt++){
    try{created=await req<Created>('/api/jira/create','POST',payload);}
    catch(e){
     const problem=e as Error&{code?:string};
     if(problem.code==='UNCONFIRMED_JIRA'&&!payload.allowUnconfirmedJira){
      if(!await askApproval('Posible ticket duplicado','Existe un ticket cuyo resultado no se confirmó. Antes de continuar, comprobá en Jira que no se haya creado. ¿Ya lo verificaste?', 'Ya verifiqué, continuar',true))throw new Error('Operación detenida para evitar tickets duplicados.');
      payload.allowUnconfirmedJira=true;continue;
     }
     if(problem.code==='MISSING_EVIDENCE'&&!payload.allowMissingEvidence){
      const missing=(problem as Error&{missingEvidence?:number[]}).missingEvidence||[];
      if(!await askApproval('Archivos pendientes',`Hay ${missing.length} archivos originales sin descargar. Si continuás, Jira recibirá el ticket SIN esos archivos. Recomendamos recuperar los adjuntos antes de crear el ticket.`, 'Crear sin los archivos',true)){
       throw new Error('Ticket no creado. Recuperá las imágenes pendientes del chat y volvé a intentarlo.');
      }
      payload.allowMissingEvidence=true;continue;
     }
     throw e;
    }
   }
   if(!created)throw new Error('No se confirmó la creación; verificá Jira antes de reintentar.');
   const v=created;
   setTicketDraft(null);setSelected(prev=>({...prev,[c.phone]:[]}));
   const alerts=[...(v.fieldWarnings||[]),...(v.attachments.errors||[]),...(v.missingEvidence?.length?[`${v.missingEvidence.length} archivo(s) originales NO adjuntados porque WhatsApp no los proporcionó.`]:[])];
   // El enlace y el número del ticket permanecen visibles al cerrar el formulario.
   // Una advertencia de adjuntos NO invalida la creación confirmada por Jira.
   setTicketSuccess({key:v.key,uploaded:v.attachments.uploaded,warnings:alerts});
   setNotice(`Ticket ${v.key} creado correctamente en Jira.`);
  });
 }
 // Todos los días ofrecen selección manual. La selección inicial incluye
 // solo los mensajes de hoy, nunca los de ayer ni los de fechas anteriores.
 function canSelectMessage(_e:Conversation['events'][number]){
  // Un mensaje puede respaldar más de un ticket/subtarea si se selecciona explícitamente.
  return true;
 }
 function canSelectToday(e:Conversation['events'][number]){
  return eventDateKey(e)===todayKey&&canSelectMessage(e);
 }
 function selectedIds(c:Conversation){
  const allowed=new Set(c.events.filter(canSelectMessage).map(e=>e.id));
  // Por seguridad no PREseleccionar mensajes ya vinculados, aunque sean reutilizables manualmente.
  const initiallyToday=c.events.filter(e=>canSelectToday(e)&&!e.usedInTicket&&!e.jira_key).map(e=>e.id);
  return (selected[c.phone]??initiallyToday).filter(id=>allowed.has(id));
 }
 function toggleMsg(c:Conversation,id:number){
  const msg=c.events.find(e=>e.id===id);
  if(!msg||!canSelectMessage(msg))return;
  const current=selectedIds(c);
  setSelected(prev=>({...prev,[c.phone]:current.includes(id)?current.filter(x=>x!==id):[...current,id]}));
 }
 // Un clic explícito en Enviar es la autorización; sin casilla ni confirmaciones emergentes.
 const ALLOWED_REPLY_MIMES=new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','application/pdf','text/plain','text/csv','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
 function chooseReplyFile(file:File|undefined){
  if(!file)return;
  const mime=((file.type&&file.type!=='application/octet-stream'?file.type:'')||({'pdf':'application/pdf','doc':'application/msword','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xls':'application/vnd.ms-excel','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','ppt':'application/vnd.ms-powerpoint','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','zip':'application/zip','txt':'text/plain','csv':'text/csv','mp4':'video/mp4'} as Record<string,string>)[file.name.split('.').pop()?.toLowerCase()||'']||'').split(';')[0];
  if(!ALLOWED_REPLY_MIMES.has(mime)){setReplyError('Archivo no admitido. Usá imágenes, MP4, PDF, Word, Excel, PowerPoint, TXT, CSV o ZIP.');return;}
  if(file.size<1||file.size>12*1024*1024){setReplyError('El archivo debe pesar entre 1 byte y 12 MB.');return;}
  const correctName=/^image\//.test(mime) && (!file.name||file.name==='image.png')?'captura-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+(mime==='image/jpeg'?'jpg':mime==='image/gif'?'gif':mime==='image/webp'?'webp':'png'):file.name;
  const normalized=new File([file],correctName,{type:mime,lastModified:file.lastModified});
  const preview=/^(image\/|video\/)/.test(mime)?URL.createObjectURL(normalized):null;
  setReplyError('');setReplyAttachment({file:normalized,preview,mime});setReplyOpen(true);
 }
 function dropReplyFiles(files:FileList|File[]){
  const list=Array.from(files);if(!list.length)return;
  if(list.length>1)setReplyError('Solo puede enviarse un archivo por mensaje. Seleccionamos el primero.');
  chooseReplyFile(list[0]);
 }
 function pasteReplyFile(e:React.ClipboardEvent<HTMLElement>){
  const files=Array.from(e.clipboardData.items).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((f):f is File=>Boolean(f));
  if(files.length){e.preventDefault();e.stopPropagation();dropReplyFiles(files);}
 }
 function onReplyDrop(e:React.DragEvent<HTMLElement>){
  e.preventDefault();e.stopPropagation();setDropActive(false);
  if(e.dataTransfer.files.length)dropReplyFiles(e.dataTransfer.files);
 }
 async function sendReply(c:Conversation){
  const text=replyText.trim();
  const image=replyAttachment?.file;
  if((!text&&!image)||sendingReplyRef.current)return;
  if(!waStatus.connected){
   setReplyError(waStatus.error||'WhatsApp no está conectado. Reiniciá npm run whatsapp y esperá a que se conecte.');
   return;
  }
  // Protección síncrona: dos Enter seguidos no deben producir mensajes duplicados.
  sendingReplyRef.current=true;
  setSendingReply(true);setReplyError('');
  try{
   const chatId=externalContact?.phone===c.phone?externalContact.chatId:undefined;
   if(image){
    const data=new FormData();
    if(quoteTarget?.phone===c.phone)data.set('replyToId',String(quoteTarget.id));
    data.set('phone',c.phone);if(chatId)data.set('chatId',chatId);
    data.set('caption',text);data.set('file',image,image.name);
    const response=await fetch('/api/whatsapp/send-media',{method:'POST',body:data,cache:'no-store'});
    const result=await response.json().catch(()=>({error:'Respuesta no válida del servidor'}));
    if(!response.ok||result.sent!==true)throw new Error(String(result.error||'WhatsApp no confirmó el envío del archivo'));
    if(result.mediaSaved!==true)setReplyError(String(result.warning||'El archivo se envió, pero no pudo guardarse en TicketBridge.'));
   }else{
    await req<{sent:boolean}>('/api/whatsapp/send','POST',{phone:c.phone,message:text,chatId,replyToId:quoteTarget?.phone===c.phone?quoteTarget.id:undefined});
   }
   setReplyText('');setReplyAttachment(null);setShowReplyEmojis(false);setQuoteTarget(null);
   // Mantener la caja de respuestas abierta para la siguiente conversación.
   await refresh().catch(()=>{});if(rosterMode==='contacts')void searchContacts(chatSearch);
  }catch(e){setReplyError(e instanceof Error?e.message:'No se pudo enviar el mensaje o imagen. Verificá WhatsApp antes de volver a intentar.');}
  finally{sendingReplyRef.current=false;setSendingReply(false);}
 }
 // Enter envía; Ctrl+Enter inserta un salto de línea (sin enviar).
 function replyKeyDown(e:React.KeyboardEvent<HTMLTextAreaElement>,c:Conversation){
  if(e.key!=='Enter'||e.nativeEvent.isComposing||e.keyCode===229)return;
  e.preventDefault();e.stopPropagation();
  if(e.ctrlKey){
   const area=e.currentTarget;
   if(area.value.length>=3000)return;
   area.setRangeText('\n',area.selectionStart,area.selectionEnd,'end');
   setReplyText(area.value);
   return;
  }
  // Ignorar teclado mantenido; evitar doble envío cuando React aún no actualizó el estado.
  if(e.repeat||e.shiftKey||e.altKey||e.metaKey)return;
  if(!sendingReplyRef.current&&(replyText.trim()||replyAttachment))void sendReply(c);
 }
 function insertReplyEmoji(emoji:string){
  const area=replyTextareaRef.current;
  const from=area?.selectionStart??replyText.length;
  const to=area?.selectionEnd??replyText.length;
  const next=replyText.slice(0,from)+emoji+replyText.slice(to);
  if(next.length>3000)return;
  setReplyText(next);setReplyError('');setShowReplyEmojis(false);
  requestAnimationFrame(()=>{area?.focus();area?.setSelectionRange(from+emoji.length,from+emoji.length);});
 }

 function openMessageMenu(ev:React.MouseEvent<HTMLElement>,phone:string,id:number){
  ev.preventDefault();ev.stopPropagation();setReactionFor(null);setReactionAnchor(null);
  if(msgMenu?.phone===phone&&msgMenu.id===id){setMsgMenu(null);return;}
  const width=220,height=350;
  setMsgMenu({phone,id,left:Math.min(Math.max(ev.clientX-20,8),window.innerWidth-width-8),top:Math.min(Math.max(ev.clientY-10,8),window.innerHeight-height-8)});
 }
 function startQuotedReply(phone:string,event:Conversation['events'][number]){
  if(!event.wa_message_id||event.wa_message_id.startsWith('fallback-')){setError('No se puede responder citando este mensaje porque WhatsApp no entregó su identificador original.');return;}
  setQuoteTarget({phone,id:event.id,message:(event.message||event.media_name||'Archivo adjunto').slice(0,180),waId:event.wa_message_id});
  setReplyOpen(true);setMsgMenu(null);
  requestAnimationFrame(()=>replyTextareaRef.current?.focus());
 }
 async function changeMessageFlag(phone:string,id:number,action:'pin'|'unpin'|'star'|'unstar'|'note',note?:string){
  if(msgActionBusy)return;setMsgActionBusy(true);
  try{await req('/api/whatsapp/message-tools','POST',{phone,id,action,note});setConversations(await req<Conversation[]>('/api/conversations'));
   if(action==='note')setNoteTarget(null);
  }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el cambio en TicketBridge.');}
  finally{setMsgActionBusy(false);setMsgMenu(null);}
 }
 function downloadMessageFile(e:Conversation['events'][number]){
  setMsgMenu(null);
  if(!e.media_path){setError('Este mensaje no tiene un archivo descargado. Probá primero Reintentar descarga.');return;}
  const a=document.createElement('a');a.href='/api/media/'+e.id;a.download=e.media_name||`archivo-${e.id}`;
  document.body.appendChild(a);a.click();a.remove();
 }
 async function forwardSelectedMessage(){
  if(!forwardTarget||!forwardPhone||forwardBusy)return;
  setForwardBusy(true);
  try{await req('/api/whatsapp/forward','POST',{...forwardTarget,targetPhone:forwardPhone});setNotice('WhatsApp confirmó el reenvío.');setForwardTarget(null);setForwardPhone('');}
  catch(e){setError(e instanceof Error?e.message:'No se pudo reenviar el mensaje.');}
  finally{setForwardBusy(false);}
 }
 function ticketStateKind(t:{jira_status?:string|null;jira_status_category?:string|null}):'todo'|'progress'|'done'|'unknown'{
  const cat=(t.jira_status_category||'').toLowerCase();
  if(cat==='done')return 'done';
  if(cat==='indeterminate')return 'progress';
  if(cat==='new')return 'todo';
  const label=(t.jira_status||'').trim().toLowerCase();
  if(!label)return 'unknown';
  if(/resuelt|finaliz|cerrad|complet|done|resolved|closed|finished/.test(label))return 'done';
  if(/progreso|curso|desarrollo|in progress|review|revisi[oó]n|trabajando/.test(label))return 'progress';
  return 'todo';
 }
 async function updateTicketStatuses(){
  if(ticketStatusBusy)return;
  setTicketStatusBusy(true);setTicketStatusMessage('Consultando Jira…');
  try{
   const r=await req<{updated:number;errors:string[];total:number}>('/api/jira/assignees/sync','POST');
   setConversations(await req<Conversation[]>('/api/conversations'));
   setTicketStatusMessage(`${r.updated} de ${r.total} tickets actualizados desde Jira${r.errors.length?' · '+r.errors.length+' error(es)':''}.`);
   if(r.errors.length)setTicketStatusMessage(`${r.updated} de ${r.total} tickets actualizados. ${r.errors.length} ticket(s) no se pudieron consultar en Jira (inexistentes o sin permisos). Ejemplo: ${r.errors[0].slice(0,140)}. Los registros locales se conservan.`);
  }catch(e){setTicketStatusMessage('No se pudo consultar Jira.');setError(e instanceof Error?e.message:'Error al actualizar estados');}
  finally{setTicketStatusBusy(false);}
 }
 useEffect(()=>{
  if(tab!=='settings'||settingsSection!=='tickets'||!health.jiraRealEnabled||ticketStatusAttempted.current)return;
  ticketStatusAttempted.current=true;
  void updateTicketStatuses();
 },[tab,settingsSection,health.jiraRealEnabled]);
 function panelTickets(phone:string){
  // Inventario de Jira independiente de /chats-snapshot: no ocultar tickets
  // cuando WhatsApp demora en enumerar chats.
  const fromLocal=conversations.flatMap(c=>(c.tickets||[]).map(t=>({...t,ownerPhone:c.phone,ownerName:aliases[c.phone]||c.customer})));
  const merged=new Map<string,typeof managedTickets[number]>();
  for(const t of [...fromLocal,...managedTickets])if(t.jira_key)merged.set(t.jira_key,t);
  const items=[...merged.values()];
  return byJiraCorrelative(items.filter(t=>phone==='__all__'||t.ownerPhone===phone));
 }
 function closeTicketPanel(){detailsRequestId.current++;setTicketsPhone(null);setDetailLoading(false);setDetailError('');}
 function showAllTickets(){
  const first=panelTickets('__all__')[0];
  setTicketsPhone('__all__');setJiraDetail(null);setDetailError('');setTicketKey(first?.jira_key||null);
  if(first?.jira_key)void fetchJiraTicket(first.ownerPhone,first.jira_key);
 }
 function showTicketPanel(c:Conversation){
  setTicketsPhone(c.phone);
  setJiraDetail(null);setDetailError('');
  const first=panelTickets(c.phone)[0];setTicketKey(first?.jira_key||null);
  if(first?.jira_key)void fetchJiraTicket(c.phone,first.jira_key);
 }
 async function importMissingTicketImage(phone:string,key:string,id:number,file:File){
  if(file.size>12*1024*1024){setDetailError('La imagen supera 12 MB');return;}
  setDetailLoading(true);setDetailError('');
  try{
   const form=new FormData();form.set('phone',phone);form.set('key',key);form.set('id',String(id));form.set('file',file);
   const response=await fetch('/api/jira/media/import',{method:'POST',body:form});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'No fue posible adjuntar la captura');
   if(result.jira?.errors?.length)setDetailError('Imagen guardada localmente; Jira requiere revisión: '+result.jira.errors.join(' / '));
   else setNotice('Imagen incorporada al ticket de Jira.');
   await fetchJiraTicket(phone,key);await refresh();
  }catch(e){setDetailError(e instanceof Error?e.message:'Error al adjuntar');}
  finally{setDetailLoading(false);}
 }
 async function verifyTicketEvidence(phone:string,key:string){
  setDetailLoading(true);setDetailError('');
  try{
   const result=await req<{uploaded:number;already:number;errors:string[]}>('/api/jira/media/sync','POST',{phone,key});
   if(result.errors.length)setDetailError('Revisar adjuntos: '+result.errors.join(' / '));
   else setNotice(`Jira: ${result.uploaded} adjuntos nuevos; ${result.already} ya existentes.`);
   await fetchJiraTicket(phone,key);
  }catch(e){setDetailError(e instanceof Error?e.message:'No se pudo verificar Jira');}
  finally{setDetailLoading(false);}
 }
 async function fetchJiraTicket(phone:string,key:string){
  const requestId=++detailsRequestId.current;
  setTicketKey(key);setTicketOwner(phone);setJiraDetail(null);setDetailError('');setDetailLoading(true);
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
 const eligibleChats=conversations.filter(c=>c.outside);
 const visibleChats=conversations.filter(c=>{
  if(chatView==='chats')return !c.is_group;
  if(chatView==='unread')return c.unread_count>0||c.marked_unread;
  if(chatView==='favorites')return c.favorite;
  if(chatView==='excluded')return !c.is_group&&isExcluded(c.phone);
  if(chatView==='groups')return c.is_group;
  if(chatView==='pending')return c.events.some(e=>e.outside_hours&&e.direction!=='out'&&!e.jira_key&&!e.usedInTicket);
  if(chatView==='created')return (c.tickets?.length??0)>0;
  return true;
 });
 const pending=eligibleChats.filter(c=>c.events.some(e=>e.outside_hours&&e.direction!=='out'&&!e.jira_key&&!e.usedInTicket)).length;
 const created=panelTickets('__all__').length;
 const unreadChats=conversations.filter(c=>c.unread_count>0||c.marked_unread).length;
 const favoriteChats=conversations.filter(c=>c.favorite).length;
 const excludedCount=Object.keys(excludedContacts).filter(isExcluded).length;
 const groupChats=conversations.filter(c=>c.is_group).length;
 const allManagedTickets=panelTickets('__all__');
 const ticketStats={
  todo:allManagedTickets.filter(t=>ticketStateKind(t)==='todo').length,
  progress:allManagedTickets.filter(t=>ticketStateKind(t)==='progress').length,
  done:allManagedTickets.filter(t=>ticketStateKind(t)==='done').length,
  unknown:allManagedTickets.filter(t=>ticketStateKind(t)==='unknown').length,
  sopn1:allManagedTickets.filter(t=>/^sopn1$/i.test((t.jira_status||'').trim())).length,
  sopn2:allManagedTickets.filter(t=>/^sopn2$/i.test((t.jira_status||'').trim())).length
 };
 const ticketOwners=[...new Set(allManagedTickets.map(t=>t.assignee_name||'Sin asignar'))].sort((a,b)=>a.localeCompare(b,'es'));
 const ticketsManagedView=allManagedTickets.filter(t=>{
  if(ticketStateFilter==='sopn1'||ticketStateFilter==='sopn2'){if((t.jira_status||'').trim().toLowerCase()!==ticketStateFilter)return false;}
  else if(ticketStateFilter!=='all'&&ticketStateKind(t)!==ticketStateFilter)return false;
  if(ticketAssigneeFilter!=='all'&&(t.assignee_name||'Sin asignar')!==ticketAssigneeFilter)return false;
  const query=ticketSearch.toLocaleLowerCase().trim();
  return !query||[t.jira_key,t.title,t.ownerName,t.assignee_name||'',t.jira_status||''].some(s=>(s||'').toLocaleLowerCase().includes(query));
 });
 return <div className={`shell twModernShell theme-${theme} accent-${accent}`}><main className="main"><header className="top twCompactTop"><div className="twBrandNav">
  <div className="twHeaderLogo" title="W-Ticket — Soporte TI"><span className="twBrandMark"><MessageCircle size={21}/></span><span className="twBrandName">W-<span>Ticket</span></span></div>
  <nav className="twIconNavigation" aria-label="Navegación principal">
   <button type="button" className={'twNavIcon '+(tab==='panel'&&rosterMode==='chats'?'selected':'')} title="Chats" aria-label="Chats" aria-current={tab==='panel'&&rosterMode==='chats'?'page':undefined} onClick={()=>{setTab('panel');setRosterMode('chats');setChatView('chats')}}><MessageCircle size={19}/></button>
   <button type="button" className={'twNavIcon '+(tab==='panel'&&rosterMode==='contacts'?'selected':'')} title="Contactos" aria-label="Contactos" aria-current={tab==='panel'&&rosterMode==='contacts'?'page':undefined} onClick={()=>{setTab('panel');setRosterMode('contacts');setChatSearch('')}}><Users size={19}/></button>
   <button type="button" className="twNavIcon" title="Tickets y reportes" aria-label="Tickets y reportes" onClick={showAllTickets}><Ticket size={19}/></button>
   <button type="button" className={'twNavIcon '+(tab==='settings'?'selected':'')} title="Configuración" aria-label="Configuración" aria-current={tab==='settings'?'page':undefined} onClick={()=>setTab('settings')}><Settings2 size={19}/></button>
  </nav><h1 className="twTopTitle">{tab==='panel'?'Centro de conversaciones':'Configuración del sistema'}</h1>
 </div><div className="appearanceArea"><button className="chip ticketTopButton twToolIcon" type="button" title="Ver tickets generados" aria-label="Ver tickets generados" onClick={showAllTickets}><Ticket size={17}/>{created>0&&<span className="ticketTopCount">{created}</span>}</button><button type="button" className="chip appearanceToggle twToolIcon" title="Cambiar apariencia" aria-label="Cambiar apariencia" aria-expanded={showAppearance} onClick={()=>setShowAppearance(v=>!v)}><Palette size={18}/></button>{showAppearance&&<div className="appearanceMenu"><strong>Tema</strong><div className="appearanceOptions"><button onClick={()=>{setTheme('dark');localStorage.setItem('ticketbridge-theme','dark')}} className={theme==='dark'?'selected':''}>Oscuro</button><button onClick={()=>{setTheme('light');localStorage.setItem('ticketbridge-theme','light')}} className={theme==='light'?'selected':''}>Claro</button></div><strong>Color principal</strong><div className="colorSwatches" role="group" aria-label="Elegir color principal">{(['neutral','emerald','cyan','violet','orange','rose'] as const).map(color=><button type="button" key={color} className={'colorSwatch '+(accent===color?'selected':'')} style={{background:({neutral:'#a1a1aa',emerald:'#10b981',cyan:'#06b6d4',violet:'#8b5cf6',orange:'#f97316',rose:'#f43f5e'} as const)[color]}} aria-label={'Color '+({neutral:'gris',emerald:'verde',cyan:'celeste',violet:'violeta',orange:'naranja',rose:'rosa'} as const)[color]} aria-pressed={accent===color} title={color} onClick={()=>{setAccent(color);localStorage.setItem('ticketbridge-accent',color)}}>{accent===color&&<span aria-hidden="true">✓</span>}</button>)}</div></div>}</div></header>
 {tab==='panel'&&!waStatus.connected&&<div className="twConnectBanner" role="status"><WifiOff size={16}/><span>WhatsApp desconectado. Los chats permanecen ocultos hasta vincular una cuenta.</span><button type="button" onClick={()=>{setTab('settings');setSettingsSection('advanced');setToolTab('connection')}}>Vincular <ChevronDown size={13}/></button></div>}{error&&<div className="alert err">{error}<button onClick={()=>setError('')}>Cerrar</button></div>}{notice&&<div className="alert ok">{notice}<button onClick={()=>setNotice('')}>Cerrar</button></div>}
 {ticketSuccess&&<div className="alert ok wtTicketSuccess" style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}} role="status" aria-live="polite"><CheckCircle2 size={20}/><div style={{display:'grid',gap:4,flex:'1 1 240px'}}><strong>Ticket {ticketSuccess.key} creado en Jira</strong><span>{ticketSuccess.uploaded} archivo(s) adjunto(s) confirmados.</span>{ticketSuccess.warnings.length>0&&<small>Revisar adjuntos/campos: {ticketSuccess.warnings.join(' / ')}</small>}</div>{jiraLink(ticketSuccess.key)&&<a className="smallButton" target="_blank" rel="noopener noreferrer" href={jiraLink(ticketSuccess.key)!}>Abrir {ticketSuccess.key} <ExternalLink size={14}/></a>}<button type="button" className="iconButton" title="Cerrar aviso" aria-label="Cerrar aviso de Jira" onClick={()=>setTicketSuccess(null)}><X size={16}/></button></div>}
 {ticketsPhone&&<div className="ticketModalBackdrop ticketOverviewBackdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)closeTicketPanel()}}>
  <section className="ticketOverview ticketOverviewV2" role="dialog" aria-modal="true" aria-labelledby="ticket-overview-title">
   <header className="ticketOverviewHeader">
    <div className="ticketOverviewHeading"><span className="ticketOverviewHeadingIcon"><Ticket size={21}/></span><div><span className="ticketOverviewEyebrow">JIRA · PROYECTO CW</span><h2 id="ticket-overview-title">Seguimiento de tickets</h2><p>Consultá todos los tickets creados y sus evidencias.</p></div></div>
    <button type="button" className="ticketOverviewClose" aria-label="Cerrar ventana de tickets" onClick={closeTicketPanel}>×</button>
   </header>
   <div className="ticketOverviewBody">
    <nav className="ticketOverviewList" aria-label="Seleccionar ticket">
     <div className="ticketOverviewListHeading"><strong>Tickets vinculados</strong><span>{ticketsPhone==='__all__'?created:(conversations.find(c=>c.phone===ticketsPhone)?.tickets?.length||0)}</span></div>
     {panelTickets(ticketsPhone).map(t=><button type="button" key={t.id} className={'ticketOverviewChoice '+(ticketKey===t.jira_key?'active':'')} aria-pressed={ticketKey===t.jira_key} onClick={()=>{if(t.jira_key)void fetchJiraTicket(t.ownerPhone,t.jira_key)}}>
      <span className="ticketOverviewChoiceTop"><b>{t.jira_key}</b><span className="ticketOverviewKind">{t.kind==='subtask'?'Subtarea':'Ticket'}</span></span>
      <span className="ticketOverviewChoiceSummary">{t.ownerName?`${t.ownerName} · `:''}{t.title||'Ticket sin título'}</span>
      <small><Clock3 size={12}/>{ticketDateLabel(t.created_at)}</small><small className="ticketAssigned">Responsable: {t.assignee_name||"Consultar en Jira"}</small>
     </button>)}
    </nav>
    <article className="ticketOverviewDetail">
     {detailLoading?<div className="ticketOverviewState" role="status"><RefreshCw className="syncSpin" size={20}/><strong>Cargando información...</strong><p>Consultando la descripción y las evidencias del ticket en Jira.</p></div>:
      detailError?<div className="ticketOverviewState ticketOverviewStateError" role="alert"><WifiOff size={25}/><strong>No se pudo cargar el detalle</strong><p>{detailError}</p>{ticketKey&&<button type="button" className="smallButton" onClick={()=>void fetchJiraTicket(ticketOwner||ticketsPhone,ticketKey)}><RefreshCw size={14}/> Reintentar consulta</button>}</div>:
      jiraDetail?<>
       <div className="ticketOverviewDetailTitle"><div><span className="ticketOverviewTicketKey">{jiraDetail.key}</span><h3>{jiraDetail.summary||'Ticket sin título'}</h3>{jiraDetail.assignee&&<small className="ticketAssigned">Asignado a: {jiraDetail.assignee.name}</small>}</div><span className="ticketOverviewStatus">{jiraDetail.status||'Sin estado'}</span></div>
       <section className="ticketOverviewSection"><h4><FileText size={16}/> Descripción</h4><div className="ticketOverviewDescription">{jiraDetail.description?.trim()?jiraDetail.description.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,i)=>{
        const match=/^\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\]\s*(.*)$/.exec(line);
        return match?<div className="ticketOverviewMessageLine" key={i}><time>{match[1]} · {match[2]}</time><span>{match[3]}</span></div>:<p className="ticketOverviewTextLine" key={i}>{line}</p>;
       }):<p className="ticketOverviewHint">Este ticket no tiene descripción.</p>}</div></section>
       {jiraDetail.localMedia?.some(m=>m.media_type?.startsWith('image/'))&&<section className="ticketOverviewSection ticketOverviewPhotos"><h4><ImageOff size={16}/> Imágenes de la conversación</h4><div>{(jiraDetail.localMedia ?? []).filter(m=>m.media_type?.startsWith('image/')).map(m=><button type="button" key={m.id} onClick={()=>setPreview({id:m.id,name:m.media_name||'Evidencia'})} title="Ampliar evidencia"><img src={'/api/media/'+m.id} alt={m.media_name||'Captura del ticket'}/></button>)}</div></section>}
       <section className="ticketOverviewSection ticketOverviewAttachments"><h4><FileText size={16}/> Evidencias adjuntas en Jira <span>({jiraDetail.attachments?.length||0})</span></h4>{(jiraDetail.missingMedia?.length||0)>0&&ticketOwner&&ticketKey&&<div className="ticketEvidenceWarning" style={{margin:'8px 0'}}><span>WhatsApp no entregó {(jiraDetail.missingMedia?.length ?? 0)} archivo(s). Podés adjuntar capturas guardadas al ticket, sin presentarlas como originales.</span><div className="evidenceManualUploads">{(jiraDetail.missingMedia||[]).map(m=><label key={m.id} className="evidenceManualRow"><span>Mensaje #{m.id} · {m.local_time}</span><span className="evidenceManualChoose">Agregar imagen al ticket<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={detailLoading} onChange={e=>{const file=e.currentTarget.files?.[0];if(file&&ticketOwner&&ticketKey)void importMissingTicketImage(ticketOwner,ticketKey,m.id,file);e.currentTarget.value='';}}/></span></label>)}</div></div>}<button type="button" className="smallButton" disabled={detailLoading||!ticketOwner||!ticketKey} onClick={()=>{if(ticketOwner&&ticketKey)void verifyTicketEvidence(ticketOwner,ticketKey);}}>Sincronizar archivos con Jira</button>{jiraDetail.attachments?.length?<div className="ticketOverviewAttachmentList">{jiraDetail.attachments.map(a=><div className="ticketOverviewAttachment" key={a.id}><FileText size={16}/><span title={a.filename}>{a.filename}</span><small>{ticketFileSize(a.size)}</small></div>)}</div>:<p className="ticketOverviewHint">Este ticket todavía no tiene archivos adjuntos en Jira.</p>}</section>
      </>:<div className="ticketOverviewState"><Ticket size={22}/><p>Seleccioná un ticket para ver sus detalles.</p></div>}
     {ticketKey&&<div className="ticketOverviewFooter"><a className="ticketOverviewGo" href={jiraDetail?.url||jiraLink(ticketKey)||'#'} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Abrir {ticketKey} en Jira</a></div>}
    </article>
   </div>
  </section>
 </div>}
 {ticketDraft&&<div className="ticketModalBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setTicketDraft(null)}}><div className="ticketModal ticketModalImproved" role="dialog" aria-modal="true" aria-label="Preparar ticket Jira CW">
  <div className="ticketModalHeader"><div><div className="ticketModalEyebrow">JIRA · PROYECTO CW</div><h2>Preparar ticket de soporte</h2><p>Configurá la solicitud, revisá los mensajes seleccionados y autorizá la creación.</p></div><button type="button" className="ticketModalClose" disabled={loading||!!approval} onClick={()=>setTicketDraft(null)} aria-label="Cerrar">×</button></div>
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
  </div>{error&&<div className="ticketInlineError" role="alert"><ImageOff size={16}/>{error}</div>}<div className="ticketModalActions ticketModalFooter"><button type="button" className="smallButton" disabled={loading||!!approval} onClick={()=>setTicketDraft(null)}>Cancelar</button><button type="button" className="primary" disabled={loading||!!approval||!ticketDraft.customer.trim()||ticketDraft.title.trim().length<5||(ticketDraft.kind==='subtask'&&!ticketDraft.parentKey)} onClick={()=>{const c=conversations.find(c=>c.phone===ticketDraft.phone);if(c)void createConversation(c);else setError('La conversación ya no está disponible. Actualizá el chat antes de crear el ticket.');}}>{loading?'Creando ticket en Jira…':approval?'Confirmá la operación…':'Confirmar y crear ticket CW'}</button></div>
 </div></div>}

 {approval&&<div className="approvalBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeApproval(false)}}>
  <section className="approvalDialog" role="dialog" aria-modal="true" aria-labelledby="wt-ticket-approval-title" aria-describedby="wt-ticket-approval-description">
   <span className="approvalIcon"><ShieldCheck size={22}/></span>
   <h2 id="wt-ticket-approval-title">{approval.heading}</h2>
   <p id="wt-ticket-approval-description">{approval.body}</p>
   <div className="approvalActions">
    <button type="button" className="smallButton" onClick={()=>closeApproval(false)}>Cancelar</button>
    <button type="button" className={approval.warning?'approvalDanger':'primary'} onClick={()=>closeApproval(true)} autoFocus>{approval.accept}</button>
   </div>
  </section>
 </div>}
 {forwardTarget&&<div className="messageDialogBackdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target&&!forwardBusy)setForwardTarget(null)}}><div className="messageActionDialog" role="dialog" aria-modal="true" aria-label="Reenviar mensaje"><h3><Forward size={18}/> Reenviar mensaje</h3><p>Elegí una conversación existente. Se enviará el mensaje original de WhatsApp.</p><select aria-label="Conversación de destino" value={forwardPhone} onChange={e=>setForwardPhone(e.target.value)}><option value="">Seleccionar chat…</option>{conversations.filter(c=>c.phone!==forwardTarget.phone).map(c=><option key={c.phone} value={c.phone}>{aliases[c.phone]||c.customer} — {c.is_group?'Grupo':c.phone}</option>)}</select><div className="messageDialogActions"><button type="button" className="smallButton" disabled={forwardBusy} onClick={()=>setForwardTarget(null)}>Cancelar</button><button type="button" className="primary" disabled={!forwardPhone||forwardBusy||!waStatus.connected} onClick={()=>void forwardSelectedMessage()}>{forwardBusy?'Enviando…':'Reenviar'}</button></div></div></div>}
 {noteTarget&&<div className="messageDialogBackdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target&&!msgActionBusy)setNoteTarget(null)}}><div className="messageActionDialog" role="dialog" aria-modal="true" aria-label="Nota interna"><h3><NotebookPen size={18}/> Nota del mensaje</h3><p>Nota privada que se guarda solo en TicketBridge; no se envía a WhatsApp.</p><textarea rows={4} maxLength={1200} value={noteText} onChange={e=>setNoteText(e.target.value)} aria-label="Texto de la nota"/><div className="messageDialogActions"><button type="button" className="smallButton" disabled={msgActionBusy} onClick={()=>setNoteTarget(null)}>Cancelar</button><button type="button" className="primary" disabled={msgActionBusy} onClick={()=>void changeMessageFlag(noteTarget.phone,noteTarget.id,'note',noteText)}>{msgActionBusy?'Guardando…':'Guardar nota'}</button></div></div></div>}
 {tab==='settings'&&<nav className="settingsCategoryNav" aria-label="Secciones de configuración">{([{id:'tickets',name:'Tickets y responsables',icon:Ticket},{id:'advanced',name:'Herramientas',icon:Settings2}] as const).map(item=><button type="button" key={item.id} className={settingsSection===item.id?'active':''} onClick={()=>setSettingsSection(item.id)}><item.icon size={16}/>{item.name}</button>)}</nav>}
{tab==='panel'&&waStatus.connected&&conversations.length===0&&visibility&&<div className="twVisibilityBanner" role="status"><strong>No hay conversaciones visibles para la cuenta vinculada.</strong><span>{visibility.help} · Mensajes locales: {visibility.totalMessages} · Visibles: {visibility.visibleMessages} · Sin asociar: {visibility.unassignedMessages} · Otras identidades: {visibility.otherAccountMessages}.</span><button type="button" onClick={()=>void refresh()}>Volver a consultar</button></div>}
{tab==='panel'&&waStatus.connected&&legacyCount>0&&<div className="twLegacyPrompt"><span><strong>Historial anterior: {legacyCount} mensajes</strong> · está resguardado sin asociar a otra cuenta.</span><button type="button" disabled={legacyBusy} onClick={()=>void claimLegacyHistory()}>{legacyBusy?'Asociando…':'Asociar a esta cuenta'}</button></div>}
{tab==='panel'&&<><section className="card twChatCard">{filter!=='simulator'&&<div className="chatLayout">
  <div className="chatRoster"><div className="chatRosterHead twRosterToolbar"><strong>Conversaciones</strong><span className="twRosterCount" title="Mensajes sin leer">{conversations.reduce((n,c)=>n+c.unread_count,0)||''}</span><button type="button" className="twHeaderRefresh" title="Sincronizar WhatsApp" aria-label="Sincronizar WhatsApp" onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={17}/></button></div>
  <div className="rosterTabs"><button type="button" className={rosterMode==='chats'?'selected':''} onClick={()=>setRosterMode('chats')}><MessageCircle size={14}/> Chats</button><button type="button" className={rosterMode==='contacts'?'selected':''} onClick={()=>setRosterMode('contacts')}><Users size={14}/> Ver contactos</button></div>
  <div className="waSearchBox"><Search size={16}/><input className="chatSearch" aria-label="Buscar chats o contactos" placeholder="Buscar un chat o iniciar uno nuevo" value={chatSearch} onChange={e=>setChatSearch(e.target.value)}/></div>
  {rosterMode==='chats'&&<div className="chatFilters waFilterChips" aria-label="Filtrar conversaciones">
   <button type="button" className={chatView==='chats'?'chosen':''} onClick={()=>{setChatView('chats');setOpenChat(null)}}>Chats</button>
   <button type="button" className={chatView==='unread'?'chosen':''} onClick={()=>setChatView('unread')}>No leídos {unreadChats||''}</button>
   <button type="button" className={chatView==='favorites'?'chosen':''} onClick={()=>setChatView('favorites')}>Favoritos {favoriteChats||''}</button>
   <button type="button" className={chatView==='excluded'?'chosen':''} onClick={()=>{setChatView('excluded');setRosterMode('chats')}} title="Contactos que no reciben mensajes del asistente"><ShieldOff size={13}/> Sin bot {excludedCount||''}</button>
   <button type="button" className={chatView==='groups'?'chosen':''} onClick={()=>{setChatView('groups');setOpenChat(null)}}>Grupos {groupChats||''}</button>
   <div className="chatFilterExtra"><button className={'waMoreFilter '+(chatView==='pending'||chatView==='created'?'chosen':'')} type="button" aria-label="Más filtros" aria-expanded={showMoreFilters} onClick={()=>setShowMoreFilters(v=>!v)}><ChevronDown size={13}/></button>
    {showMoreFilters&&<div className="waExtraOptions"><button type="button" onClick={()=>{setChatView('all');setShowMoreFilters(false)}}>Todas las conversaciones</button><button type="button" onClick={()=>{setChatView('pending');setShowMoreFilters(false)}}>Pendientes de ticket ({pending})</button><button type="button" onClick={()=>{setChatView('created');setShowMoreFilters(false)}}>Con ticket ({conversations.filter(c=>c.tickets?.length).length})</button></div>}
   </div>
  </div>}

 {waStatus.connected&&chatView==='excluded'&&rosterMode==='chats'&&<div className="twExcludedIntro"><ShieldOff size={14}/> Contactos sin mensajes automáticos. Marcá o desmarcá junto a <Star size={12}/> Favoritos.</div>}
 {chatView==='excluded'&&excludedError&&<p className="twExclusionError" role="alert">{excludedError}</p>}
 {rosterMode==='contacts'&&!chatSearch.trim()&&<div className="twContactHint"><Search size={16}/> {waStatus.connected?'Escribí un nombre o número para buscar entre los contactos reales de WhatsApp.':'Conectá WhatsApp y escaneá el QR primero. Los contactos se mostrarán cuando la cuenta confirme la vinculación.'}</div>}
 {(rosterMode==='contacts'||chatSearch.trim())&&contactsError&&<small className="contactError">{contactsError}</small>}{rosterMode==='contacts'&&chatSearch.trim().length>=2&&!contactsError&&contacts.length===0&&<small className="contactError">No se encontraron contactos para esta búsqueda en WhatsApp.</small>}{rosterMode==='contacts'&&contacts.filter(c=>`${c.name} ${c.phone} ${c.displayPhone||''}`.toLowerCase().includes(chatSearch.trim().toLowerCase())).map(c=><div className="rosterChat twContactResult" key={'address-'+c.phone}><button type="button" className={'chatRosterItem '+(openChat===c.phone?'chosen':'')} onClick={()=>openConversation(c.phone,c)}><span className="contactAvatar">{c.isGroup?<Users size={20}/>:c.name.slice(0,1).toUpperCase()}</span><span className="chatRosterCopy"><strong>{c.name}</strong><small>{c.isGroup?'Grupo de WhatsApp':c.displayPhone||c.phone}</small></span>{isExcluded(c.phone)&&<ShieldOff className="twNoBotMark" size={14}/>}</button>{!c.isGroup&&<button type="button" className={'twContactToggle '+(isExcluded(c.phone)?'excluded':'')} disabled={excludedBusy===c.phone} title={isExcluded(c.phone)?'Permitir asistente':'Desactivar asistente para este contacto'} aria-label={isExcluded(c.phone)?'Permitir asistente':'Desactivar asistente'} aria-pressed={isExcluded(c.phone)} onClick={()=>void toggleClientAutomation(c.phone,c.name)}><ShieldOff size={16}/></button>}</div>)}
 {rosterMode==='chats'&&chatSearch.trim().length>=2&&contacts.filter(contact=>!conversations.some(c=>c.phone===contact.phone)&&(chatView==='groups'?Boolean(contact.isGroup):chatView==='excluded'?!contact.isGroup:!contact.isGroup)).map(contact=><div className="rosterChat twContactResult" key={'search-'+contact.phone}><button type="button" className="chatRosterItem contactSearchResult" onClick={()=>openConversation(contact.phone,contact)}><span className="contactAvatar">{contact.isGroup?<Users size={18}/>:contact.name.slice(0,1).toUpperCase()}</span><span className="chatRosterCopy"><strong>{contact.name}</strong><small>{contact.displayPhone||contact.phone}</small><small>Iniciar conversación</small></span><Send size={14}/></button>{!contact.isGroup&&<button type="button" className={'twContactToggle '+(isExcluded(contact.phone)?'excluded':'')} title={isExcluded(contact.phone)?'Permitir asistente':'Sin automatización'} aria-label={isExcluded(contact.phone)?'Permitir asistente':'Sin automatización'} aria-pressed={isExcluded(contact.phone)} disabled={excludedBusy===contact.phone} onClick={()=>void toggleClientAutomation(contact.phone,contact.name)}><ShieldOff size={16}/></button>}</div>)}
 {rosterMode==='chats'&&visibleChats.filter(c=>`${aliases[c.phone]||''} ${c.customer} ${c.phone}`.toLowerCase().includes(chatSearch.trim().toLowerCase())).map(c=> <div key={c.phone} className={'rosterChat '+(openChat===c.phone?'chosen':'')}>
  <button type="button" className="chatRosterItem" onClick={()=>openConversation(c.phone)}><span className="contactAvatar">{c.avatar_url?<img src={c.avatar_url} alt="Foto del contacto" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none'}}/>:c.is_group?<Users size={19}/>: (aliases[c.phone]||c.customer||'?').slice(0,1).toUpperCase()}</span><span className="chatRosterCopy"><strong title={aliases[c.phone]||(!c.customer.startsWith('WhatsApp ')?c.customer:'Contacto sin nombre')}>{c.pinned&&<Pin size={12}/>} {c.favorite&&<Star size={12} className="favoriteStar" fill="currentColor"/>} {aliases[c.phone]||(!c.customer.startsWith('WhatsApp ')?c.customer:'Contacto sin nombre')}</strong>{c.is_group&&<small className="twRosterGroupBadge">Grupo</small>}<small className="tbRosterPreview" title={c.events.at(-1)?.message||'Sin mensajes'}>{c.is_group&&(c.events.at(-1)?.direction==='out'?<b>Vos: </b>:c.events.at(-1)?.sender_name?<b>{c.events.at(-1)?.sender_name}: </b>:null)}{c.events.at(-1)?.message||'Sin mensajes'}</small></span><span className="chatRosterTime"><span className="tbRosterTimeRow">{c.events.at(-1)?.direction==='out'&&<span className={'tbRosterAck '+((c.events.at(-1)?.wa_ack??-1)>=3?'isRead':'')} title={(c.events.at(-1)?.wa_ack??-1)>=3?'Leído':(c.events.at(-1)?.wa_ack??-1)>=2?'Entregado':'Enviado, sin confirmación de lectura'}>{(c.events.at(-1)?.wa_ack??-1)>=2?<CheckCheck size={16} strokeWidth={2.4}/>:<Check size={16} strokeWidth={2.4}/>}</span>}{c.events.at(-1)?.local_time}</span>{c.unread_count>0?<span className="unreadBadge">{c.unread_count}</span>:c.marked_unread?<span className="unreadDot" aria-label="Marcado como no leído" title="Marcado como no leído (sin mensajes nuevos)"/>:null}</span></button>
  <div className="rosterQuickActions"><button type="button" title={c.pinned?'Quitar fijado':'Fijar chat'} aria-label={c.pinned?'Quitar fijado':'Fijar chat'} disabled={!!stateBusy} onClick={()=>void changeChatState(c.phone,c.pinned?'unpin':'pin')}><Pin size={12}/></button><button type="button" title={c.favorite?'Quitar de favoritos':'Agregar a favoritos'} aria-label={c.favorite?'Quitar de favoritos':'Agregar a favoritos'} disabled={!!stateBusy} onClick={()=>void changeChatState(c.phone,c.favorite?'unfavorite':'favorite')}><Star size={13} className={c.favorite?'favoriteStar':''} fill={c.favorite?'currentColor':'none'}/></button>{!c.is_group&&<button type="button" title={isExcluded(c.phone)?'Reactivar asistente':'No enviar mensajes automáticos'} aria-label={isExcluded(c.phone)?'Reactivar asistente':'Excluir de automatización'} aria-pressed={isExcluded(c.phone)} className={isExcluded(c.phone)?'twExcludedAction':''} disabled={!!excludedBusy} onClick={()=>void toggleClientAutomation(c.phone,aliases[c.phone]||c.customer)}><ShieldOff size={14}/></button>}<button type="button" disabled={!!stateBusy} onClick={()=>void changeChatState(c.phone,(c.unread_count||c.marked_unread)?'read':'unread')} title={(c.unread_count||c.marked_unread)?'Marcar leído':'Marcar no leído'} aria-label={(c.unread_count||c.marked_unread)?'Marcar leído':'Marcar no leído'}>{c.unread_count?<Eye size={13}/>:<EyeOff size={13}/>}</button></div>
 </div>)}
 {rosterMode==='chats'&&chatView==='excluded'&&Object.entries(excludedContacts).filter(([phone])=>isExcluded(phone)&&!conversations.some(c=>c.phone===phone)&&(!chatSearch.trim()||`${excludedContacts[phone].name} ${phone}`.toLowerCase().includes(chatSearch.toLowerCase()))).map(([phone,item])=><div className="rosterChat twContactResult" key={'excluded-'+phone}><button type="button" className="chatRosterItem" onClick={()=>openConversation(phone,{phone,name:item.name})}><span className="contactAvatar"><ShieldOff size={17}/></span><span className="chatRosterCopy"><strong>{item.name||phone}</strong><small>{phone} · Sin automatización</small></span></button><button type="button" className="twContactToggle excluded" title="Volver a activar el asistente" aria-label="Volver a activar el asistente" disabled={excludedBusy===phone} onClick={()=>void toggleClientAutomation(phone,item.name||phone)}><ShieldOff size={16}/></button></div>)}
 {rosterMode==='chats'&&chatView==='excluded'&&exclusionsLoaded&&excludedCount===0&&<div className="twContactHint">Todavía no hay clientes excluidos. Buscá uno arriba y tocá el icono junto a Favoritos.</div>}
 </div><div className="chatDetail">{(()=>{const c=conversations.find(v=>v.phone===openChat)||syntheticContact;if(!c)return <div className="chatEmpty">Seleccioná una conversación para ver mensajes, archivos y tickets.</div>;const selectedNow=new Set(selectedIds(c));const count=selectedNow.size;const name=aliases[c.phone]||(!c.customer.startsWith('WhatsApp ')?c.customer:'Contacto sin nombre');return <><header className="chatDetailHeader"><span className="contactAvatar">{c.avatar_url?<img src={c.avatar_url} alt="Foto del contacto" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none'}}/>:c.is_group?<Users size={19}/>:name.slice(0,1).toUpperCase()}</span><div className="chatDetailWho"><strong>{name} <button type="button" className="aliasEditButton" aria-label="Editar nombre local del chat" title="Nombre local" onClick={()=>setEditingAlias(v=>!v)}><Settings2 size={12}/></button></strong><small>{c.is_group?'Grupo · ':''}{c.phone} · {c.events.length} mensajes{c.is_group?' · Identificamos al autor cuando WhatsApp lo proporciona':''}</small>{editingAlias&&<input className="chatAliasInline" aria-label="Nombre local del contacto" placeholder="Nombre local opcional" autoFocus value={aliases[c.phone]||''} onChange={e=>{const next={...aliases,[c.phone]:e.target.value};setAliases(next);localStorage.setItem('ticketbridge-contact-aliases',JSON.stringify(next));}} onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();setEditingAlias(false);}}}/>}</div><button type="button" className="smallButton" disabled={!!stateBusy} title="Cambiar estado de lectura" onClick={()=>void changeChatState(c.phone,(c.unread_count||c.marked_unread)?'read':'unread')}>{(c.unread_count||c.marked_unread)?<Eye size={14}/>:<EyeOff size={14}/>} {(c.unread_count||c.marked_unread)?'Marcar leído':'No leído'}</button>{!c.is_group&&isExcluded(c.phone)&&<span className="twChatExclusionBadge"><ShieldOff size={13}/> Asistente desactivado</span>}{!c.is_group&&/^\d{10,15}$/.test(c.phone)&&<a className="smallButton" href={'tel:+'+c.phone} title="Abrir marcador para llamar al contacto">Llamar</a>}{!c.is_group&&<a className="openWhatsappWeb" href={'https://web.whatsapp.com/send?phone='+encodeURIComponent(c.phone)} target="_blank" rel="noopener noreferrer" title="Abrir este chat en WhatsApp Web para ver los archivos originales"><ExternalLink size={15}/> WhatsApp Web</a>}<button type="button" className="chatHeaderClose" aria-label="Cerrar conversación" title="Cerrar chat (Esc)" onClick={closeConversation}><X size={15}/></button></header><div className="selectionBar"><span>{count} mensaje(s) seleccionado(s)</span><button className="smallButton" disabled={!c.events.some(canSelectToday)} onClick={()=>setSelected(prev=>({...prev,[c.phone]:c.events.filter(canSelectToday).map(e=>e.id)}))}>Todos hoy</button><button className="smallButton" disabled={!count} onClick={()=>setSelected(prev=>({...prev,[c.phone]:[]}))}>Ninguno</button></div>{(syncingPhone===c.phone||historyPhone===c.phone||importingPhone===c.phone)&&<div className="chatMediaSyncStatus" role="status"><RefreshCw size={12} className="syncSpin"/> {importingPhone===c.phone?'Sincronizando mensajes recientes…':'Cargando imágenes y archivos automáticamente…'}</div>}{mediaWarning[c.phone]&&<div className="chatMediaWarning" role="status"><ImageOff size={14}/>{mediaWarning[c.phone]}</div>}<div className="chatDetailMessages" ref={messagesRef} onScroll={e=>{const el=e.currentTarget;nearBottomRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<110;}}>{c.events.map((e,i)=>{
 const dayKey=eventDateKey(e);
 const previousDay=i>0?eventDateKey(c.events[i-1]):null;
 const isOutgoing=e.direction==='out';
 const isSelected=selectedNow.has(e.id);
 return <div key={e.id} className="chatDayBlock">
  {dayKey!==previousDay&&<div className="chatDaySeparator" role="separator"><span>{chatDateLabel(dayKey,todayKey)}</span></div>}
  <div className={'chatEvent '+(isOutgoing?'outgoing':'incoming')}>
   <label className="chatSelect" title={e.usedInTicket||e.jira_key?'Ya vinculado a otro ticket; podés volver a seleccionarlo':'Seleccionar mensaje para ticket o subtarea'}>
    <input type="checkbox" aria-label={`Seleccionar mensaje del ${e.local_date} a las ${e.local_time}`} checked={isSelected}
     onChange={()=>toggleMsg(c,e.id)}/>
   </label>
   <div className="messageBubble" onContextMenu={ev=>openMessageMenu(ev,c.phone,e.id)}>
    <div className="messageBubbleTop"><button type="button" aria-label="Acciones de este mensaje" title="Acciones del mensaje" className="messageMoreButton" onClick={ev=>openMessageMenu(ev,c.phone,e.id)}><MoreHorizontal size={15}/></button>{e.message_pinned&&<span title="Fijado en TicketBridge"><Pin size={13}/></span>}{e.message_starred&&<span title="Destacado en TicketBridge"><Star size={13} fill="currentColor"/></span>}</div>
    {e.message_note&&<div className="messageLocalNote" title="Nota interna de TicketBridge"><NotebookPen size={12}/>{e.message_note}</div>}
    {c.is_group&&!isOutgoing&&<div className="groupSenderName"><Users size={12} aria-hidden="true"/> {e.sender_name||'Participante del grupo'}</div>}{!(e.message||'').startsWith('[Adjunto WhatsApp:')&&<div className="chatMessageText">{e.message}</div>}
    {e.media_path&&!brokenImages[e.id]&&(e.media_type?.startsWith('image/')?
     <button type="button" className={'chatPhotoButton '+(/^\[Adjunto WhatsApp:\s*sticker\]/i.test(e.message||'')?'chatStickerButton':'')} style={{display:'inline-flex',width:'fit-content',maxWidth:'100%'}} onClick={()=>setPreview({id:e.id,name:e.media_name||'Foto de WhatsApp'})} title="Ampliar foto">
      <img src={'/api/media/'+e.id} loading="lazy" alt={e.media_name||'Imagen de WhatsApp'} className={'chatImage '+(/^\[Adjunto WhatsApp:\s*sticker\]/i.test(e.message||'')?'chatStickerImage':'')} style={{display:'block',width:'auto',height:'auto',maxWidth:/^\[Adjunto WhatsApp:\s*sticker\]/i.test(e.message||'')?'min(160px,45vw)':'min(320px,72vw)',maxHeight:/^\[Adjunto WhatsApp:\s*sticker\]/i.test(e.message||'')?'160px':'300px',objectFit:'contain'}} onError={()=>setBrokenImages(prev=>({...prev,[e.id]:true}))}/>
     </button>:
     e.media_type?.startsWith('video/')?<video className="chatVideo" src={'/api/media/'+e.id} controls playsInline preload="metadata"/>:
     e.media_type?.startsWith('audio/')?<audio className="chatAudio" src={'/api/media/'+e.id} controls preload="none"/>:
     <a className="chatFileLink" href={'/api/media/'+e.id} target="_blank" rel="noopener noreferrer"><FileText size={16}/> {e.media_name||'Abrir documento'} <ExternalLink size={12}/></a>)}
    {(isMissingMedia(e)||brokenImages[e.id])&&<div className="chatMediaFallback">
     <div className="chatMediaFallbackTitle">{(e.message||'').includes('video')?<Film size={20}/>: (e.message||'').includes('audio')?<Mic size={20}/>:<ImageOff size={20}/>}<span>Adjunto de WhatsApp</span></div>
     <small>{!waStatus.connected?'Archivo aún no disponible; WhatsApp está desconectado':syncingPhone===c.phone?'Cargando desde WhatsApp…':automaticallySynced.current.get(c.phone)?.has(e.id)?(e.media_error||'WhatsApp todavía no permite descargar este adjunto'):'Pendiente de carga automática'}</small>{waStatus.connected&&syncingPhone!==c.phone&&<button className="mediaRetryButton" type="button" onClick={()=>{automaticallySynced.current.get(c.phone)?.delete(e.id);void syncMediaForPhone(c.phone,[e.id]);}}><RefreshCw size={12}/> Reintentar descarga</button>}
    </div>}
    <div className="chatMessageReactions">
     {(e.reactions||[]).map(r=><button key={r.emoji} type="button" className={'reactionTag '+(r.mine?'reactionMine':'')} title={`${r.count} reacción(es) · ${r.mine?'Tu reacción':'Reacción de WhatsApp'}`} disabled={!waStatus.connected||reactionBusy!==null} onClick={()=>void reactToMessage(c,e.id,r.mine?'':r.emoji)}><span>{r.emoji}</span><span>{r.count}</span></button>)}
     <div className="reactionPickerWrap"><button type="button" className={'reactionPickToggle '+(reactionFor===e.id?'reactionIsOpen':'')} aria-label="Reaccionar a este mensaje" aria-haspopup="dialog" aria-expanded={reactionFor===e.id} title={waStatus.connected?'Elegir reacción de WhatsApp':'WhatsApp desconectado'} disabled={!waStatus.connected||reactionBusy!==null} onClick={ev=>openReactionPicker(ev,c,e.id)}><SmilePlus size={16}/></button></div>
    </div>
    <div className="chatMessageMeta" title={isOutgoing?(e.wa_ack===4?'Reproducido':(e.wa_ack??-1)>=3?'Leído en WhatsApp':(e.wa_ack??-1)>=2?'Entregado en WhatsApp':e.wa_ack===1?'Enviado':'Sin confirmación de entrega'):'Mensaje recibido'}><time dateTime={e.received_at} title={`${e.local_date} ${e.local_time} · ${e.outside_hours?'Fuera de horario':'En horario'}`}>{e.local_time?.slice(0,5)}</time>{isOutgoing&&(e.wa_ack!==null&&e.wa_ack!==undefined?(e.wa_ack>=2?<CheckCheck size={17} strokeWidth={2.6} className={e.wa_ack>=3?'ackRead':'ackDelivered'} aria-label={e.wa_ack>=3?'Leído':e.wa_ack===2?'Entregado':'Enviado'}/>:<Check size={17} strokeWidth={2.5} aria-label={e.wa_ack===1?'Enviado':'Pendiente de envío'}/>):<span title="Sin confirmación de WhatsApp"><Check size={17} strokeWidth={2.5}/></span>)}</div>
   </div>
  </div>
 </div>;
 })}</div>{msgMenu&&msgMenu.phone===c.phone&&createPortal((()=>{
  const event=c.events.find(x=>x.id===msgMenu.id);
  if(!event)return null;
  const tools=[
   {label:'Responder este mensaje',icon:Reply,run:()=>startQuotedReply(c.phone,event)},
   {label:'Copiar texto',icon:Copy,run:async()=>{setMsgMenu(null);try{await navigator.clipboard.writeText(event.message||'');setNotice('Mensaje copiado.')}catch{setError('No se pudo copiar; revisá los permisos del navegador.')}}},
   {label:'Reaccionar',icon:SmilePlus,run:(ev:React.MouseEvent<HTMLButtonElement>)=>{setMsgMenu(null);openReactionPicker(ev,c,event.id)}},
   {label:'Descargar archivo',icon:Download,run:()=>downloadMessageFile(event),disabled:!event.media_path},
   {label:'Reenviar a otro chat',icon:Forward,run:()=>{setForwardTarget({phone:c.phone,id:event.id});setForwardPhone('');setMsgMenu(null)}},
   {label:event.message_pinned?'Desfijar (local)':'Fijar (local)',icon:Pin,run:()=>void changeMessageFlag(c.phone,event.id,event.message_pinned?'unpin':'pin')},
   {label:event.message_starred?'Quitar destacado (local)':'Destacar (local)',icon:Star,run:()=>void changeMessageFlag(c.phone,event.id,event.message_starred?'unstar':'star')},
   {label:'Añadir texto a nota (local)',icon:NotebookPen,run:()=>{setNoteText(event.message_note||'');setNoteTarget({phone:c.phone,id:event.id});setMsgMenu(null)}}
  ];
  return <div className="messageContextBackdrop" role="presentation" onMouseDown={()=>setMsgMenu(null)}><div className="messageContextMenu" role="menu" aria-label="Acciones del mensaje" style={{left:msgMenu.left,top:msgMenu.top}} onMouseDown={ev=>ev.stopPropagation()}>{tools.map(item=><button key={item.label} type="button" role="menuitem" disabled={item.disabled||msgActionBusy} onClick={ev=>void item.run(ev)}><item.icon size={16}/>{item.label}</button>)}</div></div>;
 })(),document.body)}{reactionAnchor&&reactionFor===reactionAnchor.id&&reactionAnchor.phone===c.phone&&createPortal(
   <div className="reactionBackdrop" role="presentation" onMouseDown={()=>{setReactionFor(null);setReactionAnchor(null);setReactionError('')}}>
    <div className="reactionFloatingPanel" role="dialog" aria-label="Reaccionar a mensaje de WhatsApp" style={{left:reactionAnchor.left,top:reactionAnchor.top}} onMouseDown={ev=>ev.stopPropagation()}>
     <div className="reactionFloatingHeading"><span>Reaccionar al mensaje</span><button type="button" aria-label="Cerrar reacciones" onClick={()=>{setReactionFor(null);setReactionAnchor(null);setReactionError('')}}><X size={15}/></button></div>
     {(()=>{
      const target=c.events.find(item=>item.id===reactionFor);
      const available=Boolean(target?.wa_message_id&&!target.wa_message_id.startsWith('fallback-'));
      if(!available)return <p className="reactionFloatingInfo">Este mensaje no tiene identificador original de WhatsApp. No se puede sincronizar su reacción.</p>;
      return <><div className="reactionFloatingOptions">{CHAT_EMOJIS.map(emoji=><button key={emoji} type="button" title={'Reaccionar '+emoji} aria-label={'Reaccionar '+emoji} disabled={reactionBusy!==null} onClick={()=>void reactToMessage(c,reactionFor,emoji)}>{emoji}</button>)}</div>
      {(target?.reactions||[]).some(r=>r.mine)&&<button type="button" className="reactionFloatingRemove" disabled={reactionBusy!==null} onClick={()=>void reactToMessage(c,reactionFor,'')}>Quitar mi reacción</button>}</>;
     })()}
     {reactionBusy===reactionFor&&<small className="reactionFloatingInfo">Sincronizando con WhatsApp…</small>}
     {reactionError&&<p className="reactionFloatingError" role="alert">{reactionError}</p>}
    </div>
   </div>,document.body)}<div className="chatDetailActions"><button className="smallButton" onClick={()=>setReplyOpen(v=>!v)}><Send size={14}/> {replyOpen?'Cerrar respuesta':'Responder'}</button>{<button className="smallButton" disabled={loading||!health.jiraRealEnabled||!count} onClick={()=>openTicketDraft({...c,customer:name})}><Plus size={14}/> Nuevo ticket / subtarea CW ({count})</button>}</div>{replyOpen&&<div className={'replyComposer'+(dropActive?' replyDragActive':'')} onPaste={pasteReplyFile} onDragEnter={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDropActive(true)}}} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';setDropActive(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropActive(false)}} onDrop={onReplyDrop}>
 {quoteTarget?.phone===c.phone&&<div className="quoteReplyBar"><Reply size={17}/><div><strong>Respondiendo a este mensaje</strong><span>{quoteTarget.message}</span></div><button type="button" title="Quitar cita" aria-label="Quitar mensaje citado" onClick={()=>setQuoteTarget(null)}><X size={16}/></button></div>}
 {dropActive&&<div className="replyDropOverlay" aria-hidden="true"><Paperclip size={25}/> Soltá el archivo para adjuntarlo</div>}
 <textarea ref={replyTextareaRef} rows={3} placeholder="Escribí un mensaje..." aria-label="Mensaje de respuesta" value={replyText} onChange={e=>{setReplyText(e.target.value);setReplyError('')}} onKeyDown={e=>replyKeyDown(e,c)} maxLength={3000}/>
 <input ref={replyFileInput} type="file" accept="image/*,video/mp4,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" className="replyFileInput" aria-label="Seleccionar archivo para enviar" onChange={e=>{chooseReplyFile(e.currentTarget.files?.[0]);e.currentTarget.value='';}}/>
 {replyAttachment&&<div className="replyImagePreview">{replyAttachment.mime.startsWith('image/')&&replyAttachment.preview?<img src={replyAttachment.preview} alt="Vista previa del archivo"/>:replyAttachment.mime.startsWith('video/')&&replyAttachment.preview?<video src={replyAttachment.preview} controls preload="metadata" aria-label="Vista previa del video"/>:<FileText size={30} aria-hidden="true"/>}<div><strong>{replyAttachment.file.name}</strong><small>{ticketFileSize(replyAttachment.file.size)} · {replyAttachment.mime.startsWith('video/')?'Video':replyAttachment.mime.startsWith('image/')?'Imagen':'Documento'}</small></div><button type="button" className="iconButton" title="Quitar archivo" aria-label="Quitar archivo" onClick={()=>setReplyAttachment(null)}><X size={17}/></button></div>}
 {replyError&&<small className="replyInlineError" role="alert">{replyError}</small>}
 <div className="replyToolbar"><div className="replyToolbarLeft"><button type="button" className="smallButton" disabled={sendingReply||!waStatus.connected} onClick={()=>replyFileInput.current?.click()}><Paperclip size={15}/> Archivo</button><button type="button" className="smallButton" aria-label="Elegir emoji para el mensaje" aria-expanded={showReplyEmojis} disabled={sendingReply} onClick={()=>setShowReplyEmojis(v=>!v)}><SmilePlus size={16}/> Emoji</button><small>Enter: enviar · Ctrl+Enter: nueva línea · Ctrl+V: pegar captura · Arrastrar archivos</small></div><button type="button" className="primary" disabled={sendingReply||(!replyText.trim()&&!replyAttachment)||!waStatus.connected} onClick={()=>void sendReply(c)}><Send size={14}/> {sendingReply?'Enviando…':'Enviar'}</button></div>
 {showReplyEmojis&&<div className="replyEmojiPicker" role="group" aria-label="Elegir emoji para escribir">{CHAT_EMOJIS.map(emoji=><button key={emoji} type="button" disabled={sendingReply} aria-label={'Insertar emoji '+emoji} onClick={()=>insertReplyEmoji(emoji)}>{emoji}</button>)}</div>}
 {!waStatus.connected&&<small className="replyConnectionHint" role="status">{waStatus.error||'Esperando conexión de WhatsApp. Reiniciá npm run whatsapp si el conector está detenido.'}</small>}
 </div>}</>})()}</div></div>}
 {filter!=='whatsapp'&&<div className="tableWrap"><table><thead><tr><th>CASO</th><th>CLIENTE / MENSAJE</th><th>FECHA PARAGUAY</th><th>REGLA</th><th>ESTADO</th><th>ACCIÓN</th></tr></thead><tbody>{filtered.filter(c=>c.source!=='whatsapp').map(c=><tr key={c.id}><td className="mono">#{c.id}</td><td><b>{c.customer}</b><small>{c.source==='whatsapp'?'WhatsApp real':'Simulación'}</small><small className="messageFull" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:500}}>{expanded===c.id?c.message:c.message.length>140?c.message.slice(0,140)+'…':c.message}</small>{c.message.length>140&&<button className="simple" onClick={()=>setExpanded(expanded===c.id?null:c.id)}>{expanded===c.id?'Ver menos':'Leer mensaje completo'}</button>}</td><td>{c.local_date}<small>{c.local_time}</small></td><td>{c.reason}</td><td><span className={'tag '+(c.status==='created'?'success':c.status==='pending'?'amber':c.status==='ignored'?'neutral':'red')}>{c.status==='created'&&c.jira_key&&jiraLink(c.jira_key)?<a className="jiraTicketLink" target="_blank" rel="noopener noreferrer" href={jiraLink(c.jira_key)!} title="Abrir ticket en Jira">{c.jira_key}<ExternalLink size={13}/></a>:c.status==='created'?'Creado':c.status==='pending'?'Pendiente':c.status==='ignored'?'Sin ticket':'Revisar'}</span>{c.error&&<small title={c.error}>Revisar error</small>}</td><td>{c.status==='pending'?<button disabled={loading||!health.jiraRealEnabled} title={health.jiraRealEnabled?'Crea ticket real':'Habilitá ENABLE_REAL_JIRA=true'} className="smallButton" onClick={()=>create(c)}><Plus size={14}/> Crear ticket CW</button>:c.jira_key?<a target="_blank" rel="noreferrer" href={jiraLink(c.jira_key)||'#'}>Ver ticket <ExternalLink size={13}/></a>:<span className="empty">—</span>}</td></tr>)}{filtered.filter(c=>c.source!=='whatsapp').length===0&&<tr><td colSpan={6} className="emptyRow">No hay registros en esta vista.</td></tr>}</tbody></table></div>}</section></>}
 {tab==='settings'&&settingsSection==='tickets'&&<section className="card settingsTickets compactTicketControl">
  <div className="cardHead compactTicketHead">
   <div><h2><Ticket size={18}/> Seguimiento de tickets CW</h2><p>Estados y responsables reales de Jira, ordenados por número de ticket. Consultá los detalles sin salir de TicketBridge.</p></div>
   <div className="settingsTicketButtons">
    <button type="button" className="smallButton" disabled={ticketStatusBusy||!health.jiraRealEnabled} onClick={()=>void updateTicketStatuses()}><RefreshCw size={14} className={ticketStatusBusy?'syncSpin':''}/> {ticketStatusBusy?'Actualizando…':'Actualizar desde Jira'}</button>
    <button type="button" className="smallButton" onClick={showAllTickets}><Ticket size={14}/> Ver panel</button>
   </div>
  </div>
  <div className="ticketStatusMetrics" aria-label="Resumen de estados">
   {([{id:'all',label:'Todos',count:allManagedTickets.length},{id:'todo',label:'Pendientes',count:ticketStats.todo},{id:'progress',label:'En curso',count:ticketStats.progress},{id:'done',label:'Resueltos / finalizados',count:ticketStats.done},{id:'unknown',label:'Sin consultar',count:ticketStats.unknown},{id:'sopn1',label:'SopN1',count:ticketStats.sopn1},{id:'sopn2',label:'SopN2',count:ticketStats.sopn2}] as const).map(item=><button key={item.id} type="button" className={'ticketMetric '+(ticketStateFilter===item.id?'active':'')} aria-pressed={ticketStateFilter===item.id} onClick={()=>setTicketStateFilter(item.id)}><b>{item.count}</b><span>{item.label}</span></button>)}
  </div>
  <div className="ticketControlFilters">
   <label className="ticketControlSearch"><Search size={15}/><input aria-label="Buscar ticket" type="search" value={ticketSearch} onChange={e=>setTicketSearch(e.target.value)} placeholder="Buscar CW, cliente, asunto o estado"/></label>
   <label className="ticketOwnerSelect">Responsable <select aria-label="Filtrar responsable" value={ticketAssigneeFilter} onChange={e=>setTicketAssigneeFilter(e.target.value)}><option value="all">Todos</option>{ticketOwners.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
   <span className="ticketResultsCount">{ticketsManagedView.length} de {allManagedTickets.length}</span>
  </div>
  {ticketStatusMessage&&<p className="ticketSyncFeedback" role="status">{ticketStatusMessage}</p>}
  <div className="compactTicketList" aria-label="Tickets Jira CW">
   {ticketsManagedView.map(t=><button type="button" className="compactTicketRow" key={t.id} onClick={()=>{setTicketsPhone('__all__');void fetchJiraTicket(t.ownerPhone,t.jira_key)}} title={'Ver detalles de '+t.jira_key}>
    <span className="compactTicketMain"><strong>{t.jira_key}</strong><span title={t.title}>{t.title}</span><small>{t.ownerName||'Cliente sin nombre'} · {t.kind==='subtask'?'Subtarea':'Ticket'}</small></span>
    <span className="compactTicketOwner" title={t.assignee_name||'Responsable no consultado'}><Users size={13}/>{t.assignee_name||'Sin consultar'}</span>
    <span className={'compactTicketState state-'+ticketStateKind(t)} title={t.jira_synced_at?'Última consulta: '+ticketDateLabel(t.jira_synced_at):'Estado no consultado en Jira'}>{t.jira_status||'Sin consultar'}</span>{/^sopn[12]$/i.test((t.jira_status||'').trim())&&<span className={'tbTierBadge '+(/sopn2/i.test(t.jira_status||'')?'tier2':'tier1')} title="Nivel indicado por el estado verificado de Jira">{/sopn2/i.test(t.jira_status||'')?'N2':'N1'}</span>}
    <ExternalLink size={14} className="compactTicketAction"/>
   </button>)}
   {!ticketsManagedView.length&&<p className="emptyText">{allManagedTickets.length?'No hay tickets que coincidan con los filtros.':'Todavía no hay tickets vinculados a TicketBridge.'}</p>}
  </div>
  <div className="tbTierLegend" role="note"><span><b>SopN1</b> · Atiende Nivel 1</span><span><b>SopN2</b> · Escalar a Nivel 2</span><span>Los avisos se envían una sola vez después de confirmar la reasignación en Jira.</span></div><p className="compactTicketNote">Los estados son los registrados en Jira en la última consulta. Actualizá para ver cambios recientes. Esta pantalla no modifica el estado ni el responsable en Jira.</p>
 </section>}
 {tab==='settings'&&settingsSection==='advanced'&&<><nav className="twToolTabs" aria-label="Herramientas"><button type="button" className={toolTab==='assistant'?'selected':''} onClick={()=>setToolTab('assistant')}><MessageCircle size={15}/> Asistente</button><button type="button" className={toolTab==='connection'?'selected':''} onClick={()=>setToolTab('connection')}><WifiOff size={15}/> WhatsApp</button><button type="button" className={toolTab==='tools'?'selected':''} onClick={()=>setToolTab('tools')}><Settings2 size={15}/> Más ajustes</button></nav>{toolTab==='assistant'&&<SupportAutomationSettings onOpenExcluded={()=>{setTab('panel');setChatView('excluded');setRosterMode('chats');setChatSearch('');}}/>}{toolTab==='connection'&&<WhatsAppConnectionPanel/>}</>}
 {tab==='settings'&&settingsSection==='advanced'&&toolTab==='tools'&&<section className="card twSimulationWorkspace"><div className="cardHead"><div><h2><MessageCircle size={19}/> Simulador</h2><p>Mensajes, llamadas y automatización de prueba. No envía WhatsApp, no llama y no crea tickets de Jira.</p></div><span className="twDemoBadge">MODO SEGURO</span></div><SimulationPhoneLab/><AutomationScenarioSuite/></section>}
 {tab==='settings'&&settingsSection==='advanced'&&toolTab==='tools'&&<details className="settingsToolsDetails"><summary><Settings2 size={16}/> Horarios, feriados y conexiones <ChevronDown size={15}/></summary><div className="settingsToolsBody">
 <div className="two"><section className="card"><div className="cardHead"><div><h2><CalendarDays size={20}/> Calendario de días no laborables</h2><p>Ingresá fechas efectivas de Paraguay, incluidos traslados y feriados extraordinarios.</p></div></div><label>Fecha<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label><label>Nombre del feriado<input placeholder="Ej. Feriado nacional confirmado" value={holidayName} onChange={e=>setHolidayName(e.target.value)}/></label><button className="primary" disabled={loading||!day||!holidayName} onClick={()=>perform(async()=>{await req('/api/holidays','POST',{date:day,name:holidayName});setDay('');setHolidayName('');setNotice('Feriado guardado.');})}><Plus size={16}/> Guardar feriado</button><div className="note"><CalendarDays size={19}/><p>Para evitar fechas incorrectas, el sistema no inventa feriados. Cargá los confirmados oficialmente. Las fechas se guardan en SQLite.</p></div></section><section className="card"><div className="cardHead"><div><h2>Feriados configurados</h2><p>{holidays.length} feriados configurados</p></div></div>{holidays.length===0?<p className="emptyText">Todavía no cargaste feriados. Hasta entonces, se detectarán fines de semana y horarios, pero no días festivos.</p>:holidays.map(h=><div className="holiday" key={h.date}><div><strong>{h.date}</strong><small>{h.name}</small></div><button title="Eliminar feriado" className="iconButton" onClick={()=>perform(async()=>{await req('/api/holidays','DELETE',{date:h.date});setNotice('Feriado eliminado.');})}><Trash2 size={16}/></button></div>)}</section></div>
 <><section className="card"><div className="cardHead"><div><h2><MessageCircle size={19}/> Conexiones</h2><p>Estado del conector y Jira</p></div></div><div className="detail"><span>WhatsApp QR</span><strong>{waStatus.connected?'Conectado':waStatus.service?'Iniciando sesión':'Conector no disponible'}</strong></div><div className="detail"><span>Jira CW</span><strong>{health.jiraRealEnabled?'Habilitado':'Deshabilitado'}</strong></div><p className="emptyText">El conector QR es no oficial. Los mensajes solo se envían cuando confirmás Responder.</p></section><div className="two"><section className="card"><div className="cardHead"><div><h2><Clock3 size={19}/> Horario de atención</h2><p>Zona horaria fija: America/Asuncion.</p></div></div><div className="formGrid"><label>Inicio<input type="time" value={settings.start} onChange={e=>setSettings({...settings,start:e.target.value})}/></label><label>Fin<input type="time" value={settings.end} onChange={e=>setSettings({...settings,end:e.target.value})}/></label></div><button className="primary" disabled={loading} onClick={()=>perform(async()=>{await req('/api/settings','PUT',{start:settings.start,end:settings.end});setNotice('Horario actualizado.');})}>Guardar horario</button><div className="note"><Clock3 size={19}/><p>Los sábados y domingos siempre se consideran fuera del horario. Los feriados cargados también, aunque sean días de semana.</p></div></section><section className="card"><div className="cardHead"><div><h2><Settings2 size={19}/> Conexión Jira</h2><p>Las credenciales se guardan en el archivo local .env.local.</p></div></div><div className="detail"><span>Proyecto</span><strong>{health.project}</strong></div><div className="detail"><span>Creación real</span><strong>{health.jiraRealEnabled?'Habilitada':'Deshabilitada'}</strong></div><div className="detail"><span>Conector WhatsApp</span><strong>Proceso separado (npm run whatsapp)</strong></div><button className="outline" onClick={checkJira} disabled={loading}>Probar credenciales de Jira</button><div className="note"><ShieldCheck size={19}/><p>Este laboratorio escucha solo en 127.0.0.1:3000. Nunca publiques .env.local ni la carpeta data.</p></div></section></div></>
 </div></details>}
 {preview&&<div className="imageLightbox" role="dialog" aria-modal="true" aria-label="Vista ampliada de imagen" onClick={()=>setPreview(null)}><div className="imageLightboxContent" onClick={e=>e.stopPropagation()}><div><strong>{preview.name}</strong><button className="smallButton" onClick={()=>setPreview(null)}>Cerrar ×</button></div><img src={'/api/media/'+preview.id} alt={preview.name}/><a href={'/api/media/'+preview.id} target="_blank" rel="noopener noreferrer">Abrir archivo original ↗</a></div></div>}<footer>W-Ticket · Soporte TI · WhatsApp y Jira CW · Paraguay</footer></main></div>;
}
