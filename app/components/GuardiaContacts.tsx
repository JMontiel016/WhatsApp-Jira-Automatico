'use client';
import {useEffect,useState} from 'react';
import type {TeamRole} from '@/lib/jira-team';

type Person={id:number;phone:string;name:string;role:TeamRole;active:number;notify:number;call_enabled:number;followup:number;minutes:number|null};
type Contact={phone:string;displayPhone?:string;name:string;isGroup:boolean};
type StaffResult={items:Person[];connected?:boolean;reason?:string};

/** Una sola edición por responsable: Equipo de guardia.
 * Los nombres Jira y los contactos WhatsApp son identidades diferentes.
 * Nunca se muestra una agenda local sin confirmar la cuenta vinculada. */
export default function GuardiaContacts({role}:{role:TeamRole}){
 const [online,setOnline]=useState(false);
 const [people,setPeople]=useState<Person[]>([]);
 const [query,setQuery]=useState('');
 const [found,setFound]=useState<Contact[]>([]);
 const [busy,setBusy]=useState(false);
 const [looking,setLooking]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');

 async function load(){
  try{
   const r=await fetch('/api/automation/people?kind=staff',{cache:'no-store'});
   const data=await r.json() as StaffResult & {error?:string};
   if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);
   setOnline(data.connected!==false);
   setPeople((data.items||[]).filter(p=>p.role===role));
  }catch(e){setOnline(false);setPeople([]);setError(e instanceof Error?e.message:'No se pudieron consultar responsables');}
 }
 useEffect(()=>{
  // Se reconsulta la cuenta: el operador puede vincular WhatsApp sin recargar la pantalla.
  void load();
  const timer=setInterval(()=>void load(),16000);
  return()=>clearInterval(timer);
 },[role]);
 useEffect(()=>{
  if(!online||query.trim().length<2){setFound([]);setLooking(false);return;}
  const controller=new AbortController();
  setLooking(true);setError('');
  const timer=setTimeout(()=>{
   void fetch('/api/automation/people?q='+encodeURIComponent(query.trim().slice(0,80)),{cache:'no-store',signal:controller.signal})
    .then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error||'No se pudo buscar');return x as {items:Contact[]};})
    .then(v=>{if(!controller.signal.aborted)setFound((v.items||[]).filter(c=>!c.isGroup));})
    .catch(e=>{if(!controller.signal.aborted){setFound([]);setError(e instanceof Error?e.message:'Agenda no disponible');}})
    .finally(()=>{if(!controller.signal.aborted)setLooking(false)});
  },350);
  return()=>{clearTimeout(timer);controller.abort()};
 },[online,query]);
 async function update(person:Person,action:'activate'|'remove'){
  if(busy)return;
  if(action==='remove'&&!window.confirm('¿Quitar a '+person.name+' del equipo de guardia?'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const options:RequestInit=action==='remove'?{method:'DELETE'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'staff',id:person.id,phone:person.phone,name:person.name,role:person.role,active:!person.active,notify:!!person.notify,callEnabled:!!person.call_enabled,followup:!!person.followup,minutes:person.minutes})};
   const r=await fetch('/api/automation/people'+(action==='remove'?'?id='+person.id:''),options);
   const v=await r.json();if(!r.ok)throw Error(v.error||'No se pudo actualizar');
   await load();setNotice(action==='remove'?'Responsable retirado.':'Estado de guardia actualizado.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar');}
  finally{setBusy(false)}
 }
 async function updateFlags(person:Person, overrides:Partial<Person>){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  const next={...person,...overrides};
  try{
   const response=await fetch('/api/automation/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    kind:'staff',id:next.id,phone:next.phone,name:next.name,role:next.role,
    active:!!next.active,notify:!!next.notify,callEnabled:!!next.call_enabled,
    followup:!!next.followup,minutes:next.minutes
   })});
   const value=await response.json();if(!response.ok)throw Error(value.error||'No se pudo actualizar');
   await load();setNotice('Preferencias del responsable guardadas.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar');}
  finally{setBusy(false);}
 }
 async function add(contact:Contact){
  if(busy)return;
  const phone=String(contact.displayPhone||contact.phone).replace(/\D/g,'');
  if(!/^\d{8,16}$/.test(phone)){setError('Este contacto no tiene un teléfono utilizable.');return;}
  if(people.some(p=>p.phone===phone)){setError('Este contacto ya está asignado a este nivel.');return;}
  setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/automation/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'staff',phone,name:contact.name,role,active:true,notify:true,callEnabled:false,followup:true,minutes:null})});
   const v=await r.json();if(!r.ok)throw Error(v.error||'No se pudo asignar el contacto');
   setQuery('');setFound([]);await load();setNotice(contact.name+' agregado a la guardia.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo asignar el contacto')}
  finally{setBusy(false)}
 }
 return <div className="twGuardContactsCard" aria-label="Contactos WhatsApp de guardia">
  <div className="twGuardContactsTitle"><strong>Contactos de WhatsApp</strong><span>{people.filter(p=>p.active).length} activos</span></div>
  {!online?<p className="twGuardContactsOffline">Vinculá WhatsApp para buscar y asignar contactos reales. No se mostrará una agenda de otra sesión.</p>:<>
   {people.map(person=><div className="twGuardStaffRow" key={person.id}>
    <div><strong>{person.name}</strong><small>{person.phone}</small></div>
    <div className="twGuardStaffControls">
     <label title="Activar o desactivar este contacto en la guardia"><input type="checkbox" checked={!!person.active} disabled={busy} onChange={()=>void update(person,'activate')}/> Activo</label>
     <label title="Enviarle enlaces de tickets reales"><input type="checkbox" checked={!!person.notify} disabled={busy||!person.active} onChange={e=>void updateFlags(person,{notify:e.target.checked?1:0})}/> Avisos</label>
     <label title="Participar del seguimiento de pendientes"><input type="checkbox" checked={!!person.followup} disabled={busy||!person.active} onChange={e=>void updateFlags(person,{followup:e.target.checked?1:0})}/> Seguimiento</label>
     <button type="button" disabled={busy} onClick={()=>void update(person,'remove')} title="Quitar responsable">Quitar</button>
    </div>
   </div>)}
   <label className="twGuardSearchLabel">Agregar contacto de WhatsApp
    <input type="search" autoComplete="off" placeholder="Buscar nombre o número…" value={query} onChange={e=>setQuery(e.target.value)} />
   </label>
   {looking&&<small>Buscando en WhatsApp…</small>}
   {query.trim().length>=2&&!looking&&found.length===0&&!error&&<small>No hay coincidencias; probá otro nombre o número.</small>}
   {found.slice(0,8).map(c=><button className="twGuardContactOption" type="button" key={c.phone} disabled={busy} onClick={()=>void add(c)}><span>{c.name}<small>{c.displayPhone||c.phone}</small></span><span>Agregar</span></button>)}
  </>}
  {error&&<small className="twGuardContactError" role="alert">{error}</small>}
  {notice&&<small className="twGuardContactSuccess" role="status">{notice}</small>}
 </div>;
}
