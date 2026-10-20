'use client';
import {useMemo,useState} from 'react';
import {CheckCircle2,Clock3,RotateCcw,Send,Ticket,Users} from 'lucide-react';

type System='Futura100'|'Talento100'|'Consulta TI'|'Otro sistema';
type Field='ruc'|'name'|'ci'|'email'|'other'|'issue';
const options:System[]=['Futura100','Talento100','Consulta TI','Otro sistema'];
const names:Record<Field,string>={ruc:'RUC de la empresa',name:'Nombre completo',ci:'Cédula',email:'Correo electrónico',other:'Nombre del sistema',issue:'Inconveniente'};
const fields:Record<System,Field[]>={Futura100:['ruc','issue'],Talento100:['name','ci','email','issue'],'Consulta TI':['issue'],'Otro sistema':['other','email','issue']};
const valid=(field:Field,text:string)=>{
 const v=text.trim();
 if(field==='email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
 if(field==='ruc')return /^\d{4,12}-\d$/.test(v);
 if(field==='ci')return /^[0-9.]{4,20}$/.test(v);
 return v.length>=(field==='issue'?8:2);
};
type Line={who:'Cliente'|'Soporte TI'|'Sistema';text:string};
// 100% aislado: no usa fetch ni accede a SQLite, WhatsApp o Jira.
export default function SupportSimulator(){
 const [system,setSystem]=useState<System|null>(null),[idx,setIdx]=useState(0);
 const [data,setData]=useState<Partial<Record<Field,string>>>({}),[value,setValue]=useState('');
 const [step,setStep]=useState<'menu'|'fields'|'confirm'|'correctpick'|'correct'|'created'>('menu');
 const [correct,setCorrect]=useState<Field>('issue'),[kind,setKind]=useState<'issue'|'subtask'>('issue');
 const [number,setNumber]=useState(0),[alert,setAlert]=useState(false),[ack,setAck]=useState(false),[closed,setClosed]=useState(false),[error,setError]=useState('');
 const [lines,setLines]=useState<Line[]>([{who:'Soporte TI',text:'¡Hola! ¿En qué podemos ayudarle? Seleccione el sistema que necesita Soporte TI.'}]);
 const add=(...messages:Line[])=>setLines(prev=>[...prev,...messages]);
 const key=number?'CW-PRUEBA-'+number:'';
 const current=system?fields[system][idx]:undefined;
 const summary=useMemo(()=>[system&&'Sistema: '+system,...(system?fields[system].map(k=>data[k]&&names[k]+': '+data[k]):[])].filter(Boolean).join('\n'),[system,data]);
 function reset(){setSystem(null);setIdx(0);setData({});setValue('');setStep('menu');setCorrect('issue');setKind('issue');setNumber(0);setAlert(false);setAck(false);setClosed(false);setError('');setLines([{who:'Soporte TI',text:'¡Hola! ¿En qué podemos ayudarle? Seleccione el sistema que necesita Soporte TI.'}]);}
 function choose(v:System){setSystem(v);setStep('fields');setData({});setIdx(0);setError('');add({who:'Cliente',text:v},{who:'Soporte TI',text:'Por favor, indique: '+names[fields[v][0]]});}
 function submit(){if(!system||!current)return;const text=value.trim();if(!valid(current,text)){setError('Revise el dato introducido: '+names[current]);return;}
  setError('');setValue('');const next={...data,[current]:text};setData(next);
  add({who:'Cliente',text},{who:'Soporte TI',text:fields[system][idx+1]?'Indique: '+names[fields[system][idx+1]]:'Revise el resumen de su solicitud y confirme o corrija sus datos.'});
  if(idx+1===fields[system].length)setStep('confirm');else setIdx(idx+1);
 }
 function chooseCorrection(f:Field){setCorrect(f);setValue(data[f]||'');setStep('correct');setError('');add({who:'Cliente',text:'Corregir '+names[f]},{who:'Soporte TI',text:'Introduzca el nuevo valor: '+names[f]});}
 function saveCorrection(){const text=value.trim();if(!valid(correct,text)){setError('Dato inválido. Verifique el formato.');return;}setData(d=>({...d,[correct]:text}));setStep('confirm');setValue('');setError('');add({who:'Cliente',text},{who:'Soporte TI',text:'Dato actualizado. Verifique el resumen nuevamente.'});}
 function confirm(){const next=number+1;setNumber(next);setStep('created');setAck(false);setAlert(false);setClosed(false);add({who:'Cliente',text:'Sí, confirmar solicitud'},{who:'Sistema',text:(kind==='issue'?'Ticket':'Subtarea')+' CW-PRUEBA-'+next+' generado SOLO en simulación. Nivel 2 recibió únicamente el enlace de prueba. Inicia seguimiento de 30 minutos.'});}
 function reopen(today:boolean){setIdx(0);setValue('');setError('');setAlert(false);setAck(false);setClosed(false);if(today){setKind('subtask');setStep('fields');setIdx(0);setData(d=>({...d,issue:''}));setSystem(system||'Consulta TI');const target=fields[system||'Consulta TI'];setIdx(target.indexOf('issue'));add({who:'Cliente',text:'Necesito otro soporte'},{who:'Soporte TI',text:'¡Hola! ¿En qué podemos ayudarle? Por favor, cuéntenos qué inconveniente está presentando. Nuestro equipo de Soporte TI estará asistiendo su solicitud.'});}else{setSystem(null);setData({});setKind('issue');setStep('menu');add({who:'Cliente',text:'Nueva consulta al día siguiente'},{who:'Soporte TI',text:'Bienvenido al servicio de Soporte TI. Seleccione el sistema para una nueva solicitud.'});}}
 return <section className="twSim" aria-label="Simulador aislado de atención"><div className="twSimHeader"><strong>Simulador de atención</strong><span>PRUEBA AISLADA · Sin envíos reales</span><button type="button" onClick={reset}><RotateCcw size={14}/> Reiniciar</button></div>
 <div className="twSimChat">{lines.map((l,i)=><div key={i} className={'twSimMessage '+(l.who==='Cliente'?'mine':'')}><small>{l.who}</small><span>{l.text}</span></div>)}</div>
 <div className="twSimControls">{step==='menu'&&<div className="twSimChoices">{options.map((x,i)=><button type="button" key={x} onClick={()=>choose(x)}><b>{i+1}</b> {x}</button>)}</div>}
 {step==='fields'&&current&&<div className="twSimEntry"><label>{names[current]}{current==='issue'?<textarea rows={2} value={value} onChange={e=>setValue(e.target.value)}/>:<input value={value} onChange={e=>setValue(e.target.value)}/>}</label><button type="button" onClick={submit}><Send size={14}/> Responder</button></div>}
 {step==='confirm'&&<><pre className="twSimSummary">{summary}</pre><div className="twSimChoices"><button type="button" onClick={confirm}><CheckCircle2 size={15}/> Sí, confirmar solicitud</button><button type="button" onClick={()=>setStep('correctpick')}>Corregir mis datos</button></div></>}
 {step==='correctpick'&&system&&<div className="twSimChoices">{fields[system].map(k=><button type="button" key={k} onClick={()=>chooseCorrection(k)}>{names[k]}</button>)}</div>}
 {step==='correct'&&<div className="twSimEntry"><label>Nuevo valor: {names[correct]}<input value={value} onChange={e=>setValue(e.target.value)}/></label><button type="button" onClick={saveCorrection}>Guardar corrección</button></div>}
 {step==='created'&&<div className="twSimResult"><strong><Ticket size={16}/> {kind==='subtask'?'Subtarea':'Ticket'} {key}</strong><span>Enlace simulado enviado a Nivel 2; sin datos personales.</span><div className="twSimChoices"><button type="button" disabled={ack} onClick={()=>{setAck(true);setAlert(false);add({who:'Sistema',text:'Nivel 2 confirmó atención. Se detuvo el seguimiento.'});}}><Users size={14}/> Confirmar Nivel 2</button><button type="button" disabled={ack||alert} onClick={()=>{setAlert(true);add({who:'Sistema',text:'ALERTA simulada: pasaron 30 minutos sin confirmación; corresponde llamar a Nivel 2.'});}}><Clock3 size={14}/> Simular 30 minutos</button><button type="button" onClick={()=>{setClosed(true);add({who:'Sistema',text:'Ticket finalizado en Jira (simulación).'});}}>Simular cierre Jira</button></div>{alert&&<p role="alert">Alerta: llamar a Nivel 2 por {key}</p>}{closed&&<div className="twSimChoices"><button type="button" onClick={()=>reopen(true)}>Cliente vuelve hoy: subtarea</button><button type="button" onClick={()=>reopen(false)}>Cliente vuelve otro día: nuevo ticket</button></div>}</div>}
 {error&&<p role="alert" className="twSimError">{error}</p>}</div>
 </section>;
}
