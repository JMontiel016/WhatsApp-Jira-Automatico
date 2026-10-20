import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { database } from '@/lib/db';
import { rejectCrossOrigin } from '@/lib/security';
import { AUTOMATION_TEXT_DEFAULTS, AUTOMATION_OPTIONAL_QUESTIONS } from '@/lib/automation-text';
import {EXTRA_SYSTEMS} from '@/lib/automation-extra-fields';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const person=z.object({id:z.string().max(160),name:z.string().max(120)});
const payload=z.object({
 start:time,end:time,automationEnabled:z.boolean().optional(),
 automationAssigneeId:z.string().max(160).optional(),level2Phone:z.string().regex(/^\+?[0-9]{10,16}$/).or(z.literal('')).optional(),level2Minutes:z.number().int().min(5).max(720).optional(), // compatibilidad con configuración anterior
 team:z.object({level1:person,level2:person,manager:person}).optional(),
 excludedPhones:z.string().max(3000).optional(),
 supportPhones:z.object({level1:z.string(),level2:z.string(),manager:z.string()}).optional(),
 autoCallEnabled:z.boolean().optional(),callRoles:z.object({level1:z.boolean(),level2:z.boolean()}).optional(),
 texts:z.record(z.string().trim().min(5).max(700)).optional(),
 questionEnabled:z.record(z.boolean()).optional(),
 savedContacts:z.object({mode:z.enum(['inherit','short']),confirmation:z.boolean()}).optional(),
 supportNotifications:z.object({level1:z.string().max(400),level2:z.string().max(400),manager:z.string().max(400)}).optional(),
 flow:z.object({
  startMode:z.enum(['first','keyword']),shortForm:z.boolean(),confirmation:z.boolean(),
  multipleSystems:z.boolean(),humanPause:z.boolean(),systems:z.array(z.enum(['Futura100','Talento100','Consulta TI','Otro sistema'])).min(1).max(4)
 }).optional(),
 extraFields:z.array(z.object({id:z.string().regex(/^f_[a-z0-9]{5,24}$/),system:z.enum(['Futura100','Talento100','Consulta TI','Otro sistema']),label:z.string().trim().min(2).max(80),enabled:z.boolean(),required:z.boolean()})).max(20).optional()
});
export async function GET(){
 const rows=database().prepare('SELECT name,value FROM settings').all() as {name:string;value:string}[];
 return NextResponse.json(Object.fromEntries(rows.map(r=>[r.name,r.value])),{headers:{'Cache-Control':'no-store'}});
}
export async function PUT(r:NextRequest){
 const denied=rejectCrossOrigin(r);if(denied)return denied;
 const parsed=payload.safeParse(await r.json().catch(()=>null));
 if(!parsed.success||parsed.data.start>=parsed.data.end)return NextResponse.json({error:'Configuración inválida'},{status:400});
 const v=parsed.data;
 if(v.flow && (!v.flow.shortForm && (!v.flow.confirmation || v.flow.multipleSystems)))return NextResponse.json({error:'Para omitir la confirmación o seleccionar varios sistemas, activá Formulario corto'},{status:400});
 if(v.extraFields && (new Set(v.extraFields.map(x=>x.id)).size!==v.extraFields.length || EXTRA_SYSTEMS.some(sys=>v.extraFields!.filter(x=>x.system===sys).length>5)))return NextResponse.json({error:'Máximo 5 campos por sistema y sin ID duplicados'},{status:400});
 if(v.questionEnabled && Object.keys(v.questionEnabled).some(k=>!(AUTOMATION_OPTIONAL_QUESTIONS as readonly string[]).includes(k)))return NextResponse.json({error:'Campo opcional desconocido'},{status:400});
 if(v.texts && Object.keys(v.texts).some(k=>!Object.hasOwn(AUTOMATION_TEXT_DEFAULTS,k)))return NextResponse.json({error:'Campo de texto desconocido'},{status:400});
 if(v.team && Object.values(v.team).some(p=>Boolean(p.id)!==Boolean(p.name)))return NextResponse.json({error:'Seleccioná un usuario real de Jira para cada puesto'},{status:400});
 if(v.team){const ids=Object.values(v.team).map(p=>p.id).filter(Boolean);if(new Set(ids).size!==ids.length)return NextResponse.json({error:'Seleccioná tres personas diferentes'},{status:400});}
 if(v.excludedPhones!==undefined && v.excludedPhones.split(/[\s,;]+/).filter(Boolean).some(phone=>!/^[0-9]{8,16}$/.test(phone)))return NextResponse.json({error:'Los números excluidos deben estar completos y solo contener dígitos.'},{status:400});
 if(v.supportPhones && Object.values(v.supportPhones).some(number=>number&&!/^\+?[0-9]{10,16}$/.test(number)))return NextResponse.json({error:'Teléfono de guardia inválido. Incluí el código del país.'},{status:400});
 const db=database(),write=db.prepare('INSERT INTO settings(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value');
 db.transaction(()=>{
  write.run('start',v.start);write.run('end',v.end);
  // El estado ON/OFF se modifica SOLO con PATCH: evita reactivarlo desde formularios obsoletos.
  if(v.team){for(const [role,person] of Object.entries(v.team)){write.run(`automation_${role}_id`,person.id);write.run(`automation_${role}_name`,person.name);}write.run('automation_assignee_id',v.team.level2.id);}
  else if(v.automationAssigneeId!==undefined)write.run('automation_assignee_id',v.automationAssigneeId);
  if(v.excludedPhones!==undefined)write.run('automation_excluded_phones',v.excludedPhones.split(/[\s,;]+/).filter(Boolean).join('\n'));
  if(v.supportPhones){for(const [role,number] of Object.entries(v.supportPhones))write.run('automation_'+role+'_phone',number.replace(/\D/g,''));}
  else if(v.level2Phone!==undefined)write.run('automation_level2_phone',v.level2Phone.replace(/\D/g,''));
  if(v.level2Minutes!==undefined)write.run('automation_level2_minutes',String(v.level2Minutes));
  if(v.autoCallEnabled!==undefined)write.run('automation_auto_call_enabled',v.autoCallEnabled?'1':'0');
  if(v.callRoles){write.run('automation_call_level1',v.callRoles.level1?'1':'0');write.run('automation_call_level2',v.callRoles.level2?'1':'0');}
  if(v.texts)for(const [key,value] of Object.entries(v.texts))write.run('automation_text_'+key,value);
  if(v.questionEnabled)for(const [key,value] of Object.entries(v.questionEnabled))write.run('automation_prompt_enabled_'+key,value?'1':'0');
  if(v.savedContacts){write.run('automation_saved_contact_mode',v.savedContacts.mode);write.run('automation_saved_contact_confirm',v.savedContacts.confirmation?'1':'0');}
  if(v.supportNotifications)for(const [role,text] of Object.entries(v.supportNotifications))write.run('automation_notice_'+role,text.trim());
  if(v.extraFields)write.run('automation_extra_fields',JSON.stringify(v.extraFields));
  if(v.flow){
   write.run('automation_flow_start',v.flow.startMode);
   write.run('automation_flow_short',v.flow.shortForm?'1':'0');
   write.run('automation_flow_confirm',v.flow.confirmation?'1':'0');
   write.run('automation_flow_multi',v.flow.multipleSystems?'1':'0');
   write.run('automation_flow_human',v.flow.humanPause?'1':'0');
   write.run('automation_flow_systems',JSON.stringify(v.flow.systems));
  }
 })();
 return NextResponse.json({ok:true});
}

// El interruptor debe guardar inmediatamente, no solo modificar el estado React.
// No permitir que otra sesión del navegador reactive la automatización por error.
export async function PATCH(r:NextRequest){
 const denied=rejectCrossOrigin(r);if(denied)return denied;
 const v=z.object({automationEnabled:z.boolean()}).safeParse(await r.json().catch(()=>null));
 if(!v.success)return NextResponse.json({error:'Estado inválido'},{status:400});
 database().prepare("INSERT INTO settings(name,value) VALUES ('automation_enabled',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(v.data.automationEnabled?'1':'0');
 return NextResponse.json({ok:true,enabled:v.data.automationEnabled},{headers:{'Cache-Control':'no-store'}});
}
