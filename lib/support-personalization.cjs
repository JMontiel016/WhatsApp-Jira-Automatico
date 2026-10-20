
'use strict';
/** Solo las preguntas accesorias pueden apagarse: sistema e inconveniente son mínimos. */
const OPTIONAL_QUESTIONS = Object.freeze(['welcome','ruc','talentName','talentId','talentEmail','otherSystem','otherEmail','tiHandoff','evidence']);
const QUESTION_TO_STEP = Object.freeze({ruc:'ruc',talentName:'talent_name',talentId:'talent_id',talentEmail:'talent_email',otherSystem:'other_system',otherEmail:'other_email'});
function enabledQuestions(data){const out={};for(const key of OPTIONAL_QUESTIONS)out[key]=data?.[key]!==false;return out;}
function nextDetailedStep(system,current=''){
 const bySystem={'Futura100':['ruc','issue'],'Talento100':['talent_name','talent_id','talent_email','issue'],'Consulta TI':['issue'],'Otro sistema':['other_system','other_email','issue']};
 const keys=bySystem[system]||['issue'];
 const from=current?keys.indexOf(current)+1:0;
 return keys.slice(Math.max(0,from));
}
function messageForSupport(template,key,link,role){
 if(!/^[A-Z][A-Z0-9]+-\d+$/.test(key)||!/^https:\/\/[^\s]+$/.test(link))throw new Error('Enlace o ticket inválido');
 let raw=String(template||'').trim();
 if(!raw)return link;
 if(raw.length>400)throw new Error('Mensaje para soporte demasiado largo');
 const level=role==='level1'?'N1':role==='level2'?'N2':'Encargado';
 raw=raw.replace(/\{ticket\}/gi,key).replace(/\{link\}/gi,link).replace(/\{nivel\}/gi,level);
 // No agregar información de clientes automáticamente; el enlace siempre estará presente.
 return raw.includes(link)?raw:`${raw}\n${link}`;
}
module.exports={OPTIONAL_QUESTIONS,QUESTION_TO_STEP,enabledQuestions,nextDetailedStep,messageForSupport};
