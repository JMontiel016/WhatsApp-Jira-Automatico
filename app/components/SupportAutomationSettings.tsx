'use client';

import {useEffect,useMemo,useState} from 'react';
import {Check,CheckCircle2,ChevronDown,Edit3,MessageCircle,Save,Search,Users,RefreshCw} from 'lucide-react';
import {AUTOMATION_SYSTEM_OPTIONS,AUTOMATION_TEXT_DEFAULTS,AUTOMATION_TEXT_FIELDS,AUTOMATION_OPTIONAL_QUESTIONS,type AutomationTextKey} from '@/lib/automation-text';
import SupportSimulator from './SupportSimulator';
import AutomationControlCenter from './AutomationControlCenter';
import GuardiaContacts from './GuardiaContacts';
import {emptyTeam,TEAM_ROLES,type JiraPerson,type JiraTeam,type TeamRole} from '@/lib/jira-team';
import {EXTRA_SYSTEMS,parseExtraFields,type ExtraField,type ExtraSystem} from '@/lib/automation-extra-fields';

type FlowOptions={startMode:'first'|'keyword';shortForm:boolean;confirmation:boolean;multipleSystems:boolean;humanPause:boolean;systems:string[]};
type Values={questionEnabled:Record<string,boolean>;supportNotifications:Record<TeamRole,string>;flow:FlowOptions;start:string;end:string;enabled:boolean;team:JiraTeam;texts:Record<AutomationTextKey,string>;level2Phone:string;level2Minutes:number;excludedPhones:string;supportPhones:Record<TeamRole,string>;autoCallEnabled:boolean;callRoles:Record<'level1'|'level2',boolean>;extraFields:ExtraField[]};
const roles:TeamRole[]=['level1','level2','manager'];
const OPTIONAL_QUESTIONS=new Set<string>(AUTOMATION_OPTIONAL_QUESTIONS);
const makeQuestionEnabled=()=>Object.fromEntries([...OPTIONAL_QUESTIONS].map(key=>[key,true])) as Record<string,boolean>;
const defaultValues=():Values=>({questionEnabled:makeQuestionEnabled(),supportNotifications:{level1:'',level2:'',manager:''},flow:{startMode:'first',shortForm:false,confirmation:true,multipleSystems:false,humanPause:true,systems:[...AUTOMATION_SYSTEM_OPTIONS]},start:'08:00',end:'18:00',enabled:false,team:emptyTeam(),texts:{...AUTOMATION_TEXT_DEFAULTS},level2Phone:'',level2Minutes:30,excludedPhones:'',supportPhones:{level1:'',level2:'',manager:''},autoCallEnabled:false,callRoles:{level1:false,level2:true},extraFields:[]});
const groups=['Bienvenida','Futura100','Talento100','Consulta TI','Otros sistemas','Finalización'];
function parsedValues(raw:Record<string,string>):Values{
 const values=defaultValues();values.start=raw.start||values.start;values.end=raw.end||values.end;
 values.flow={startMode:raw.automation_flow_start==='keyword'?'keyword':'first',shortForm:raw.automation_flow_short==='1',confirmation:raw.automation_flow_confirm!=='0',multipleSystems:raw.automation_flow_multi==='1',humanPause:raw.automation_flow_human!=='0',systems:(()=>{try{const list=JSON.parse(raw.automation_flow_systems||'[]');const filtered=AUTOMATION_SYSTEM_OPTIONS.filter(x=>Array.isArray(list)&&list.includes(x));return filtered.length?filtered:[...AUTOMATION_SYSTEM_OPTIONS];}catch{return [...AUTOMATION_SYSTEM_OPTIONS];}})()};
 values.enabled=raw.automation_enabled==='1';values.level2Phone=raw.automation_level2_phone||'';values.level2Minutes=Number(raw.automation_level2_minutes)||30;values.excludedPhones=raw.automation_excluded_phones||'';for(const role of roles)values.supportPhones[role]=raw[`automation_${role}_phone`]||'';values.autoCallEnabled=raw.automation_auto_call_enabled==='1';values.extraFields=parseExtraFields(raw.automation_extra_fields||'[]');values.callRoles={level1:raw.automation_call_level1==='1',level2:raw.automation_call_level2==='1'};
 for(const role of roles){values.team[role]={id:raw[`automation_${role}_id`]||'',name:raw[`automation_${role}_name`]||''};}
 for(const key of Object.keys(values.texts) as AutomationTextKey[]) values.texts[key]=raw['automation_text_'+key]||values.texts[key];
 for(const key of OPTIONAL_QUESTIONS)values.questionEnabled[key]=raw['automation_prompt_enabled_'+key]!=='0';
 for(const role of roles)values.supportNotifications[role]=raw['automation_notice_'+role]||'';
 return values;
}
async function json<T>(path:string,options?:RequestInit):Promise<T>{
 const response=await fetch(path,{...options,cache:'no-store'});
 const data=await response.json().catch(()=>({error:'Respuesta inválida del servidor'}));
 if(!response.ok)throw Error(data.error||'Error de comunicación');
 return data as T;
}
type SupportAutomationSettingsProps={onOpenExcluded?:()=>void};
export default function SupportAutomationSettings({onOpenExcluded}:SupportAutomationSettingsProps){
 const [form,setForm]=useState<Values>(defaultValues);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[toggling,setToggling]=useState(false);
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 const [editorOpen,setEditorOpen]=useState(false);
 const [extraSystem,setExtraSystem]=useState<ExtraSystem>('Futura100');
 const [newExtraLabel,setNewExtraLabel]=useState('');
 const [activeRole,setActiveRole]=useState<TeamRole|null>(null);
 const [search,setSearch]=useState('');
 const [users,setUsers]=useState<JiraPerson[]>([]),[searching,setSearching]=useState(false);
 const [preview,setPreview]=useState<0|1|2|3|4>(0);
 const [pendingNotices,setPendingNotices]=useState<Array<{key:string;role:string;error:string|null}>>([]);
 const [retrying,setRetrying]=useState(false);
 useEffect(()=>{let mounted=true;const sync=async()=>{if(toggling||saving||loading)return;try{const current=await json<Record<string,string>>('/api/settings');if(mounted)setForm(old=>({...old,enabled:current.automation_enabled==='1'}));}catch{}};const timer=setInterval(()=>void sync(),7000);return()=>{mounted=false;clearInterval(timer);};},[toggling,saving,loading]);
 const [followups,setFollowups]=useState<Array<{jira_key:string;state:string;due_at:string;overdue:number;error?:string}>>([]);
 const [phoneProviderReady,setPhoneProviderReady]=useState(false);
 const [callStates,setCallStates]=useState<Array<{ticket_id:number;role:string;state:string;error?:string}>>([]);
 useEffect(()=>{let mounted=true;
  json<Record<string,string>>('/api/settings').then(data=>{if(mounted)setForm(parsedValues(data));}).catch(e=>{if(mounted)setError(e.message);}).finally(()=>{if(mounted)setLoading(false);});
  return()=>{mounted=false;};
 },[]);
 useEffect(()=>{
  if(!activeRole||search.trim().length<2){setUsers([]);return;}
  let active=true;const timer=setTimeout(async()=>{
   setSearching(true);
   try{const found=await json<JiraPerson[]>('/api/jira/assignees?q='+encodeURIComponent(search.trim()));if(active)setUsers(found.filter(person=>person.id&&person.name));}
   catch(e){if(active){setUsers([]);setError(e instanceof Error?e.message:'Error buscando usuarios de Jira');}}
   finally{if(active)setSearching(false);}
  },320);
  return()=>{active=false;clearTimeout(timer);};
 },[activeRole,search]);
 useEffect(()=>{let active=true;
  async function load(){try{const result=await json<{pending:Array<{key:string;role:string;error:string|null}>}>('/api/jira/team-notifications');if(active)setPendingNotices(result.pending);}catch{}}
  void load();const timer=setInterval(()=>void load(),20000);return()=>{active=false;clearInterval(timer);};
 },[]);
 async function retryNotices(){setRetrying(true);setError('');try{
  const result=await json<{confirmed:number;failed:number}>('/api/jira/team-notifications',{method:'POST'});
  setMessage(`${result.confirmed} aviso(s) confirmados, ${result.failed} todavía pendientes.`);
  const now=await json<{pending:Array<{key:string;role:string;error:string|null}>}>('/api/jira/team-notifications');setPendingNotices(now.pending);
 }catch(e){setError(e instanceof Error?e.message:'No se pudieron comprobar los avisos');}finally{setRetrying(false);}}
 useEffect(()=>{let mounted=true;async function load(){try{const r=await json<{items:typeof followups}>('/api/automation/followups');if(mounted)setFollowups(r.items);}catch{}}void load();const timer=setInterval(()=>void load(),15000);return()=>{mounted=false;clearInterval(timer);};},[]);
 useEffect(()=>{let mounted=true;async function load(){try{const r=await json<{providerReady:boolean;calls:typeof callStates}>('/api/automation/calls');if(mounted){setPhoneProviderReady(r.providerReady);setCallStates(r.calls);}}catch{}}void load();const timer=setInterval(()=>void load(),20000);return()=>{mounted=false;clearInterval(timer);};},[]);
 async function resendLevel2(key:string){
  if(!window.confirm('¿Verificaste que Nivel 2 NO recibió el enlace de '+key+'? Un reenvío podría duplicar el aviso.'))return;
  setRetrying(true);setError('');
  try{const result=await json<{ok:boolean,error?:string}>('/api/automation/followups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,confirm:'NO_FUE_ENTREGADO'})});
   if(!result.ok)throw Error(result.error||'Envío sin confirmar');
   setMessage('Nivel 2 recibió la confirmación de envío para '+key+'.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo verificar el reenvío');}
  finally{setRetrying(false);}
 }

 const previewQuestions=(system:string)=>{
  if(form.flow.shortForm)return 'Inconveniente: contanos qué sucede';
  const options:Record<string,Array<[string,string]>>={
   Futura100:[['ruc','RUC: ...']],Talento100:[['talentName','Nombre: ...'],['talentId','Cédula: ...'],['talentEmail','Correo: ...']],
   'Otro sistema':[['otherSystem','Sistema: ...'],['otherEmail','Correo: ...']]
  };
  return [...(options[system]||[]).filter(([key])=>form.questionEnabled[key]!==false).map(([,label])=>label),'Inconveniente: ...'].join('\n');
 };
 const noticePreview=(role:TeamRole)=>{
  const url='https://jira.ejemplo/browse/CW-123';
  const raw=(form.supportNotifications[role]||'{link}').replaceAll('{ticket}','CW-123').replaceAll('{nivel}',role==='level1'?'N1':role==='level2'?'N2':'Encargado').replaceAll('{link}',url).trim();
  return raw.includes(url)?raw:raw+'\n'+url;
 };
 const unique=useMemo(()=>new Set(roles.map(role=>form.team[role].id).filter(Boolean)).size===roles.filter(role=>form.team[role].id).length,[form.team]);
 const chooseUser=(role:TeamRole,user:JiraPerson)=>{setForm(f=>({...f,team:{...f.team,[role]:user}}));setActiveRole(null);setSearch('');setUsers([]);setMessage('');};
 async function save(){
  setError('');setMessage('');
  if(!unique){setError('Cada puesto debe tener una persona distinta.');return;}
  if(!form.flow.systems.length){setError('Seleccioná al menos un sistema disponible.');return;}
  setSaving(true);
  try{const latest=await json<Record<string,string>>('/api/settings');await json('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:latest.start||form.start,end:latest.end||form.end,automationEnabled:form.enabled,team:form.team,texts:form.texts,questionEnabled:form.questionEnabled,supportNotifications:form.supportNotifications,level2Phone:form.supportPhones.level2,excludedPhones:form.excludedPhones,supportPhones:form.supportPhones,extraFields:form.extraFields,flow:form.flow,})});const stored=await json<Record<string,string>>('/api/settings');setForm(parsedValues(stored));setMessage('Teléfonos, equipo y preferencias guardados. Asistente: '+(stored.automation_enabled==='1'?'ACTIVADO':'DESACTIVADO')+'.');}
  catch(e){setError(e instanceof Error?e.message:'No se pudieron guardar los ajustes');}
  finally{setSaving(false);}
 }
 async function setEnabled(enabled:boolean){
  if(toggling||loading)return;
  setToggling(true);setError('');setMessage('');
  try{
   const result=await json<{ok:boolean;enabled:boolean}>('/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({automationEnabled:enabled})});
   const check=await json<Record<string,string>>('/api/settings');setForm(old=>({...old,enabled:check.automation_enabled==='1'}));if((check.automation_enabled==='1')!==enabled)throw Error('El servidor no conservó el estado solicitado');
   setMessage(enabled?'Asistente activado y guardado.':'Asistente DESACTIVADO y guardado. No enviará respuestas automáticas.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo cambiar el estado del asistente');}
  finally{setToggling(false);}
 }
 return <section className="card automationCard" aria-label="Automatización de soporte">
  <div className="automationHeading">
   <div className="automationIcon"><MessageCircle size={22}/></div>
   <div className="automationIntro"><span className="automationEyebrow">W-TICKET · ATENCIÓN DE CLIENTES</span><h2>Asistente automático</h2><p>Responde según los horarios configurados, recopila datos y evidencias, y prepara el ticket para confirmación.</p></div>
   <label className="automationSwitch"><input type="checkbox" checked={form.enabled} disabled={loading||saving||toggling} onChange={e=>void setEnabled(e.target.checked)}/><span className="automationTrack"/><span>{form.enabled?'Activado':'Desactivado'}</span></label>
  </div>
  <nav className="wtAssistantNav" aria-label="Ir a una configuración del asistente">
   <a href="#wtHorario"><span>01</span> Horarios y disponibilidad</a>
   <a href="#wtFlujo"><span>02</span> Atención y tickets</a>
   <a href="#wtEquipo"><span>03</span> Equipo de soporte</a>
   <a href="#wtAvisos"><span>04</span> Avisos a N1 / N2</a>
   <a href="#wtMensajes"><span>05</span> Mensajes y simulador</a>
  </nav>
  <div className="wtAssistantSummary" role="status">
   <div><span>Asistente</span><strong>{form.enabled?'Activado':'Desactivado'}</strong></div>
   <div><span>Atención</span><strong>{form.flow.startMode==='first'?'Al primer mensaje':'Por palabra clave'}</strong></div>
   <div><span>Formulario</span><strong>{form.flow.shortForm?'Rápido (2 datos)':'Detallado'}</strong></div>
   <div><span>Creación Jira</span><strong>{form.flow.confirmation?'Con confirmación':'Sin confirmar*'}</strong></div>
   <small>*Solo puede crear automáticamente cuando el asistente, la regla horaria y Jira están habilitados.</small>
  </div>
  <div id="wtHorario" className="wtSectionAnchor">
   <div className="wtAssistantSectionHead"><span className="wtAssistantStep">01</span><div><h3>Horarios y disponibilidad</h3><p>Elegí a qué hora atiende el bot; podés habilitarlo fuera de horario y desactivarlo durante el día.</p></div></div>
   <AutomationControlCenter legacyExcludedPhones={form.excludedPhones} onLegacyExcludedChange={value=>setForm(f=>({...f,excludedPhones:value}))}/>
   {onOpenExcluded&&<button type="button" className="automationEditButton" onClick={onOpenExcluded}>Ver clientes sin bot en la bandeja</button>}
  </div>
  <div id="wtFlujo" className="wtSectionAnchor">
  <div className="wtAssistantSectionHead"><span className="wtAssistantStep">02</span><div><h3>Atención y tickets</h3><p>Elegí cuándo empezar, qué preguntar y si necesitás confirmación antes de Jira.</p></div></div>
  <section className="twFlowConfig" aria-label="Reglas del formulario y creación de tickets">
   <header><h3>Configurar atención y creación de tickets</h3><p>Elegí cómo inicia el asistente, los datos necesarios y cuándo se genera el ticket. Cada cambio se aplica a solicitudes nuevas tras Guardar configuración.</p></header>
   <div className="twFlowGrid">
    <label className="twFlowSelect"><strong>Inicio de atención</strong><select value={form.flow.startMode} onChange={e=>setForm(f=>({...f,flow:{...f.flow,startMode:e.target.value as FlowOptions['startMode']}}))}><option value="first">Al primer mensaje del cliente</option><option value="keyword">Solo al escribir SOPORTE o MENÚ</option></select><small>No se inicia una conversación sin un mensaje del cliente; para contactar primero necesitás la integración oficial de Meta y, cuando corresponda, una plantilla aprobada.</small></label>
    <label className="twFlowChoice"><span><strong>Formulario corto</strong><small>Solo sistema e inconveniente. Sin RUC, cédula o correo obligatorios.</small></span><input type="checkbox" checked={form.flow.shortForm} onChange={e=>setForm(f=>({...f,flow:{...f.flow,shortForm:e.target.checked,multipleSystems:e.target.checked?f.flow.multipleSystems:false,confirmation:e.target.checked?f.flow.confirmation:true}}))}/></label>
    <label className="twFlowChoice"><span><strong>Confirmar antes de crear ticket</strong><small>Apagado + formulario corto: Jira se crea al recibir el inconveniente, sin escribir LISTO. Solo si ENABLE_REAL_JIRA=true.</small></span><input type="checkbox" checked={form.flow.confirmation} onChange={e=>setForm(f=>({...f,flow:{...f.flow,confirmation:e.target.checked,shortForm:e.target.checked?f.flow.shortForm:true}}))}/></label>
    <label className="twFlowChoice"><span><strong>Varios sistemas en la misma solicitud</strong><small>Ej.: Futura100 y Talento100. Se genera un único ticket con ambos sistemas; disponible en modo corto.</small></span><input type="checkbox" disabled={!form.flow.shortForm} checked={form.flow.shortForm&&form.flow.multipleSystems} onChange={e=>setForm(f=>({...f,flow:{...f.flow,multipleSystems:e.target.checked}}))}/></label>
    <label className="twFlowChoice"><span><strong>Respetar la atención humana</strong><small>Si Soporte TI respondió manualmente, el bot no interrumpe durante 24 horas; si hay ticket abierto, no repite el menú.</small></span><input type="checkbox" checked={form.flow.humanPause} onChange={e=>setForm(f=>({...f,flow:{...f.flow,humanPause:e.target.checked}}))}/></label>
   </div>
   <fieldset className="twFlowSystems"><legend>Sistemas disponibles en el menú</legend><div>{AUTOMATION_SYSTEM_OPTIONS.map(sys=><label key={sys}><input type="checkbox" checked={form.flow.systems.includes(sys)} onChange={e=>setForm(f=>({...f,flow:{...f.flow,systems:e.target.checked?[...f.flow.systems,sys]:f.flow.systems.filter(x=>x!==sys)}}))}/>{sys}</label>)}</div></fieldset>
   {!form.flow.confirmation&&form.flow.shortForm&&<p className="twFlowWarning">Sin confirmación: la solicitud puede crear un ticket real automáticamente. Usá ENABLE_REAL_JIRA=false durante las pruebas. No se creará un segundo ticket si ya hay uno abierto.</p>}
   {!form.flow.shortForm&&!form.flow.confirmation&&<p className="twFlowWarning">El modo detallado conserva LISTO y la confirmación anterior. Para quitar ambos pasos, activá Formulario corto.</p>}
   {!form.flow.systems.length&&<p className="automationError">Seleccioná al menos un sistema para guardar.</p>}
  </section>
  </div>
  <div className="twSupportFlow">{form.flow.shortForm?'Soporte TI · '+(form.flow.startMode==='first'?'Primer mensaje':'SOPORTE / MENÚ')+' · Sistema · Inconveniente · '+(form.flow.confirmation?'Confirmar · ':'')+'Jira':'Soporte TI · Menú · Datos · Evidencias · Confirmación · Jira'}</div>
  <div id="wtEquipo" className="wtSectionAnchor">
  <div className="wtAssistantSectionHead"><span className="wtAssistantStep">03</span><div><h3>Equipo de soporte</h3><p>Una sola configuración para N1, N2 y Encargado: Jira, contacto y guardias.</p></div></div>
  <section className="twSupportTeamSection" aria-label="Equipo de soporte"><header className="twSimpleHeader twSupportTeamHeader"><Users size={18}/><div><h3>Equipo de soporte</h3><p>Configurá las personas, sus usuarios de Jira y contactos de WhatsApp en un solo lugar.</p></div><span className="twTeamCount">{roles.filter(role=>form.team[role].id).length}/3 en Jira</span></header><div className="twSupportTeamBody">
  <div className="automationTeamGrid">
   {roles.map((role,index)=><div className="automationPerson" key={role}>
    <div className="automationPersonTop"><span className="automationPersonNumber">{index+1}</span><strong>{TEAM_ROLES[role]}</strong>{form.team[role].id&&<CheckCircle2 size={16} className="automationSelected"/>}</div>
    {form.team[role].id&&activeRole!==role?<div className="automationChosen"><span className="automationAvatar">{form.team[role].name.slice(0,1).toUpperCase()}</span><span>{form.team[role].name}</span><button type="button" aria-label={'Cambiar '+TEAM_ROLES[role]} onClick={()=>{setActiveRole(role);setSearch('');setUsers([]);}}><Edit3 size={14}/></button></div>:<div className="automationPersonSearch">
     <div className="automationSearchInput"><Search size={15}/><input value={activeRole===role?search:''} placeholder="Buscar por nombre en Jira" onFocus={()=>{if(activeRole!==role){setActiveRole(role);setSearch('');setUsers([]);}}} onChange={e=>setSearch(e.target.value)} autoComplete="off" aria-label={'Buscar '+TEAM_ROLES[role]}/>{searching&&activeRole===role&&<span>...</span>}</div>
     {activeRole===role&&search.trim().length>=2&&<div className="automationOptions" role="listbox">{users.length?users.map(user=><button type="button" key={user.id} role="option" aria-selected={false} onClick={()=>chooseUser(role,user)}><span className="automationAvatar">{user.name[0]}</span>{user.name}<Check size={15}/></button>):<small>{searching?'Buscando en Jira...':'Sin coincidencias. Probá otro nombre.'}</small>}</div>}
    </div>}
    <small className="automationRoleHint">{index===0?'Informante (reporter) en Jira; requiere permiso para establecerlo.':index===1?'Asignado principal (assignee) en Jira.':'Supervisión como seguidor del ticket.'}</small>
    <label className="twGuardPhoneField"><span>Teléfono para llamadas (opcional)</span>
      <div className="twGuardPhoneInput"><input type="tel" inputMode="tel" placeholder="Ej.: 595981123456" aria-label={'Teléfono '+TEAM_ROLES[role]} value={form.supportPhones[role]} onChange={e=>setForm(f=>({...f,supportPhones:{...f.supportPhones,[role]:e.target.value.replace(/[^+0-9]/g,'')}}))}/>
      {form.supportPhones[role].replace(/\D/g,'').length>=10&&<a href={'tel:+'+form.supportPhones[role].replace(/\D/g,'')} className="twGuardDial" title={'Abrir marcador para '+TEAM_ROLES[role]}>Llamar</a>}</div>
    </label>
    <GuardiaContacts role={role}/>
   </div>)}
  </div>
  <p className="twGuardHelp">Cada tarjeta reúne el responsable de Jira, su teléfono y los contactos que reciben avisos. Los horarios y minutos de alerta se guardan en la sección superior. Las llamadas automáticas reales requieren un proveedor compatible.</p>



  {followups.some(item=>item.state==='review')&&<div className="automationPending"><div><strong>Enlaces de Nivel 2 sin confirmación de envío</strong><p>Revisá el chat de Nivel 2 antes de reintentar.</p><div className="twRetryLinks">{followups.filter(x=>x.state==='review').slice(0,5).map(item=><button key={item.jira_key} type="button" disabled={retrying} onClick={()=>void resendLevel2(item.jira_key)}>Revisar / reenviar {item.jira_key}</button>)}</div></div></div>}
  {followups.some(item=>item.overdue===1)&&<div className="automationPending" role="alert"><div><strong>Alertas de seguimiento Nivel 2</strong><p>{followups.filter(item=>item.overdue===1).slice(0,5).map(item=>item.jira_key+' · pendiente de confirmar').join(' · ')}</p><small>Para confirmar, Nivel 2 debe responder desde su número: CONFIRMO CW-123.</small><div className="twCallActions">{(['level1','level2'] as const).filter(role=>form.supportPhones[role]).map(role=><a key={role} className="smallButton" href={'tel:+'+form.supportPhones[role].replace(/\D/g,'')}>Llamar ahora: {TEAM_ROLES[role]}</a>)}</div></div></div>}
  {pendingNotices.length>0&&<div className="automationPending"><div><strong>Notificaciones Jira pendientes: {pendingNotices.length}</strong><p>{pendingNotices.slice(0,3).map(x=>`${x.key} · ${x.role}`).join(' · ')}. Revisá permisos de seguidores en Jira.</p></div><button type="button" disabled={retrying} onClick={()=>void retryNotices()}><RefreshCw size={14}/>{retrying?'Revisando...':'Reintentar avisos'}</button></div>}
  </div></section>
  </div>
  <div id="wtAvisos" className="wtSectionAnchor">
  <div className="wtAssistantSectionHead"><span className="wtAssistantStep">04</span><div><h3>Notificaciones al equipo</h3><p>Personalizá avisos para N1 y N2; el enlace de Jira se conserva.</p></div></div>
  <section className="twPersonalNotices" aria-label="Mensajes de aviso al equipo"><header><h3>Mensajes al equipo de soporte</h3><p>Personalizá qué recibe N1, N2 y el encargado cuando corresponda. Se envía una sola vez por destinatario y ticket, según los avisos habilitados en Equipo de soporte.</p></header><div className="twPersonalNoticeGrid">{roles.map(role=><label key={role}><strong>{TEAM_ROLES[role]}</strong><textarea rows={3} maxLength={400} placeholder={`Ejemplo: Soporte TI · Ticket {ticket} asignado a {nivel}. Revisar: {link}`} value={form.supportNotifications[role]} onChange={e=>setForm(f=>({...f,supportNotifications:{...f.supportNotifications,[role]:e.target.value}}))}/><small>Marcadores: {'{ticket}'} · {'{nivel}'} · {'{link}'}. Si dejás vacío, se envía solo el enlace de Jira.</small></label>)}</div><div className="twPersonalNoticePreview"><strong>Vista previa N1</strong><p>{noticePreview('level1')}</p><strong>Vista previa N2</strong><p>{noticePreview('level2')}</p></div><small>Los cambios se aplican a avisos futuros. El código no añade RUC, teléfono ni datos personales del cliente.</small></section>
  </div>
  <div id="wtMensajes" className="wtSectionAnchor">
  <div className="wtAssistantSectionHead"><span className="wtAssistantStep">05</span><div><h3>Mensajes y simulador</h3><p>Personalizá preguntas, textos y probá el recorrido antes de activarlo.</p></div></div>
  <div className="automationSectionHeader"><div><h3><MessageCircle size={17}/> Conversación con el cliente</h3><p>Vista previa del flujo actual. Los botones reales requieren Cloud API.</p></div><button type="button" className="automationEditButton" aria-expanded={editorOpen} onClick={()=>setEditorOpen(o=>!o)}><Edit3 size={15}/> {editorOpen?'Cerrar editor':'Editar mensajes'} <ChevronDown size={14}/></button></div>
  <div className="automationPreviewLayout">
   <div className="automationPreviewMenu"><strong>Opciones de soporte</strong><p>Elegí una opción para ver las preguntas que hará el asistente.</p>{AUTOMATION_SYSTEM_OPTIONS.map((option,index)=><button key={option} type="button" className={preview===index+1?'active':''} onClick={()=>setPreview(index+1 as 1|2|3|4)}><span>{index+1}</span>{option}<ChevronDown size={14}/></button>)}<small>El conector actual recibe respuestas escritas (1–4); no son botones reales. <a href="/cloud-api">Abrir editor de menú interactivo (simulador)</a>.</small></div>
   <div className="automationPhone"><div className="automationPhoneTop"><span className="automationPhoneAvatar"><MessageCircle size={19}/></span><div><strong>Soporte técnico</strong><small>Vista previa del asistente</small></div></div>
    <div className="automationPhoneScreen"><div className="automationBubble">Buenas tardes. {form.texts.welcome}<small>Bot</small></div><div className="automationBubble automationPollPreview">{form.texts.menu}<div className="automationPollOptions">{AUTOMATION_SYSTEM_OPTIONS.map((x,i)=><button type="button" key={x} className={preview===i+1?'active':''} onClick={()=>setPreview(i+1 as 1|2|3|4)}>{i+1}. {x}</button>)}</div><small>Vista previa del modo numerado actual</small></div>
     {preview!==0&&<><div className="automationBubble response">Seleccionó: {AUTOMATION_SYSTEM_OPTIONS[preview-1]}<small>Respuesta del modo actual</small></div><div className="automationBubble">{previewQuestions(AUTOMATION_SYSTEM_OPTIONS[preview-1])}<small>{form.flow.shortForm?(form.flow.confirmation?'Luego confirma los datos':'Luego crea el ticket sin LISTO si Jira está habilitado'):'Se solicitan los campos por separado'}</small></div></>}
    </div>
   </div>
  </div>
  {editorOpen&&<div className="automationEditor twPersonalEditor"><div className="automationSectionHeader"><div><h3>Personalizar preguntas y respuestas</h3><p>Desactivá preguntas opcionales y editá los textos por sistema. Sistema e inconveniente siempre se solicitan; el modo corto omite los datos adicionales.</p></div><button type="button" className="automationReset" onClick={()=>setForm(f=>({...f,texts:{...AUTOMATION_TEXT_DEFAULTS},questionEnabled:makeQuestionEnabled()}))}>Restablecer preguntas y textos</button></div>
   <p className="twPersonalHint">Las preguntas desactivadas se omiten en nuevas solicitudes del modo detallado. Los cambios no afectan formularios que ya estén en curso.</p>
   {groups.map((group,index)=><details className="twPersonalGroup" key={group} ><summary><strong>{group}</strong><small>{AUTOMATION_TEXT_FIELDS.filter(x=>x.group===group).length} mensajes · {AUTOMATION_TEXT_FIELDS.filter(x=>x.group===group&&OPTIONAL_QUESTIONS.has(x.key)&&form.questionEnabled[x.key]===false).length} desactivados</small></summary><div className="twPersonalFields">{AUTOMATION_TEXT_FIELDS.filter(x=>x.group===group).map(item=><div className="twPersonalField" key={item.key}><div className="twPersonalFieldHeading"><strong>{item.label}</strong>{OPTIONAL_QUESTIONS.has(item.key)?<label className="twPersonalToggle"><input type="checkbox" checked={form.questionEnabled[item.key]!==false} onChange={e=>setForm(f=>({...f,questionEnabled:{...f.questionEnabled,[item.key]:e.target.checked}}))}/>{form.questionEnabled[item.key]!==false?'Activado':'Desactivado'}</label>:<span className="twPersonalMandatory">Texto editable</span>}</div><textarea rows={2} maxLength={700} disabled={OPTIONAL_QUESTIONS.has(item.key)&&form.questionEnabled[item.key]===false} value={form.texts[item.key]} onChange={e=>setForm(f=>({...f,texts:{...f.texts,[item.key]:e.target.value}}))}/><small>{form.texts[item.key].length}/700 caracteres</small></div>)}</div></details>)}
  </div>}
  <details className="twFold twExtraFields"><summary><Edit3 size={16}/> Campos adicionales del formulario <small>{form.extraFields.filter(f=>f.enabled).length} activos · opcionales</small></summary><div className="twFoldContent">
   <p className="twGuardHelp">Agregá hasta cinco preguntas por sistema. El bot las hará en el modo detallado, después de los datos principales. En modo corto solo solicita sistema e inconveniente. La confirmación depende del interruptor anterior. Los cambios se guardan en SQLite.</p>
   <div className="twExtraNew"><label>Sistema<select value={extraSystem} onChange={e=>setExtraSystem(e.target.value as ExtraSystem)}>{EXTRA_SYSTEMS.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    <label>Nombre del dato<input value={newExtraLabel} maxLength={80} placeholder="Ej.: Sucursal o módulo" onChange={e=>setNewExtraLabel(e.target.value)}/></label>
    <button type="button" className="smallButton" disabled={form.extraFields.filter(f=>f.system===extraSystem).length>=5||newExtraLabel.trim().length<2} onClick={()=>{const id='f_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);setForm(v=>({...v,extraFields:[...v.extraFields,{id,system:extraSystem,label:newExtraLabel.trim(),required:false,enabled:true}]}));setNewExtraLabel('');}}>+ Agregar campo</button>
   </div>
   <div className="twExtraList">{form.extraFields.length===0?<p className="twGuardHelp">Todavía no hay preguntas adicionales. Los formularios normales seguirán funcionando.</p>:form.extraFields.map(x=><div className="twExtraRow" key={x.id}><div className="twExtraMeta"><strong>{x.label}</strong><small>{x.system}</small></div><label><input type="checkbox" checked={x.enabled} onChange={e=>setForm(v=>({...v,extraFields:v.extraFields.map(f=>f.id===x.id?{...f,enabled:e.target.checked}:f)}))}/> Activo</label><label><input type="checkbox" checked={x.required} onChange={e=>setForm(v=>({...v,extraFields:v.extraFields.map(f=>f.id===x.id?{...f,required:e.target.checked}:f)}))}/> Obligatorio</label><button type="button" className="twExtraRemove" aria-label={'Eliminar '+x.label} onClick={()=>setForm(v=>({...v,extraFields:v.extraFields.filter(f=>f.id!==x.id)}))}>Quitar</button></div>)}</div>
   <p className="twGuardHelp">Para aplicar los cambios, pulsá <strong>Guardar configuración</strong> al final de este panel. Las solicitudes en curso conservan sus preguntas originales.</p>
  </div></details>
  <details className="twFold"><summary><MessageCircle size={16}/> Simulador de atención <small>Recorrido interactivo sin enviar mensajes reales</small></summary><div className="twFoldContent"><SupportSimulator/></div></details>
  </div>
  {error&&<p className="automationError" role="alert">{error}</p>}{message&&<p className="automationSuccess" role="status"><CheckCircle2 size={16}/>{message}</p>}
  <div className="automationActions"><p>Funciona según los horarios y feriados habilitados en el centro de automatización. Los grupos no reciben respuestas automáticas.</p><button type="button" disabled={saving||loading||toggling} className="automationSave" onClick={()=>void save()}><Save size={16}/>{saving?'Guardando...':'Guardar configuración'}</button></div>
 </section>;
}
