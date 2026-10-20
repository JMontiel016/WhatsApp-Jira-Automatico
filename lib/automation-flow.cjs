'use strict';
// Modo simple de soporte: sin APIs externas ni datos de clientes.
const SYSTEMS = ['Futura100','Talento100','Consulta TI','Otro sistema'];
function fold(s){ return String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(); }
function availableSystems(value){
 let parsed=value;
 if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{parsed=[];}}
 if(!Array.isArray(parsed))return [...SYSTEMS];
 const unique=SYSTEMS.filter(s=>parsed.includes(s));
 return unique.length?unique:[...SYSTEMS];
}
function parseSelection(raw,allowed=SYSTEMS,multiple=false){
 const pieces=String(raw||'').trim().split(/\s*(?:,|;|\+|\s+y\s+)\s*/i).filter(Boolean);
 if(!pieces.length||(pieces.length>1&&!multiple))return null;
 const found=[];
 for(const value of pieces){
  const index=/^\d+$/.test(value)?Number(value)-1:-1;
  const system=index>=0?allowed[index]:allowed.find(s=>fold(s)===fold(value));
  if(!system)return null;
  if(!found.includes(system))found.push(system);
 }
 return found.length?found:null;
}
function firstRequest(raw,allowed=SYSTEMS,multiple=false){
 const text=String(raw||'').trim();
 const match=/^([^\n:]{2,90})\s*:\s*([\s\S]{2,500})$/.exec(text);
 if(!match)return null;
 const systems=parseSelection(match[1],allowed,multiple);
 const issue=match[2].trim();
 return systems&&issue.length>=2&&issue.length<=500?{systems,issue}:null;
}
function keyword(raw){return ['SOPORTE','MENU','AYUDA','INICIAR'].includes(fold(raw));}
function menuText(allowed=SYSTEMS,multiple=false){
 return allowed.map((s,i)=>`${i+1}. ${s}`).join('\n')+(multiple?'\n\nPodés elegir varios, por ejemplo: 1,2.':'\n\nRespondé con una opción.');
}
module.exports={SYSTEMS,availableSystems,parseSelection,firstRequest,keyword,menuText};
