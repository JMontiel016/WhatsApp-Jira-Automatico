'use client';
import {useState} from 'react';

type Config={exclude:boolean;groupsBlocked:boolean;outOfHours:boolean;notifyN2:boolean;callN2:boolean;attended:boolean;providerCompatible:boolean};
type Result={scenario:string;incoming:string;applied:string;action:string;ticket:string;notice:string;call:string;expected:string;observed:string;ok:boolean};
const tests=[
 '1. Cliente individual, 20:00', '2. Cliente excluido', '3. Grupo de WhatsApp', '4. Derivación a Nivel 2',
 '5. Llamada pendiente a Nivel 2','6. Atención a los 10 minutos','7. Finalizado: mismo día','8. Finalizado: día siguiente'
];
const baseline:Config={exclude:true,groupsBlocked:true,outOfHours:true,notifyN2:true,callN2:true,attended:true,providerCompatible:false};
function simulate(n:number,c:Config):Result {
 const scenario=tests[n];let incoming='Hola';let applied='';let action='';let ticket='—';let notice='Omitida';let call='No solicitada';let expected='';let observed='';let ok=true;
 if(n===0){applied='Individual, no excluido, 20:00, fuera de horario';action=c.outOfHours?'Saludo → Futura100 → RUC → inconveniente → resumen → confirmación':'No se activa por horario';ticket=c.outOfHours?'CW-SIM-301 · Nivel 1':'—';expected='Formulario y ticket simulado Nivel 1';observed=c.outOfHours?expected:'Automatización deshabilitada fuera del horario';ok=c.outOfHours;}
 if(n===1){applied='Contacto excluido: '+(c.exclude?'Sí':'No');action=c.exclude?'Registrar mensaje sin respuesta automática':'Saludo y formulario permitidos';expected='Sin respuesta mientras está excluido; tras quitar exclusión, formulario normal';observed=c.exclude?'Sin respuesta automática':'Formulario habilitado tras quitar exclusión';ok=true;}
 if(n===2){applied='Chat grupal, bloqueo de seguridad obligatorio';action='Conservar conversación; ninguna respuesta automática';expected='Sin menú ni ticket automático';observed='Sin menú ni ticket automático';ok=c.groupsBlocked;}
 if(n===3){incoming='Derivar CW-SIM-301 a Nivel 2';applied='Nivel 2 · recibir enlace: '+(c.notifyN2?'Sí':'No');ticket='CW-SIM-301 · Nivel 2 · Pendiente';action='Actualizar nivel; iniciar seguimiento 30 minutos';notice=c.notifyN2?'https://jira.ejemplo/browse/CW-SIM-301':'Omitida por preferencia';expected='Solo URL si el responsable acepta mensajes';observed=notice;ok=c.notifyN2?notice.startsWith('https://'):notice==='Omitida por preferencia';}
 if(n===4){incoming='CW-SIM-301 pendiente 30 minutos';applied='Nivel 2 · llamada: '+(c.callN2?'Sí':'No')+' · proveedor compatible: '+(c.providerCompatible?'Sí':'No');ticket='CW-SIM-301 · Pendiente';action='Consultar estado antes de escalar; generar alerta';call=c.callN2?(c.providerCompatible?'Solicitud de llamada simulada (sin conexión real)':'Pendiente de integración oficial; no se llama'):'Omitida; alerta interna';expected='Solicitud únicamente con proveedor apto y permiso; de otro modo alerta';observed=call+'\nLocución simulada: Hola, le estamos contactando de Soporte TI. Tiene un ticket pendiente de atención, número CW-SIM-301. Por favor, revise el caso y actualice su estado a En curso. Muchas gracias.';ok=true;}
 if(n===5){incoming='CW-SIM-302 · cambio a En curso a los 10 minutos';applied='Jira informa En curso: '+(c.attended?'Sí':'No');ticket='CW-SIM-302';action=c.attended?'Cancelar seguimiento y llamada':'Conservar seguimiento hasta verificar atención';call=c.attended?'Cancelada':'Pendiente de revisión';expected='Cancelar llamada cuando se confirma En curso';observed=action;ok=c.attended;}
 if(n===6){incoming='Cliente escribe el mismo día del cierre';applied='CW-SIM-303 cerrado hoy';action='Saludo habitual → nuevo inconveniente → imagen opcional → resumen → confirmar';ticket='CW-SIM-303-1 · Subtarea simulada';notice=c.notifyN2?'Solo URL de subtarea':'Omitida';expected='Subtarea, sin mencionar subtarea al cliente';observed='Subtarea simulada tras confirmación';ok=true;}
 if(n===7){incoming='Cliente escribe al día siguiente del cierre';applied='Cierre del día anterior';action='Saludo → menú 1–4 → todos los campos separados → resumen → confirmar';ticket='CW-SIM-304 · Ticket nuevo';expected='Nuevo ticket, no subtarea';observed='Ticket simulado nuevo';ok=true;}
 return {scenario,incoming,applied,action,ticket,notice,call,expected,observed,ok};
}
export default function AutomationScenarioSuite(){
 const [settings,setSettings]=useState<Config>(baseline),[results,setResults]=useState<Result[]>([]);
 const options:Array<{key:keyof Config;label:string}>=[{key:'exclude',label:'Cliente 2 excluido'}, {key:'outOfHours',label:'Atender fuera del horario'}, {key:'notifyN2',label:'Nivel 2 recibe enlaces'}, {key:'callN2',label:'Nivel 2 acepta llamadas'}, {key:'attended',label:'Ticket 6 pasó a En curso'}, {key:'providerCompatible',label:'Proveedor compatible (solo simulación)'}];
 const run=(n:number)=>setResults(old=>{const next=simulate(n,settings);return [...old.filter(x=>x.scenario!==next.scenario),next].sort((a,b)=>tests.indexOf(a.scenario)-tests.indexOf(b.scenario));});
 return <section className="twScenarioSuite" aria-label="Simulacro de ocho casos sin servicios externos">
  <h3>Simulacro integral — 8 pruebas aisladas</h3><p>Todos los tickets «CW-SIM» y enlaces «jira.ejemplo» son ficticios. Esta pantalla no usa fetch, no llama al conector ni guarda registros en SQLite.</p>
  <div className="twScenarioSettings">{options.map(o=><label key={o.key}><input type="checkbox" checked={settings[o.key]} onChange={e=>setSettings(old=>({...old,[o.key]:e.target.checked}))}/>{o.label}</label>)}</div>
  <p>Los grupos permanecen bloqueados, incluso durante el simulacro. Desactivarlos no es una opción.</p>
  <div className="twScenarioActions"><button type="button" onClick={()=>setResults(tests.map((_,i)=>simulate(i,settings)))}>Ejecutar las 8 pruebas</button><button type="button" onClick={()=>{setResults([]);setSettings(baseline);}}>Reiniciar configuraciones</button><button type="button" onClick={()=>setResults([])}>Limpiar resultados</button></div>
  <div className="twScenarioCases">{tests.map((name,i)=><button type="button" key={name} onClick={()=>run(i)}>{name} · Probar</button>)}</div>
  <p>{results.length} de 8 escenarios ejecutados. {results.filter(x=>x.ok).length} con resultado esperado en la configuración seleccionada.</p>
  {results.map(r=><article key={r.scenario} className="twScenarioResult"><h4>{r.scenario} — {r.ok?'Correcto':'Error'}</h4><dl>{([['Mensaje recibido',r.incoming],['Configuraciones aplicadas',r.applied],['Acción realizada',r.action],['Ticket o subtarea',r.ticket],['Notificación',r.notice],['Llamada',r.call],['Resultado esperado',r.expected],['Resultado observado',r.observed]] as Array<[string,string]>).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></article>)}
 </section>;
}
