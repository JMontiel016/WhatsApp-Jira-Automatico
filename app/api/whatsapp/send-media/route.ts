import {NextRequest,NextResponse} from 'next/server';
import {mediaMime} from '@/lib/media';
import {database} from '@/lib/db';
import {linkedAccount} from '@/lib/active-account';
import {markManualOutreach} from '@/lib/automation-controls';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';

const PHONE=/^(?:[0-9]{5,40}|[0-9-]{5,50}@g\.us)$/;
const JID=/^(?:[0-9]{5,40}@(c\.us|lid)|[0-9-]{5,50}@g\.us)$/;
const MAX_FILE=12*1024*1024;
const ALLOWED=new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','application/pdf','text/plain','text/csv','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const EXT:Record<string,string>={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',zip:'application/zip',txt:'text/plain',csv:'text/csv',mp4:'video/mp4'};

export async function POST(request:NextRequest){
  const denied=rejectCrossOrigin(request);if(denied)return denied;
  if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))
    return NextResponse.json({error:'Esta función solo se utiliza localmente'},{status:403});
  const expectedLength=Number(request.headers.get('content-length')||0);
  if(expectedLength>17_300_000)
    return NextResponse.json({error:'El archivo supera el límite permitido'},{status:413});
  if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    return NextResponse.json({error:'Se requiere un archivo adjunto'},{status:415});
  let form:FormData;
  try{form=await request.formData();}
  catch{return NextResponse.json({error:'No se pudo leer el archivo adjunto'},{status:400});}
  const phone=form.get('phone');
  const rawChat=form.get('chatId');
  const caption=form.get('caption');
  const file=form.get('file');
  const replyIdRaw=form.get('replyToId');
  const replyToId=typeof replyIdRaw==='string'&&/^[1-9]\d{0,10}$/.test(replyIdRaw)?Number(replyIdRaw):undefined;
  if(typeof phone!=='string'||!PHONE.test(phone)||
     (rawChat!==null && (typeof rawChat!=='string'||!JID.test(rawChat)||
       (phone.endsWith('@g.us') ? rawChat!==phone : rawChat.split('@')[0]!==phone)))||
     (caption!==null && (typeof caption!=='string'||caption.length>3000))||
     !(file instanceof File)||
     (replyIdRaw!==null&&!replyToId))
    return NextResponse.json({error:'Datos de envío inválidos'},{status:400});
  if(file.size<1||file.size>MAX_FILE)
    return NextResponse.json({error:'El archivo debe tener hasta 12 MB'},{status:413});
  const bytes=Buffer.from(await file.arrayBuffer());
  const declaredMime=((file.type&&file.type!=='application/octet-stream'?file.type:'')||EXT[file.name.split('.').pop()?.toLowerCase()||'']||'').split(';')[0].toLowerCase();
  if(!ALLOWED.has(declaredMime))return NextResponse.json({error:'Tipo de archivo no admitido'},{status:415});
  let verifiedMime='';
  try{verifiedMime=mediaMime(declaredMime,bytes);}catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Archivo inválido'},{status:400});
  }
  if(!ALLOWED.has(verifiedMime))return NextResponse.json({error:'Formato de archivo no admitido'},{status:415});
  if(declaredMime!==verifiedMime&&(!declaredMime.startsWith('image/')||!verifiedMime.startsWith('image/')))
    return NextResponse.json({error:'El tipo de archivo declarado no coincide con su contenido'},{status:415});
  if(/\.(?:html?|svg|js|exe|sh|bat|cmd)$/i.test(file.name))
    return NextResponse.json({error:'Extensión no admitida'},{status:415});
  const quote=replyToId?database().prepare("SELECT wa_message_id FROM cases WHERE source='whatsapp' AND phone=? AND id=?").get(phone,replyToId) as {wa_message_id:string|null}|undefined:undefined;
  if(replyToId&&(!quote?.wa_message_id||quote.wa_message_id.startsWith('fallback-')))return NextResponse.json({error:'El mensaje original no tiene un identificador válido para citarlo'},{status:409});
  const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
  if(secret.length<24)return NextResponse.json({error:'Conector de WhatsApp sin configurar'},{status:503});
  try{
    const response=await fetch('http://127.0.0.1:3217/send-media',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-local-connector-secret':secret},
      body:JSON.stringify({phone,
        chatId:typeof rawChat==='string'?rawChat:undefined,
        caption:typeof caption==='string'?caption:'',quotedMessageId:quote?.wa_message_id||undefined,
        attachment:{mime:verifiedMime,filename:file.name.slice(0,150)||'archivo',data:bytes.toString('base64')}
      }),
      signal:AbortSignal.timeout(65000),cache:'no-store'
    });
    const data=await response.json().catch(()=>({error:'El conector no devolvió JSON'})) as
      {sent?:boolean;id?:string;mediaSaved?:boolean;warning?:string;error?:string};
    if(!response.ok)return NextResponse.json({error:data.error||`WhatsApp rechazó el archivo (HTTP ${response.status})`},{status:response.status});
    if(data.sent!==true)return NextResponse.json({error:'WhatsApp no confirmó el envío; revisá el chat antes de reintentar'},{status:502});
    if(!phone.endsWith('@g.us')){
      try{const account=await linkedAccount();if(account)markManualOutreach(account,phone);}catch(error){console.warn('[BOT] No se pudo registrar atención humana:',error);}
    }
    return NextResponse.json({sent:true,id:data.id,mediaSaved:data.mediaSaved===true,warning:data.warning||null},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const timedOut=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');
    return NextResponse.json({error:timedOut?
      'El envío demoró demasiado. Revisá el chat antes de volver a enviarlo para evitar duplicados.':
      'El conector local no respondió. Revisá npm run whatsapp.'},{status:timedOut?504:503});
  }
}
