'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
import {DEFAULT_CONFIG,type CloudConfig,type CloudState,type CloudEvent,type OutputMessage,advance,newState} from '@/lib/cloud-menu';
import styles from './page.module.css';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
export default function CloudMenuEditor(){
 const [adminKey,setAdminKey]=useState('');
 const [config,setConfig]=useState<CloudConfig>(()=>clone(DEFAULT_CONFIG));
 const [loaded,setLoaded]=useState(false);
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [step,setStep]=useState<'menu'|'campos'|'simulador'>('menu');
 const [branch,setBranch]=useState(0);
 const [state,setState]=useState<CloudState>(()=>newState());
 const [history,setHistory]=useState<Array<{who:'bot'|'cliente';text:string}>>([]);
 const [answer,setAnswer]=useState('');
 const [enabled,setEnabled]=useState(false);
 const [recipient,setRecipient]=useState('');
 const [optIn,setOptIn]=useState(false);
 const [verified,setVerified]=useState(false);
 const opt=config.options[branch];
 function update<K extends keyof CloudConfig>(key:K,value:CloudConfig[K]){setConfig(c=>({...c,[key]:value}));}
 function changeOption(i:number,k:'title',v:string){setConfig(c=>({...c,options:c.options.map((o,j)=>i===j?{...o,[k]:v}:o)}));}
 function changeField(i:number,j:number,k:'id'|'label',v:string){setConfig(c=>({...c,options:c.options.map((o,n)=>n===i?{...o,fields:o.fields.map((f,m)=>m===j?{...f,[k]:v}:f)}:o)}));}
 function addField(){setConfig(c=>({...c,options:c.options.map((o,i)=>i!==branch?o:{...o,fields:[...o.fields,{id:'campo_'+String(o.fields.length+1),label:'Nueva pregunta'}]})}));}
 function removeField(j:number){if(opt.fields[j].id==='inconveniente')return;setConfig(c=>({...c,options:c.options.map((o,i)=>i===branch?{...o,fields:o.fields.filter((_,k)=>k!==j)}:o)}));}
 async function api(method:string,url:string,payload?:unknown){
  const res=await fetch(url,{method,headers:{'Content-Type':'application/json','x-ticketbridge-admin-token':adminKey},body:payload===undefined?undefined:JSON.stringify(payload),cache:'no-store'});
  const data=await res.json();if(!res.ok)throw new Error(String(data.error||'Error de conexión'));
  return data;
 }
 async function load(){setBusy(true);setNotice('');try{const d=await api('GET','/api/cloud-api/editor');setConfig(d.config);setLoaded(true);setEnabled(d.enabled);setVerified(d.eligibilityVerified);setNotice('Configuración cargada de TicketBridge.');}
  catch(e){setNotice(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 async function startWithTemplate(){setBusy(true);setNotice('');try{const r=await api('POST','/api/cloud-api/start',{phone:recipient,optInConfirmed:optIn});setNotice(r.templateSent?'Plantilla enviada. El cliente debe tocar Iniciar soporte para recibir el menú.':'No se envió ningún mensaje.');}catch(e){setNotice(e instanceof Error?e.message:'No se pudo iniciar');}finally{setBusy(false);}}
 async function save(){setBusy(true);setNotice('');try{await api('PUT','/api/cloud-api/editor',config);setNotice('Configuración guardada localmente en SQLite. Esto NO envía mensajes.');}catch(e){setNotice(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 async function simulate(event:CloudEvent){
  setBusy(true);setNotice('');
  try{
   // Por defecto probar localmente sin enviar datos al servidor ni a Meta.
   const r=advance(config,state,event);setState(r.state);
   const user=event.kind==='list_reply'?config.options.find(o=>o.id===event.id)?.title:
     event.kind==='button_reply'?(event.id==='ticket_confirmar'?'Confirmar':'Corregir'):event.kind==='text'?event.text:event.kind==='image'?'Imagen':'Iniciar';
   setHistory(h=>[...h,{who:'cliente',text:user||'Inicio'},...r.messages.map(m=>({who:'bot' as const,text:m.kind==='menu'?`[LISTA INTERACTIVA]\n${config.options.map(o=>o.title).join(' · ')}`:m.kind==='buttons'?'[BOTONES REALES] Confirmar | Corregir':m.text||''})),...(r.confirmation?[{who:'bot' as const,text:'[SIMULACIÓN] Confirmación registrada. No se creó un ticket en Jira.'}]:[])]);
  }catch(e){setNotice(e instanceof Error?e.message:'Error de simulación');}finally{setBusy(false);setAnswer('');}}
 const canSim=useMemo(()=>config.options.length===4,[config]);
 return <main className={styles.shell}>
  <header className={styles.header}><div><Link href="/" className={styles.back}>← Volver a TicketBridge</Link><p className={styles.eyebrow}>WHATSAPP BUSINESS · CLOUD API</p><h1>Editor de menús interactivos</h1><p>Diseñá las opciones desde TicketBridge. Primero probalas en el simulador, sin enviar mensajes.</p></div><span className={styles.state}>{enabled&&verified?'Configurado para activar':'Modo preparación · sin envíos'}</span></header>
  <div className={styles.notice}><strong>Antes de vincular el número</strong><p>La coexistencia con tu WhatsApp Business debe confirmarse en Meta. No desconectes el teléfono ni actives Cloud API sin verificar elegibilidad, webhooks, plantillas y estrategia de sincronización. El conector actual permanece intacto.</p></div>
  <section className={styles.auth}><label>Clave local de administración (solo para cargar y guardar)<input type="password" autoComplete="off" value={adminKey} onChange={e=>setAdminKey(e.target.value)} placeholder="TICKETBRIDGE_CLOUD_ADMIN_TOKEN"/></label><button disabled={busy||adminKey.length<24} onClick={()=>void load()}>Cargar configuración</button><button className={styles.primary} disabled={busy||!loaded} onClick={()=>void save()}>Guardar cambios</button></section>
  {notice&&<p className={styles.feedback} role="status">{notice}</p>}
  <nav className={styles.tabs}>{([['menu','Menú'],['campos','Preguntas'],['simulador','Simulador']] as const).map(([id,title])=><button key={id} className={step===id?styles.selected:''} onClick={()=>setStep(id)}>{title}</button>)}</nav>
  <div className={styles.columns}>
   <section className={styles.editor}>
    {step==='menu'&&<><h2>Opciones del cliente</h2><p className={styles.subtle}>Meta muestra estas cuatro opciones como una lista nativa tocable. Los identificadores internos no cambian aunque edites los nombres.</p>
     <label>Saludo del menú<textarea rows={3} value={config.greeting} onChange={e=>update('greeting',e.target.value)}/></label>
     <div className={styles.two}><label>Título de la lista<input maxLength={24} value={config.menuTitle} onChange={e=>update('menuTitle',e.target.value)}/></label><label>Texto del botón<input maxLength={20} value={config.listButton} onChange={e=>update('listButton',e.target.value)}/></label></div>
     {config.options.map((o,i)=><div className={styles.menuRow} key={o.id}><span className={styles.rowIndex}>{i+1}</span><label><span>Opción {i+1}</span><input maxLength={24} value={o.title} onChange={e=>changeOption(i,'title',e.target.value)}/><small>ID: {o.id}</small></label></div>)}
     <div className={styles.two}>{(['confirmText','confirmedText','correctedText','handoffText'] as const).map(k=><label key={k}>{({confirmText:'Pregunta de confirmación',confirmedText:'Ticket registrado',correctedText:'Aviso al corregir',handoffText:'Mensaje de derivación'})[k]}<textarea rows={2} value={config[k]} onChange={e=>update(k,e.target.value)}/></label>)}</div>
     <div className={styles.notice}><h3>Iniciar sin que el cliente escriba primero</h3><p>Se requiere una plantilla de WhatsApp aprobada, consentimiento previo y Cloud API activa. No se permite enviar una lista libre fuera de la ventana de 24 horas.</p><label>Teléfono del cliente (código de país)<input inputMode="tel" value={recipient} onChange={e=>setRecipient(e.target.value.replace(/[^0-9]/g,''))} placeholder="595981123456"/></label><label className={styles.consent}><input type="checkbox" checked={optIn} onChange={e=>setOptIn(e.target.checked)}/> Confirmo que existe consentimiento documentado del cliente para recibir esta plantilla.</label><button disabled={!enabled||!verified||!optIn||!/^[0-9]{8,16}$/.test(recipient)||busy} onClick={()=>void startWithTemplate()}>Enviar plantilla aprobada</button></div>
    </>}
    {step==='campos'&&<><h2>Formularios dinámicos</h2><p className={styles.subtle}>Las preguntas se envían una a una por WhatsApp. Para formularios gráficos completos de Meta Flows se requiere publicar un Flow en Meta.</p>
     <div className={styles.selector}>{config.options.map((o,i)=><button key={o.id} className={branch===i?styles.selected:''} onClick={()=>setBranch(i)}>{o.title}</button>)}</div>
     {opt.fields.map((f,i)=><div className={styles.field} key={i}><label>Identificador<input value={f.id} onChange={e=>changeField(branch,i,'id',e.target.value)} disabled={f.id==='inconveniente'}/></label><label>Pregunta<input value={f.label} maxLength={200} onChange={e=>changeField(branch,i,'label',e.target.value)}/></label><button disabled={f.id==='inconveniente'} title="Quitar campo" onClick={()=>removeField(i)}>Quitar</button></div>)}
     <button onClick={addField} disabled={opt.fields.length>=10}>+ Agregar pregunta</button>
    </>}
    {step==='simulador'&&<><h2>Probar el recorrido</h2><p className={styles.subtle}>Todas las acciones son locales. No conectan con Meta, no envían mensajes y no crean tickets Jira.</p><button disabled={busy||!canSim} onClick={()=>{setState(newState());setHistory([]);void simulate({kind:'start'});}}>Iniciar conversación simulada</button>
     {state.stage==='menu'&&<div className={styles.simActions}>{config.options.map(o=><button key={o.id} onClick={()=>void simulate({kind:'list_reply',id:o.id})}>{o.title}</button>)}</div>}
     {state.stage==='collect'&&<form onSubmit={e=>{e.preventDefault();void simulate({kind:'text',text:answer});}} className={styles.inputAnswer}><input placeholder="Respuesta del cliente" value={answer} onChange={e=>setAnswer(e.target.value)}/><button disabled={!answer.trim()}>Responder</button></form>}
     {state.stage==='confirm'&&<div className={styles.simActions}><button onClick={()=>void simulate({kind:'button_reply',id:'ticket_confirmar'})}>Confirmar</button><button onClick={()=>void simulate({kind:'button_reply',id:'ticket_corregir'})}>Corregir</button></div>}
     {state.stage==='review'&&<p className={styles.feedback}>Confirmación simulada. Jira permanece sin cambios.</p>}
    </>}
   </section>
   <aside className={styles.preview}><div className={styles.phoneHead}><span className={styles.avatar}>TI</span><div><strong>Soporte TI</strong><small>Vista previa — WhatsApp del cliente</small></div></div>
    <div className={styles.bubble}>{config.greeting}</div>
    <div className={styles.listBox}><span>{config.menuTitle}</span><p>Elegí un sistema para solicitar ayuda.</p><div className={styles.actionLabel}>☷ {config.listButton}</div>{config.options.map(o=><div className={styles.listOption} key={o.id}>{o.title}</div>)}</div>
    {step==='simulador'&&history.map((h,i)=><div key={i} className={`${styles.bubble} ${h.who==='cliente'?styles.mine:''}`}>{h.text}</div>)}
    <small className={styles.disclaimer}>La vista previa no es un mensaje real. La lista y los botones se renderizan en WhatsApp cuando Meta procesa sus mensajes interactivos.</small>
   </aside>
  </div>
 </main>;
}
