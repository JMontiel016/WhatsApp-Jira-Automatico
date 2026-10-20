import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
import {linkedAccount} from '@/lib/active-account';
import {database} from '@/lib/db';
import {NextRequest,NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
type Contact={phone:string;name:string;chatId?:string;displayPhone?:string;isGroup:boolean};
function knownLocalContacts(account:string,q:string):Contact[]{
 const d=database();
 // Nunca presentar la agenda global: el teléfono debe pertenecer a los casos de ESTA cuenta.
 const rows=d.prepare(`SELECT c.phone,MAX(NULLIF(p.name,'')) AS profile_name,
 MAX(NULLIF(c.customer,'')) AS case_name,MAX(NULLIF(p.chat_id,'')) AS chat_id
 FROM cases c LEFT JOIN contact_profiles p ON p.phone=c.phone
 WHERE c.account_id=? AND c.source='whatsapp' AND c.is_group=0
 AND c.phone GLOB '[0-9]*' GROUP BY c.phone ORDER BY c.phone LIMIT 2500`).all(account) as Array<{phone:string;profile_name:string|null;case_name:string|null;chat_id:string|null}>;
 const match=q.toLocaleLowerCase('es-PY');
 return rows.filter(x=>/^\d{5,40}$/.test(x.phone)).map(x=>({
  phone:x.phone,name:x.profile_name||x.case_name||x.phone,
  ...(x.chat_id&&/^\d{5,40}@(c\.us|lid)$/.test(x.chat_id)&&x.chat_id.split('@')[0]===x.phone?{chatId:x.chat_id}:{}),
  displayPhone:x.phone,isGroup:false
 })).filter(x=>!match||`${x.name} ${x.phone}`.toLocaleLowerCase('es-PY').includes(match)).slice(0,100);
}
export async function GET(r:NextRequest){
 const q=(r.nextUrl.searchParams.get('q')||'').trim();
 if(q.length>100)return NextResponse.json({error:'Búsqueda demasiado larga'},{status:400});
 const check=await requireWhatsAppConnector();
 if(!check.ok)return NextResponse.json({error:check.error},{status:check.status});
 const account=await linkedAccount();
 if(!account)return NextResponse.json({error:'No se pudo verificar la cuenta vinculada'},{status:503});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Conector sin configurar'},{status:503});
 try{
  const res=await fetch('http://127.0.0.1:3217/contacts?q='+encodeURIComponent(q),{
   headers:{'x-local-connector-secret':secret},cache:'no-store',signal:AbortSignal.timeout(9000)
  });
  const items=await res.json();
  if(res.ok&&Array.isArray(items))return NextResponse.json(items.filter((x:{saved?:boolean})=>x.saved===true),{headers:{'Cache-Control':'no-store','X-TicketBridge-Contacts-Source':'whatsapp'}});
 }catch{/* La agenda en vivo puede demorar aun cuando llegan mensajes. */}
 return NextResponse.json({error:'La agenda de contactos guardados no está disponible. Reconectá WhatsApp y volvé a buscar.'},{status:503});
}
