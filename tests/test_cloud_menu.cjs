'use strict';
const assert=require('node:assert/strict');
const {DEFAULT_CONFIG,validateConfig,listMessage,buttons,advance,newState,parseMetaMessage}=require('../lib/cloud-menu-core.cjs');
const config=structuredClone(DEFAULT_CONFIG);
assert.equal(validateConfig(config).options.length,4);
const list=listMessage(config,'595981123456');
assert.equal(list.interactive.type,'list');
assert.equal(list.interactive.action.sections[0].rows.length,4);
assert.deepEqual(list.interactive.action.sections[0].rows.map(x=>x.id),['sistema_futura100','sistema_talento100','sistema_consulta_ti','sistema_otro']);
assert.equal(buttons(config,'595981123456').interactive.action.buttons.length,2);
assert.deepEqual(buttons(config,'595981123456').interactive.action.buttons.map(x=>x.reply.id),['ticket_confirmar','ticket_corregir']);
const original=newState();
assert.equal(advance(config,original,{kind:'text',text:'1'}).state.stage,'menu','Un número escrito NO selecciona opciones');
let r=advance(config,original,{kind:'list_reply',id:'sistema_talento100'});
assert.equal(r.state.stage,'collect');assert.equal(r.state.branch,'sistema_talento100');
for(const val of ['Juan Perez','1234567','juan@example.com','No inicia sesión']){r=advance(config,r.state,{kind:'text',text:val});assert.equal(r.confirmation,false);}
assert.equal(r.state.stage,'confirm');
let wrong=advance(config,r.state,{kind:'text',text:'confirmar'});assert.equal(wrong.confirmation,false,'El texto no confirma');
let corrected=advance(config,r.state,{kind:'button_reply',id:'ticket_corregir'});assert.equal(corrected.state.stage,'collect');
let done=advance(config,r.state,{kind:'button_reply',id:'ticket_confirmar'});assert.equal(done.confirmation,true);assert.equal(done.state.stage,'review');
assert.equal(parseMetaMessage({type:'interactive',interactive:{type:'list_reply',list_reply:{id:'sistema_talento100'}}}).id,'sistema_talento100');
assert.equal(parseMetaMessage({type:'interactive',interactive:{type:'button_reply',button_reply:{id:'ticket_confirmar'}}}).id,'ticket_confirmar');
const image=advance(config,newState(),{kind:'image',mediaId:'123456'});assert.equal(image.state.stage,'menu');
try{validateConfig({...config,options:[...config.options,{id:'extra',title:'extra',fields:[]}]});assert.fail('Aceptó menú inválido');}catch(e){assert.match(e.message,/cuatro opciones/);}
console.log('[OK] Cloud API: lista de 4 opciones, IDs, botones reales, preguntas, corrección, bloqueo de texto numérico y confirmación exclusivamente por botón.');
