'use client';
import {useEffect,useState} from 'react';

type Timing={inside:boolean;outside:boolean;weekends:boolean;holidays:boolean;calls:boolean;minutes:number;callStart:string;callEnd:string;maxAttempts:number;voice:string};

/** Ajuste del horario laboral compartido con el Centro de automatización. */
export default function GuardiaHorario(){
 const [timing,setTiming]=useState<Timing|null>(null);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{let alive=true;
  void fetch('/api/automation/control',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('No se pudieron consultar los horarios');return r.json() as Promise<Timing>;}).then(data=>{if(alive)setTiming(data);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Error cargando horario');});
  return()=>{alive=false};
 },[]);
 async function update(value:boolean){
  if(!timing||saving)return;
  setSaving(true);setError('');setNotice('');
  try{
   // Recargar antes de guardar: otras opciones pudieron cambiar en otra pestaña.
   const latest=await fetch('/api/automation/control',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('No se pudo leer el horario actual');return r.json() as Promise<Timing>});
   const r=await fetch('/api/automation/control',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...latest,inside:value})});
   const res=await r.json();if(!r.ok)throw Error(res.error||'No se pudo guardar');
   setTiming({...latest,inside:value});setNotice(value?'Asistente permitido en horario laboral.':'Asistente desactivado en horario laboral.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar')}
  finally{setSaving(false)}
 }
 return <div className="twGuardHoursRow">
  <div><strong>Asistente durante el horario laboral</strong><small>Apagado: no envía menús automáticos de lunes a viernes, 08:00–18:00. Los avisos internos de guardia se controlan por responsable.</small></div>
  <label><input type="checkbox" disabled={!timing||saving} checked={!!timing?.inside} onChange={e=>void update(e.target.checked)}/>{timing?.inside?'Activado':'Desactivado'}</label>
  {error&&<small className="twGuardContactError" role="alert">{error}</small>}{notice&&<small className="twGuardContactSuccess" role="status">{notice}</small>}
 </div>;
}
