'use strict';
// PollVote de whatsapp-web.js puede traer parentMsgKey aun sin parentMessage.
// No asumir que localId es el índice de la opción: NO lo es.
const SUPPORT=['Futura100','Talento100','Consulta TI','Otro sistema'];
const allowed = new Set(SUPPORT);
function serialized(value){
 if(typeof value==='string')return value;
 if(!value || typeof value!=='object')return '';
 return typeof value._serialized==='string'?value._serialized:
        typeof value.$1==='string'?value.$1:'';
}
function extractVote(vote){
 if(!vote || !Array.isArray(vote.selectedOptions)||vote.selectedOptions.length!==1)
  return {valid:false,reason:'sin una selección única'};
 const selected=vote.selectedOptions[0];
 // Los nombres vienen de parentMessage.pollOptions en whatsapp-web.js.
 let option=typeof selected?.name==='string'?selected.name:'';
 if(!allowed.has(option) && Array.isArray(vote.parentMessage?.pollOptions)){
  const found=vote.parentMessage.pollOptions.find(x=>x.localId===selected?.localId);
  option=found?.name||'';
 }
 if(!allowed.has(option))return {valid:false,reason:'opción no reconocida'};
 const pollId=serialized(vote.parentMessage?.id)||serialized(vote.parentMsgKey);
 const voter=serialized(vote.voter);
 const parentChatId=serialized(vote.parentMessage?.to)||serialized(vote.parentMessage?.id?.remote)||'';
 if(!pollId)return {valid:false,reason:'encuesta sin identificador'};
 if(!/^\d{5,40}@(c\.us|lid)$/.test(voter))return {valid:false,reason:'identificador de votante incompatible'};
 return {valid:true,pollId,voter,parentChatId,option};
}
module.exports={extractVote};
