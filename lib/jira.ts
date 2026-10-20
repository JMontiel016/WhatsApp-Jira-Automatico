function config(){
  const base=(process.env.JIRA_BASE_URL||'').replace(/\/$/,'');
  const email=process.env.JIRA_EMAIL||'';
  const token=process.env.JIRA_API_TOKEN||'';
  if (!base.startsWith('https://')||!email||!token) throw new Error('Configurá JIRA_BASE_URL, JIRA_EMAIL y JIRA_API_TOKEN en .env.local');
  return {base,auth:'Basic '+Buffer.from(`${email}:${token}`).toString('base64')};
}
async function responseJson(res:Response) {
  const str=await res.text();
  let parsed: unknown;
  try {parsed=JSON.parse(str);} catch {parsed={message:str.slice(0,250)};}
  if(!res.ok) throw new Error(`Jira HTTP ${res.status}: ${JSON.stringify(parsed).slice(0,450)}`);
  return parsed;
}
export async function jiraTest(){
  const {base,auth}=config();
  const res=await fetch(`${base}/rest/api/3/myself`,{headers:{Authorization:auth,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});
  const v=await responseJson(res) as {displayName?:string};
  return {ok:true,user:v.displayName||'Autenticado'};
}
type JiraCustomField={id:string;name:string;schema?:{type?:string;items?:string;custom?:string}};
function normalFieldName(name:string){return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');}
function jiraTextDoc(text:string){return {type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text}]}]};}
function jiraFieldValue(field:JiraCustomField,value:string):unknown{
 const type=field.schema?.type||'';
 const items=field.schema?.items||'';
 const custom=field.schema?.custom||'';
 if(custom.endsWith(':textarea'))return jiraTextDoc(value);
 if(type==='string')return value;
 if(type==='option')return {value};
 if(type==='array'&&(items==='option'||custom.includes('multiselect')))return [{value}];
 if(type==='array'&&(items==='string'||custom.includes('labels')))return [value];
 // No inventar el formato para campos incompatibles.
 return undefined;
}
async function jiraCustomFields(base:string,auth:string,clientName:string,system:string){
 const mapped:Record<string,unknown>={};
 const warnings:string[]=[];
 let list:JiraCustomField[]=[];
 try{
  const res=await fetch(`${base}/rest/api/3/field`,{headers:{Authorization:auth,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const result=await res.json() as unknown;
  if(!Array.isArray(result))throw new Error('respuesta inválida');
  list=result as JiraCustomField[];
 }catch(e){
  return {fields:mapped,warnings:[`No se pudieron consultar los campos personalizados de Jira (${e instanceof Error?e.message:'error'}). El ticket se creará sin completar CLIENTE/SISTEMA.`]};
 }
 for(const target of [{name:'CLIENTE',env:'JIRA_CLIENT_FIELD_ID',value:clientName},{name:'SISTEMA',env:'JIRA_SYSTEM_FIELD_ID',value:system}]){
  const specified=(process.env[target.env]||'').trim();
  const candidates=list.filter(f=>f.id.startsWith('customfield_')&&(specified?f.id===specified:normalFieldName(f.name)===normalFieldName(target.name)));
  // Varias coincidencias con mismo nombre: no seleccionar arbitrariamente la equivocada.
  if(candidates.length!==1){
   warnings.push(candidates.length>1?`Hay varios campos «${target.name}» en Jira: indicá ${target.env} en .env.local.`:`No se encontró el campo «${target.name}» en Jira: comprobá su nombre o configurá ${target.env}.`);
   continue;
  }
  const field=candidates[0];
  const encoded=jiraFieldValue(field,target.value);
  if(encoded===undefined){warnings.push(`El campo «${target.name}» (${field.id}) tiene un tipo no compatible (${field.schema?.type||'desconocido'}).`);continue;}
  mapped[field.id]=encoded;
 }
 return {fields:mapped,warnings};
}
export async function jiraCreate(c:{id:number;customer:string;phone:string;message:string;local_date:string;local_time:string;reason:string;source?:string}, options?:{title?:string;assigneeId?:string;reporterId?:string;parentKey?:string;customerName?:string;system?:string}){
  if (process.env.ENABLE_REAL_JIRA!=='true') throw new Error('Creación real desactivada: ENABLE_REAL_JIRA=false');
  const {base,auth}=config();
  const project=process.env.JIRA_PROJECT_KEY||'CW';
  const issuetype=options?.parentKey ? (process.env.JIRA_SUBTASK_TYPE_ID||'10592') : (process.env.JIRA_ISSUE_TYPE_ID||'10595');
  const text=c.source==='whatsapp'?c.message:`Cliente: ${c.customer}\nFecha: ${c.local_date} ${c.local_time}\nMensaje: ${c.message}`;
  const fields:Record<string,unknown>={project:{key:project},issuetype:{id:issuetype},summary:options?.title || `[${c.source==='whatsapp'?'WHATSAPP':'SIMULADOR'}] ${c.message.replace(/\s+/g,' ').slice(0,110)}`,description:{type:'doc',version:1,content:[{type:'paragraph',content:text.split(/\r?\n/).flatMap((line,i)=>[...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])}]},labels:[c.source==='whatsapp'?'whatsapp-real':'whatsapp-simulador','ticketbridge'],priority:{id:'3'}};
  if(options?.parentKey){fields.parent={key:options.parentKey};}
  if(options?.reporterId)fields.reporter={accountId:options.reporterId};
  if(options?.assigneeId)fields.assignee={accountId:options.assigneeId};else if(process.env.JIRA_ASSIGNEE_ACCOUNT_ID)fields.assignee={accountId:process.env.JIRA_ASSIGNEE_ACCOUNT_ID};
  const warnings:string[]=[];
  const customKeys:string[]=[];
  if(c.source==='whatsapp'&&options?.customerName&&options?.system){
   const custom=await jiraCustomFields(base,auth,options.customerName,options.system);
   Object.assign(fields,custom.fields);
   customKeys.push(...Object.keys(custom.fields));
   warnings.push(...custom.warnings);
  }
  async function postIssue(){
   return fetch(`${base}/rest/api/3/issue`,{method:'POST',headers:{Authorization:auth,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({fields}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  }
  let res=await postIssue();
  // Jira devuelve 400 si una opción/campo no está admitida en la pantalla de creación.
  // Reintento seguro SOLO si el 400 se refiere a estos campos personalizados: no se
  // reintenta en timeouts ni en respuestas inciertas para evitar tickets duplicados.
  // Jira puede restringir el campo reporter a ciertos permisos/proyectos.
  // Solo se reintenta tras un HTTP 400 explícito y únicamente quitando campos
  // que Jira señaló como inválidos; nunca ante timeout/5xx (riesgo de duplicado).
  if(res.status===400&&(customKeys.length||options?.reporterId)){
   let payload:unknown;
   try{payload=await res.clone().json();}catch{payload=null;}
   const fieldErrors=payload&&typeof payload==='object'&&'errors' in payload?(payload as {errors?:Record<string,string>}).errors||{}:{};
   const allowed=[...customKeys,...(options?.reporterId?['reporter']:[])];
   const failedKeys=allowed.filter(key=>Object.hasOwn(fieldErrors,key));
   if(failedKeys.length){
    for(const key of failedKeys){
     warnings.push(key==='reporter'
      ?`Jira no permitió establecer Nivel 1 como informante: ${fieldErrors[key]}. Revisar permiso Modify Reporter en el proyecto.`
      :`Jira rechazó el campo ${key}: ${fieldErrors[key]}. Revisá su configuración.`);
     delete fields[key];
    }
    res=await postIssue();
   }
  }
  const created=await responseJson(res) as {key:string;id:string};
  return {...created,fieldWarnings:warnings};
}

export async function jiraAssignable(query:string){
 const {base,auth}=config();
 const params=new URLSearchParams({project:process.env.JIRA_PROJECT_KEY||'CW',query,maxResults:'30'});
 const res=await fetch(`${base}/rest/api/3/user/assignable/search?${params}`,{headers:{Authorization:auth,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});
 const data=await responseJson(res) as Array<{accountId:string;displayName:string;active:boolean}>;
 return data.filter(u=>u.active!==false).map(u=>({id:u.accountId,name:u.displayName}));
}
export async function jiraAttach(issueKey:string,files:Array<{id:number;filename:string;mime:string;data:Buffer}>){
 const {base,auth}=config();
 const outcome:{uploaded:number;errors:string[]}={uploaded:0,errors:[]};
 for(const file of files){
  try{
   const form=new FormData();form.append('file',new Blob([new Uint8Array(file.data)],{type:file.mime}),file.filename);
   const res=await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,{method:'POST',headers:{Authorization:auth,'X-Atlassian-Token':'no-check',Accept:'application/json'},body:form,signal:AbortSignal.timeout(30000)});
   await responseJson(res);outcome.uploaded++;
  }catch(e){outcome.errors.push(`Archivo #${file.id}: ${e instanceof Error?e.message:'Error'}`);}
 }
 return outcome;
}

// Lectura limitada de un ticket ya relacionado con una conversación local.
function jiraAdfText(node:unknown):string{
 if(!node||typeof node!=='object')return '';
 const v=node as {type?:string;text?:string;content?:unknown[]};
 if(v.type==='hardBreak')return '\n';
 const content=(v.content||[]).map(jiraAdfText).join('');
 return (v.text||'')+content+(['paragraph','heading','listItem','bulletList','orderedList','blockquote'].includes(v.type||'')?'\n':'');
}
export async function jiraDetails(key:string){
 if(!/^CW-[0-9]+$/.test(key))throw new Error('Clave Jira inválida');
 const {base,auth}=config();
 const response=await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,attachment,assignee,resolutiondate`,{
  headers:{Authorization:auth,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)
 });
 const obj=await responseJson(response) as {key:string;fields:{summary?:string;description?:unknown;status?:{name?:string;statusCategory?:{key?:string;name?:string}};attachment?:Array<{id:string;filename:string;mimeType:string;size:number}>;assignee?:{accountId:string;displayName:string}|null;resolutiondate?:string|null}};
 return {
  key:obj.key,summary:obj.fields.summary||'',status:obj.fields.status?.name||'',statusCategory:obj.fields.status?.statusCategory?.key||'',resolutionDate:obj.fields.resolutiondate||null,assignee:obj.fields.assignee?{id:obj.fields.assignee.accountId,name:obj.fields.assignee.displayName}:null,
  description:jiraAdfText(obj.fields.description).trim(),
  attachments:(obj.fields.attachment||[]).map(a=>({id:String(a.id),filename:a.filename,mime:a.mimeType,size:a.size})),
  url:`${base}/browse/${encodeURIComponent(key)}`
 };
}


/** Incorpora seguidores por cuenta. Las notificaciones dependen de permisos,
 * configuración del proyecto y preferencias individuales en Jira.
 * El rol Nivel 1 sigue siendo el único asignado al ticket. */
export async function jiraAddTeamWatchers(key:string,accountIds:string[]):Promise<{confirmed:string[];errors:Record<string,string>}>{
 const confirmed:string[]=[],errors:Record<string,string>={};
 if(!/^[A-Z][A-Z0-9]+-\d+$/.test(key))throw new Error('Ticket inválido');
 const {base,auth}=config();
 const unique=[...new Set(accountIds.filter(Boolean))];
 await Promise.all(unique.map(async id=>{
  try{
   const res=await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/watchers`,{
    method:'POST',headers:{Authorization:auth,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify(id),signal:AbortSignal.timeout(9000),cache:'no-store'
   });
   if(!res.ok)throw new Error('Jira HTTP '+res.status+': '+(await res.text()).slice(0,170));
   confirmed.push(id);
  }catch(e){errors[id]=e instanceof Error?e.message:'No confirmado';}
 }));
 return {confirmed,errors};
}

/** Cambio de estado tras confirmación verificable de Nivel 2.
 * Únicamente usa la transición En curso configurada en Jira y nunca inventa estados. */
export async function jiraMoveToInProgress(key:string){
 if(!/^CW-\d+$/.test(key))throw Error('Ticket inválido');
 const {base,auth}=config();
 const response=await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,{headers:{Authorization:auth,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
 const body=await responseJson(response) as {transitions?:Array<{id:string;name:string;to?:{statusCategory?:{key?:string}}}>};
 const candidates=body.transitions||[];
 const configured=process.env.JIRA_IN_PROGRESS_TRANSITION_ID||'';
 const matched=configured?candidates.find(x=>x.id===configured):candidates.find(x=>/^(en curso|en progreso|in progress|start progress|iniciar progreso)$/i.test(x.name.trim()));
 if(!matched)return {changed:false,reason:'Jira no ofrece una transición En curso. Configurá JIRA_IN_PROGRESS_TRANSITION_ID según CW.'};
 const moved=await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,{method:'POST',headers:{Authorization:auth,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({transition:{id:matched.id}}),cache:'no-store',signal:AbortSignal.timeout(12000)});
 await responseJson(moved);return {changed:true};
}

/** Cambiar asignado real en CW; nunca inventar la identidad de un usuario Jira. */
export async function jiraAssign(key:string,accountId:string){
 if(!/^[A-Z][A-Z0-9]+-\d+$/.test(key)||!accountId.trim())throw Error('Datos Jira inválidos');
 const {base,auth}=config();
 const r=await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/assignee`,{method:'PUT',headers:{Authorization:auth,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({accountId}),signal:AbortSignal.timeout(12000),cache:'no-store'});
 if(!r.ok)throw Error('Jira rechazó el cambio HTTP '+r.status);
}
