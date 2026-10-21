import {NextRequest,NextResponse} from 'next/server';
import {rejectCrossOrigin} from '@/lib/security';
import {linkedAccount} from '@/lib/active-account';
import {controlDb,listStaff} from '@/lib/automation-controls';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';
const phone=z.string().regex(/^\d{5,40}$/);
const flag=z.object({phone,excluded:z.boolean(),override:z.enum(['default','enabled','disabled'])});
const staff=z.object({id:z.number().int().positive().optional(),phone,name:z.string().trim().min(1).max(120),role:z.enum(['level1','level2','manager']),active:z.boolean(),notify:z.boolean(),callEnabled:z.boolean(),followup:z.boolean(),minutes:z.number().int().min(5).max(720).nullable()});
const rows=()=>{const db=controlDb();return db;};
type ContactLookupRow = {phone:string;displayPhone?:string;name:string;isGroup:boolean};
async function connectorSearch(query:string,account:string):Promise<ContactLookupRow[]>{
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)throw Error('Conector sin credenciales');
 try{
  const r=await fetch('http://127.0.0.1:3217/contacts?q='+encodeURIComponent(query),{
   headers:{'x-local-connector-secret':secret},signal:AbortSignal.timeout(9000),cache:'no-store'
  });
  if(r.ok){const data=await r.json();if(Array.isArray(data))return data as Array<{phone:string;displayPhone?:string;name:string;isGroup:boolean}>;}
 }catch{/* La agenda puede no responder aunque la cuenta ya reciba mensajes. */}
 // Fallback parcial por cuenta. No es la agenda completa de WhatsApp.
 const text=query.trim().toLocaleLowerCase('es-PY');
 const rows=rowsDbLocal(account);
 return rows.filter(x=>`${x.name} ${x.phone}`.toLocaleLowerCase('es-PY').includes(text)).slice(0,25);
}
function rowsDbLocal(account:string){
 const d=rows();
 const saved=d.prepare(`SELECT c.phone,COALESCE(MAX(NULLIF(p.name,'')),MAX(c.customer)) AS name
 FROM cases c LEFT JOIN contact_profiles p ON p.phone=c.phone
 WHERE c.account_id=? AND c.source='whatsapp' AND c.is_group=0
 GROUP BY c.phone ORDER BY c.phone LIMIT 1000`).all(account) as Array<{phone:string;name:string}>;
 return saved.filter(x=>/^\d{5,40}$/.test(x.phone)).map(x=>({phone:x.phone,name:x.name||x.phone,isGroup:false}));
}
export async function GET(req:NextRequest){const account=await linkedAccount();if(!account)return NextResponse.json({items:[],connected:false,reason:'Vinculá WhatsApp para ver contactos y responsables de esa cuenta.'},{headers:{'Cache-Control':'no-store'}});const d=rows(),q=(req.nextUrl.searchParams.get('q')||'').trim();const kind=req.nextUrl.searchParams.get('kind');if(kind==='staff')return NextResponse.json({items:listStaff(account)},{headers:{'Cache-Control':'no-store'}});if(kind==='excluded')return NextResponse.json({items:d.prepare("SELECT r.phone,r.excluded,r.override_mode AS override,p.name FROM automation_contact_rules r LEFT JOIN contact_profiles p ON p.phone=r.phone WHERE r.account_id=? AND (r.excluded=1 OR r.override_mode<>'default') ORDER BY p.name,r.phone").all(account)},{headers:{'Cache-Control':'no-store'}});if(q.length<2)return NextResponse.json({items:[]});if(q.length>80)return NextResponse.json({error:'Búsqueda demasiado larga'},{status:400});try{const found=(await connectorSearch(q,account)).filter(x=>!x.isGroup).slice(0,25);const result=found.map(x=>{const rule=d.prepare('SELECT excluded,override_mode FROM automation_contact_rules WHERE account_id=? AND phone=?').get(account,x.phone) as {excluded:number;override_mode:string}|undefined;return {...x,excluded:rule?.excluded===1,override:rule?.override_mode||'default'};});return NextResponse.json({items:result},{headers:{'Cache-Control':'no-store'}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Error de contactos'},{status:503});}}
export async function POST(req:NextRequest){const denied=rejectCrossOrigin(req);if(denied)return denied;const account=await linkedAccount();if(!account)return NextResponse.json({error:'WhatsApp desconectado'},{status:503});const v=await req.json().catch(()=>null);const d=rows();if(v?.kind==='client'){const parsed=flag.safeParse(v);if(!parsed.success)return NextResponse.json({error:'Regla inválida'},{status:400});const x=parsed.data;d.prepare('INSERT INTO automation_contact_rules(account_id,phone,excluded,override_mode) VALUES (?,?,?,?) ON CONFLICT(account_id,phone) DO UPDATE SET excluded=excluded.excluded,override_mode=excluded.override_mode,updated_at=CURRENT_TIMESTAMP').run(account,x.phone,x.excluded?1:0,x.override);return NextResponse.json({ok:true});}if(v?.kind==='staff'){const parsed=staff.safeParse(v);if(!parsed.success)return NextResponse.json({error:'Responsable inválido'},{status:400});const x=parsed.data;let existing: {id:number;phone:string}|undefined;if(x.id)existing=d.prepare('SELECT id,phone FROM automation_support_staff WHERE account_id=? AND id=?').get(account,x.id) as {id:number;phone:string}|undefined;if(x.id&&!existing)return NextResponse.json({error:'Responsable inexistente'},{status:404});if(!existing){try{const contacts=await connectorSearch(x.phone,account);if(!contacts.some(c=>!c.isGroup&&(c.phone===x.phone||c.displayPhone===x.phone)))throw Error('El teléfono no pertenece a un contacto individual confirmado por WhatsApp');}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'No se pudo verificar el contacto'},{status:422});}}if(x.id){d.prepare('UPDATE automation_support_staff SET role=?,name=?,active=?,notify=?,call_enabled=?,followup=?,minutes=?,updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND id=?').run(x.role,x.name,x.active?1:0,x.notify?1:0,x.callEnabled?1:0,x.followup?1:0,x.minutes,account,x.id);}else{d.prepare('INSERT INTO automation_support_staff(account_id,role,phone,name,active,notify,call_enabled,followup,minutes) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,role,phone) DO UPDATE SET name=excluded.name,active=excluded.active,notify=excluded.notify,call_enabled=excluded.call_enabled,followup=excluded.followup,minutes=excluded.minutes,updated_at=CURRENT_TIMESTAMP').run(account,x.role,x.phone,x.name,x.active?1:0,x.notify?1:0,x.callEnabled?1:0,x.followup?1:0,x.minutes);}return NextResponse.json({ok:true});}return NextResponse.json({error:'Acción inválida'},{status:400});}
export async function DELETE(req:NextRequest){const denied=rejectCrossOrigin(req);if(denied)return denied;const account=await linkedAccount();if(!account)return NextResponse.json({error:'WhatsApp desconectado'},{status:503});const id=Number(req.nextUrl.searchParams.get('id'));if(!Number.isInteger(id)||id<1)return NextResponse.json({error:'ID inválido'},{status:400});rows().prepare('DELETE FROM automation_support_staff WHERE id=? AND account_id=?').run(id,account);return NextResponse.json({ok:true});}
