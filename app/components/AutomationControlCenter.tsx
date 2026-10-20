'use client';

import {useEffect, useState} from 'react';
import {Clock3, ShieldOff, Save, Search, Info, CalendarClock, Sun, Moon} from 'lucide-react';

type Timing={
 inside:boolean;outside:boolean;weekends:boolean;holidays:boolean;
 calls:boolean;minutes:number;callStart:string;callEnd:string;maxAttempts:number;voice:string;
 telephonyNote?:string;
};
type Contact={phone:string;name:string;displayPhone?:string;isGroup:boolean;excluded?:boolean;override?:'default'|'enabled'|'disabled'};
type Excluded={phone:string;name?:string;excluded:number;override:string};
const timingDefaults:Timing={
 inside:false,outside:true,weekends:true,holidays:true,calls:false,minutes:30,
 callStart:'08:00',callEnd:'18:00',maxAttempts:1,
 voice:'Hola, le estamos contactando de Soporte TI. Tiene un ticket pendiente, número {ticket}.'
};
const days: Array<[keyof Timing,string,string]> = [
 ['inside','Horario laboral','Lunes a viernes, 08:00–18:00'],
 ['outside','Fuera de horario','Después de las 18:00 y antes de las 08:00'],
 ['weekends','Fines de semana','Sábados y domingos'],
 ['holidays','Feriados','Feriados de Paraguay'],
];
async function api<T>(url:string, options?:RequestInit):Promise<T>{
 const response=await fetch(url,{cache:'no-store',...options});
 const data=await response.json().catch(()=>({error:'Respuesta inválida'}));
 if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
 return data as T;
}

