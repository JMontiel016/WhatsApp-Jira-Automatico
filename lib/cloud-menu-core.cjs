'use strict';
/** Núcleo puro y sin dependencias: mantiene el protocolo de Meta separado del bot legacy. */
const MENU_IDS=['sistema_futura100','sistema_talento100','sistema_consulta_ti','sistema_otro'];
const DEFAULT_CONFIG={
  greeting:'¡Hola! Bienvenido a Soporte TI. ¿En qué podemos ayudarte?',
  menuTitle:'Menú de Soporte TI', listButton:'Seleccionar sistema',
  options:[
    {id:'sistema_futura100',title:'Futura100',fields:[{id:'empresa',label:'Nombre de la empresa'},{id:'ruc',label:'RUC de la empresa'},{id:'inconveniente',label:'Describí el inconveniente'}]},
    {id:'sistema_talento100',title:'Talento100',fields:[{id:'nombre',label:'Nombre y apellido'},{id:'cedula',label:'Número de cédula'},{id:'correo',label:'Correo electrónico'},{id:'inconveniente',label:'Describí el inconveniente'}]},
    {id:'sistema_consulta_ti',title:'Consulta TI',fields:[{id:'inconveniente',label:'Contanos tu inconveniente o consulta'}]},
    {id:'sistema_otro',title:'Otro sistema',fields:[{id:'sistema',label:'Nombre del sistema'},{id:'correo',label:'Correo electrónico'},{id:'inconveniente',label:'Describí el inconveniente'}]},
  ],
  confirmText:'Revisá tu solicitud. ¿Confirmás que los datos son correctos?',
  confirmedText:'Recibimos tu solicitud. Soporte TI la revisará.',
  correctedText:'Volvamos a completar tus datos.',
  handoffText:'Vamos a derivar tu consulta a Soporte TI.',
};
function validateConfig(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Configuración inválida');
 const text=(x,max)=>typeof x==='string'&&x.trim()&&x.length<=max;
 for(const k of ['greeting','menuTitle','listButton','confirmText','confirmedText','correctedText','handoffText'])if(!text(input[k],k==='listButton'?20:800))throw new Error('Texto inválido: '+k);
 if(!Array.isArray(input.options)||input.options.length!==4)throw new Error('El menú debe contener cuatro opciones');
 const keys=new Set();
 input.options.forEach((o,i)=>{
  if(o?.id!==MENU_IDS[i])throw new Error('No se pueden cambiar los IDs internos');
  if(!text(o.title,24))throw new Error('Título de opción inválido (máx. 24)');
  if(!Array.isArray(o.fields)||!o.fields.length||o.fields.length>10)throw new Error('Campos inválidos');
  o.fields.forEach(f=>{
   if(!f||typeof f.id!=='string'||!/^[a-z_]{2,30}$/.test(f.id)||!text(f.label,200))throw new Error('Campo inválido');
   if(keys.has(o.id+':'+f.id))throw new Error('Campo duplicado');keys.add(o.id+':'+f.id);
  });
  if(!o.fields.some(f=>f.id==='inconveniente'))throw new Error('Cada opción requiere un inconveniente');
 });
 return input;
}
function listMessage(config,to){
 const c=validateConfig(config);
 return {messaging_product:'whatsapp',to,type:'interactive',interactive:{type:'list',body:{text:c.greeting},action:{button:c.listButton,sections:[{title:c.menuTitle.slice(0,24),rows:c.options.map(o=>({id:o.id,title:o.title}))}]}}};
}
function buttons(config,to){
 return {messaging_product:'whatsapp',to,type:'interactive',interactive:{type:'button',body:{text:config.confirmText},action:{buttons:[{type:'reply',reply:{id:'ticket_confirmar',title:'Confirmar'}},{type:'reply',reply:{id:'ticket_corregir',title:'Corregir'}}]}}};
}
function summarize(config,s){const o=config.options.find(o=>o.id===s.branch);if(!o)return '';
 return [`Sistema: ${o.title}`,...o.fields.map(f=>`${f.label}: ${String(s.answers[f.id]||'')}`)].join('\n');}
function newState(){return {stage:'menu',branch:'',cursor:0,answers:{},confirmed:false,jiraKey:null,startedAt:new Date().toISOString()};}
function advance(config,st,event){
 const state=structuredClone(st||newState());let messages=[];let confirmation=false;
 const txt=(s)=>messages.push({kind:'text',text:s});
 const menu=()=>messages.push({kind:'menu'});
 const btn=()=>messages.push({kind:'buttons'});
 const option=()=>config.options.find(x=>x.id===state.branch);
 if(event?.kind==='start') {Object.assign(state,newState());menu();return {state,messages,confirmation};}
 if(event?.kind==='image'){txt('Imagen recibida para la solicitud. Podés continuar con los datos.');return {state,messages,confirmation};}
 if(state.stage==='done'||state.stage==='review'){txt('La solicitud ya fue enviada. Para iniciar otra consulta, enviá un nuevo pedido de soporte.');return {state,messages,confirmation};}
 if(state.stage==='menu'){
  if(event?.kind!=='list_reply'||!config.options.some(o=>o.id===event.id)){menu();return {state,messages,confirmation};}
  state.branch=event.id;state.cursor=0;state.answers={};state.stage='collect';txt(option().fields[0].label);return {state,messages,confirmation};
 }
 if(state.stage==='collect'){
  const o=option();if(!o){Object.assign(state,newState());menu();return {state,messages,confirmation};}
  const field=o.fields[state.cursor];const value=event?.kind==='text'?String(event.text||'').trim():'';
  if(!value||value.length>3000){txt('Respondé la pregunta en un mensaje de texto (máximo 3000 caracteres).');return {state,messages,confirmation};}
  if(field.id==='correo'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)){txt('Ingresá un correo válido.');return {state,messages,confirmation};}
  state.answers[field.id]=value;state.cursor++;
  if(state.cursor<o.fields.length){txt(o.fields[state.cursor].label);}else{state.stage='confirm';txt(summarize(config,state));btn();}
  return {state,messages,confirmation};
 }
 if(state.stage==='confirm'){
  if(event?.kind==='button_reply'&&event.id==='ticket_corregir'){
   state.cursor=0;state.answers={};state.stage='collect';txt(config.correctedText);txt(option().fields[0].label);return {state,messages,confirmation};
  }
  if(event?.kind==='button_reply'&&event.id==='ticket_confirmar'){
   state.stage='review';state.confirmed=true;confirmation=true;return {state,messages,confirmation};
  }
  btn();return {state,messages,confirmation};
 }
 return {state,messages,confirmation};
}
function parseMetaMessage(msg){
 if(msg?.type==='interactive'){
  const v=msg.interactive;if(v?.type==='list_reply'&&typeof v.list_reply?.id==='string')return {kind:'list_reply',id:v.list_reply.id};
  if(v?.type==='button_reply'&&typeof v.button_reply?.id==='string')return {kind:'button_reply',id:v.button_reply.id};
 }
 if(msg?.type==='button'&&typeof msg.button?.payload==='string')return {kind:'button_reply',id:msg.button.payload};
 if(msg?.type==='text')return {kind:'text',text:msg.text?.body||''};
 if(msg?.type==='image')return {kind:'image',mediaId:msg.image?.id||''};
 return null;
}
module.exports={DEFAULT_CONFIG,MENU_IDS,validateConfig,listMessage,buttons,summarize,newState,advance,parseMetaMessage};
