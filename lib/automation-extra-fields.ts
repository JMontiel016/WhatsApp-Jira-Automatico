/** Campos opcionales del formulario: se fijan al iniciar una conversación para no cambiarla a mitad. */
export const EXTRA_SYSTEMS=['Futura100','Talento100','Consulta TI','Otro sistema'] as const;
export type ExtraSystem=typeof EXTRA_SYSTEMS[number];
export type ExtraField={id:string;system:ExtraSystem;label:string;required:boolean;enabled:boolean};
export function parseExtraFields(raw:string):ExtraField[]{
 try{
  const list:unknown=JSON.parse(raw);
  if(!Array.isArray(list))return [];
  return list.filter((x):x is ExtraField=>Boolean(x&&typeof x==='object'&&
   typeof x.id==='string'&&/^f_[a-z0-9]{5,24}$/.test(x.id)&&
   EXTRA_SYSTEMS.includes(x.system)&&typeof x.label==='string'&&x.label.trim().length>=2&&x.label.length<=80&&
   typeof x.required==='boolean'&&typeof x.enabled==='boolean')).slice(0,20);
 }catch{return [];}
}