export default function AutomationControlCenter({legacyExcludedPhones,onLegacyExcludedChange}:{legacyExcludedPhones:string;onLegacyExcludedChange:(value:string)=>void}){
 const [timing,setTiming]=useState<Timing>(timingDefaults);
 const [loaded,setLoaded]=useState(false);
 const [clockLoaded,setClockLoaded]=useState(false);
 const [workHours,setWorkHours]=useState({start:'08:00',end:'18:00'});
 const [saving,setSaving]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [contactsError,setContactsError]=useState('');
 const [excluded,setExcluded]=useState<Excluded[]>([]);
 const [search,setSearch]=useState('');
 const [found,setFound]=useState<Contact[]>([]);
 const [looking,setLooking]=useState(false);
 const [working,setWorking]=useState('');
 useEffect(()=>{
  let active=true;
  void api<Timing>('/api/automation/control').then(value=>{if(active)setTiming(value);})
    .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo leer el horario');})
    .finally(()=>{if(active)setLoaded(true);});
  void api<Record<string,string>>('/api/settings').then(settings=>{if(active)setWorkHours({start:settings.start||'08:00',end:settings.end||'18:00'});})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo leer el horario laboral');})
   .finally(()=>{if(active)setClockLoaded(true);});
  void api<{items:Excluded[]}>('/api/automation/people?kind=excluded')
    .then(v=>{if(active)setExcluded(v.items||[]);})
    .catch(e=>{if(active)setContactsError(e instanceof Error?e.message:'No disponible');});
  return()=>{active=false};
 },[]);
 useEffect(()=>{
  if(search.trim().length<2){setFound([]);setLooking(false);return;}
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   setLooking(true);setContactsError('');
   void api<{items:Contact[]}>('/api/automation/people?q='+encodeURIComponent(search.trim().slice(0,80)),{signal:controller.signal})
     .then(v=>{if(!controller.signal.aborted)setFound((v.items||[]).filter(c=>!c.isGroup));})
     .catch(e=>{if(!controller.signal.aborted){setFound([]);setContactsError(e instanceof Error?e.message:'Agenda no disponible');}})
     .finally(()=>{if(!controller.signal.aborted)setLooking(false);});
  },350);
  return()=>{clearTimeout(timer);controller.abort()};
 },[search]);
 async function saveTiming(){
  setNotice('');setError('');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(workHours.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(workHours.end)||workHours.start>=workHours.end){
   setError('El horario laboral debe comenzar antes de terminar. Ejemplo: 08:00 a 18:00.');return;
  }
  setSaving(true);
  try{
   // Actualizar las dos configuraciones originales; ninguna ruta modifica la sesión de WhatsApp.
   await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(workHours)});
   const current=await api<Timing>('/api/automation/control');
   const patch={inside:timing.inside,outside:timing.outside,weekends:timing.weekends,holidays:timing.holidays,minutes:timing.minutes};
   const combined={...current,...patch};
   await api('/api/automation/control',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(combined)});
   const saved=await api<Record<string,string>>('/api/settings');
   setWorkHours({start:saved.start||workHours.start,end:saved.end||workHours.end});
   setTiming(combined);setNotice('Horario laboral, días y reglas guardados correctamente.');
  }catch(e){setError((e instanceof Error?e.message:'No se pudieron guardar los horarios')+'. Verificá los valores al volver a cargar antes de repetir.');}
  finally{setSaving(false);}
 }
 async function updateClient(c:Contact,exclude:boolean,override:Contact['override']='default'){
  if(working)return;
  setWorking(c.phone);setContactsError('');setNotice('');
  try{
   await api('/api/automation/people',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'client',phone:c.phone,excluded:exclude,override})});
   const now=await api<{items:Excluded[]}>('/api/automation/people?kind=excluded');
   setExcluded(now.items||[]);
   setFound(v=>v.map(x=>x.phone===c.phone?{...x,excluded:exclude,override}:x));
   setNotice('Preferencia guardada para '+c.name+'.');
  }catch(e){setContactsError(e instanceof Error?e.message:'No se pudo actualizar el cliente');}
  finally{setWorking('');}
 }
 return <section className="twControlCenter twSimpleControl" aria-label="Horarios y clientes sin automatización">
  <header className="twSimpleHeader">
   <Clock3 size={18}/><div><h3>Horarios de atención</h3><p>Definí cuándo responde el asistente. El interruptor principal está arriba.</p></div>
  </header>
  <div className="wtHoursSummary"><CalendarClock size={16}/><strong>Lunes a viernes · {workHours.start}–{workHours.end}</strong><small>Zona horaria: Paraguay. El asistente responde solo en los períodos marcados abajo y cuando está activado.</small></div>
  <fieldset className="wtWorkTimeFields" disabled={!clockLoaded||saving}>
   <legend>Horario laboral</legend>
   <label><Sun size={16}/> Desde<input type="time" aria-label="Inicio del horario laboral" value={workHours.start} onChange={e=>setWorkHours(v=>({...v,start:e.target.value}))}/></label>
   <label><Moon size={16}/> Hasta<input type="time" aria-label="Fin del horario laboral" value={workHours.end} onChange={e=>setWorkHours(v=>({...v,end:e.target.value}))}/></label>
  </fieldset>
  <strong className="wtHoursToggleHeading">¿En qué momentos puede responder el asistente?</strong>
  <div className="twSimpleHours wtHoursChoices">
   {days.map(([key,title,description])=><label className="twSimpleToggle" key={key}>
    <span><strong>{title}</strong><small>{key==='inside'?`Lunes a viernes, ${workHours.start}–${workHours.end}`:key==='outside'?`Lunes a viernes, antes de ${workHours.start} y después de ${workHours.end}`:description}</small></span>
    <input type="checkbox" aria-label={title} checked={Boolean(timing[key])} disabled={!loaded||saving} onChange={e=>setTiming(v=>({...v,[key]:e.target.checked}))}/>
   </label>)}
  </div>
  <div className="twSimpleToolbar"><label>Alerta de Nivel 2 (minutos)<input type="number" min={5} max={720} value={timing.minutes} disabled={!loaded||saving} onChange={e=>setTiming(v=>({...v,minutes:Number(e.target.value)}))}/></label>
   <button type="button" disabled={!loaded||!clockLoaded||saving} onClick={()=>void saveTiming()}><Save size={15}/>{saving?'Guardando…':'Guardar horarios y días'}</button>
  </div>
  <details className="twSimpleExclusion wtExcludedFold">
   <summary className="twSimpleHeader"><ShieldOff size={18}/><div><h3>Clientes sin automatización</h3><p>Gestionar excepciones de WhatsApp · Los grupos siempre están excluidos</p></div><span className="wtExcludedCounter">{excluded.filter(x=>x.excluded===1||x.override!=='default').length} reglas</span></summary>
   <div className="wtExcludedBody">
   <label className="twSimpleSearch"><Search size={15}/><input type="search" placeholder="Buscar un contacto por nombre o teléfono" autoComplete="off" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   {looking&&<small>Buscando contactos…</small>}
   {found.length>0&&<div className="twSimpleResults">{found.slice(0,8).map(c=><div key={c.phone} className="twSimpleResult"><span><strong>{c.name}</strong><small>{c.displayPhone||c.phone}</small></span><button type="button" disabled={!!working} onClick={()=>void updateClient(c,!c.excluded,c.override||'default')}>{c.excluded?'Permitir bot':'Excluir del bot'}</button></div>)}</div>}
   {search.trim().length>=2&&!looking&&!found.length&&!contactsError&&<small>Sin coincidencias.</small>}
   {excluded.filter(x=>x.excluded===1||x.override!=='default').length>0&&<div className="twSimpleExclusionList"><strong>Exclusiones guardadas</strong>{excluded.filter(x=>x.excluded===1||x.override!=='default').map(c=><div key={c.phone} className="twSimpleResult"><span><strong>{c.name||c.phone}</strong><small>{c.excluded?'Excluido del bot':'Preferencia personalizada'}</small></span><button type="button" disabled={!!working} onClick={()=>void updateClient({phone:c.phone,name:c.name||c.phone,isGroup:false},false,'default')}>Restablecer</button></div>)}</div>}
   <label className="twSimpleManualExclusions"><strong>Excluir por número manualmente</strong><small>Una línea por número con código de país. Guardá con “Guardar configuración” al pie de este panel.</small><textarea rows={2} value={legacyExcludedPhones} onChange={e=>onLegacyExcludedChange(e.target.value)} placeholder={"595981123456\n595982234567"}/></label>
   {contactsError&&<p className="twSimpleInfo" role="status"><Info size={14}/> Agenda no disponible: {contactsError}. La conexión WhatsApp debe estar lista para buscar contactos nuevos.</p>}
   </div>
  </details>
  {error&&<p className="automationError" role="alert">{error}</p>}
  {notice&&<p className="automationSuccess" role="status">{notice}</p>}
 </section>;
}
