import {NextRequest,NextResponse} from 'next/server';
import {adminAllowed,cloudLiveAllowed} from '@/lib/cloud-security';
import {sendMeta} from '@/lib/cloud-meta';
import {cloudDb} from '@/lib/cloud-store';
import {setting} from '@/lib/automation-controls';
export const runtime='nodejs';
// Iniciar primero solo mediante plantilla APROBADA y consentimiento explícito.
// Fuera de las 24 horas, el menú interactivo libre no puede ser el primer mensaje.
export async function POST(r:NextRequest){
 if(!adminAllowed(r))return NextResponse.json({error:'Acceso denegado'},{status:401});
 if(!cloudLiveAllowed())return NextResponse.json({error:'Primero verificar coexistencia y aprobar activación'},{status:409});
 if(setting('automation_enabled')==='1')return NextResponse.json({error:'Antes desactivá el bot de whatsapp-web.js para evitar respuestas duplicadas'},{status:409});
 const data=await r.json().catch(()=>null) as {phone?:string;optInConfirmed?:boolean}|null;
 const phone=data?.phone||'';
 if(!/^\d{8,16}$/.test(phone)||data?.optInConfirmed!==true)return NextResponse.json({error:'Número válido y consentimiento documentado requeridos'},{status:400});
 const template=process.env.META_APPROVED_WELCOME_TEMPLATE||'';
 const language=process.env.META_APPROVED_TEMPLATE_LANGUAGE||'es';
 if(!/^[a-z0-9_]{3,100}$/.test(template)||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language))return NextResponse.json({error:'Configurá el nombre y el idioma de una plantilla aprobada en Meta'},{status:409});
 const db=cloudDb();db.exec('CREATE TABLE IF NOT EXISTS cloud_menu_outreach (phone TEXT PRIMARY KEY,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL)');
 const previous=db.prepare('SELECT created_at FROM cloud_menu_outreach WHERE phone=?').get(phone) as {created_at:string}|undefined;
 if(previous&&Date.now()-Date.parse(previous.created_at+'Z')<24*3600*1000)return NextResponse.json({error:'Ya se inició una conversación con ese contacto durante las últimas 24 horas'},{status:409});
 db.prepare("INSERT INTO cloud_menu_outreach(phone,status) VALUES (?,'sending') ON CONFLICT(phone) DO UPDATE SET created_at=CURRENT_TIMESTAMP,status='sending'").run(phone);
 try{
  await sendMeta(phone,{messaging_product:'whatsapp',to:phone,type:'template',template:{name:template,language:{code:language}}});
  db.prepare("UPDATE cloud_menu_outreach SET status='sent' WHERE phone=?").run(phone);
  return NextResponse.json({ok:true,templateSent:true,menuSent:false});
 }catch(e){db.prepare("UPDATE cloud_menu_outreach SET status='review' WHERE phone=?").run(phone);
  return NextResponse.json({error:e instanceof Error?e.message:'No se confirmó el envío. Revisá Meta antes de reintentar.'},{status:502});}
}
