'use client';
import {useState} from 'react';
import {MessageCircle,Phone,Send,RefreshCw,ShieldCheck} from 'lucide-react';

type Event={id:number;kind:'incoming'|'outgoing'|'call';text:string;time:string};
const seed:Event[]=[{id:1,kind:'incoming',text:'Hola, necesito soporte.',time:'20:00'}];
export default function SimulationPhoneLab(){
 const [mode,setMode]=useState<'messages'|'calls'>('messages');
 const [recipient,setRecipient]=useState('595981000000');
 const [text,setText]=useState('Hola, le atendemos desde Soporte TI. ¿En qué sistema necesitás ayuda?');
 const [ticket,setTicket]=useState('CW-SIM-301');
 const [events,setEvents]=useState<Event[]>(seed);
 const [result,setResult]=useState('');
 const clock=()=>new Intl.DateTimeFormat('es-PY',{hour:'2-digit',minute:'2-digit',timeZone:'America/Asuncion'}).format(new Date());
 const simulateMessage=()=>{if(!text.trim()){setResult('Escribí un mensaje de prueba.');return;}setEvents(old=>[...old,{id:Date.now(),kind:'outgoing',text:text.trim(),time:clock()}]);setResult('Mensaje simulado. No se contactó ningún número.');};
 const simulateCall=()=>{
  const voice=`Hola, le estamos contactando de Soporte TI. Tiene un ticket pendiente de atención, número ${ticket||'CW-SIM-301'}. Por favor, revise el caso y actualice su estado a En curso. Muchas gracias.`;
  setEvents(old=>[...old,{id:Date.now(),kind:'call',text:voice,time:clock()}]);setResult('Llamada simulada. Se generó la locución local; no se usó el teléfono ni un proveedor.');
 };
 return <div className="twSimulationLab" aria-label="Simular mensajes y llamadas sin servicios reales">
  <div className="twLabTop"><div className="twLabTitle"><ShieldCheck size={18}/><span><strong>Laboratorio seguro</strong><small>Todo ocurre en este navegador. No se envían mensajes ni se registran tickets.</small></span></div><button type="button" className="twLabReset" onClick={()=>{setEvents(seed);setResult('');}}> <RefreshCw size={14}/> Reiniciar</button></div>
  <div className="twLabTabs" role="group" aria-label="Tipo de simulación"><button type="button" className={mode==='messages'?'selected':''} onClick={()=>setMode('messages')}><MessageCircle size={16}/> Mensajes</button><button type="button" className={mode==='calls'?'selected':''} onClick={()=>setMode('calls')}><Phone size={16}/> Llamadas</button></div>
  <div className="twLabLayout"><div className="twLabForm">
   <label>Teléfono ficticio<input inputMode="tel" value={recipient} maxLength={20} onChange={e=>setRecipient(e.target.value)}/></label>
   {mode==='messages'?<><label>Mensaje de prueba<textarea rows={4} value={text} onChange={e=>setText(e.target.value)}/></label><button type="button" className="twLabSubmit" onClick={simulateMessage}><Send size={15}/> Enviar mensaje simulado</button></>:<><label>Ticket ficticio<input value={ticket} maxLength={32} onChange={e=>setTicket(e.target.value)}/></label><p className="twLabInfo">Prueba una alerta y una locución. Las llamadas automáticas reales siguen bloqueadas hasta contar con una integración compatible.</p><button type="button" className="twLabSubmit" onClick={simulateCall}><Phone size={15}/> Simular llamada</button></>}
   {result&&<p className="twLabResult" role="status">{result}</p>}
  </div><div className="twLabPhone"><div className="twLabPhoneTop"><span className="twLabPhoneAvatar"><MessageCircle size={17}/></span><div><strong>Soporte TI · DEMO</strong><small>{recipient||'Número ficticio'} · sin conexión real</small></div></div><div className="twLabPhoneScreen">{events.map(e=><div className={'twLabBubble '+e.kind} key={e.id}>{e.kind==='call'&&<span className="twLabCallLabel"><Phone size={13}/> Locución simulada</span>}{e.text}<small>{e.time}</small></div>)}</div></div></div>
 </div>;
}
