import {NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {requireWhatsAppConnector} from '@/lib/whatsapp-version';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(){
 const check=await requireWhatsAppConnector();
 if(!check.ok)return NextResponse.json({ok:false,skipped:true,reason:check.error},{headers:{'Cache-Control':'no-store'}});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({error:'Falta el secreto del conector'},{status:503});
 try{
  const res=await fetch('http://127.0.0.1:3217/read-snapshot',{headers:{'x-local-connector-secret':secret},cache:'no-store',signal:AbortSignal.timeout(14000)});
  const result=await res.json() as {chats?:Array<{phone:string;unreadCount:number;lastOutgoingAt?:number|null}>;error?:string};
  if(!res.ok||!Array.isArray(result.chats))return NextResponse.json({ok:false,skipped:true,reason:result.error||'La lectura remota no está disponible. Los chats locales siguen disponibles.'},{headers:{'Cache-Control':'no-store'}});
  const d=database();
  const latest=d.prepare("SELECT MAX(received_at) AS last_date FROM cases WHERE source='whatsapp' AND phone=? AND direction='in'");
  const unreadLocal=d.prepare("SELECT COUNT(*) AS amount FROM cases WHERE source='whatsapp' AND phone=? AND direction='in' AND received_at>?");
  const pref=d.prepare('SELECT last_read_at,force_unread,force_unread_at FROM chat_preferences WHERE phone=?');
  const clearLocalRead=d.prepare("UPDATE chat_preferences SET force_unread=0,force_unread_at='' WHERE phone=?");
  const setRead=d.prepare(`INSERT INTO chat_preferences(phone,last_read_at,force_unread,remote_unread)
    VALUES (?,?,0,0) ON CONFLICT(phone) DO UPDATE SET
    last_read_at=CASE WHEN chat_preferences.force_unread=0 AND excluded.last_read_at>chat_preferences.last_read_at THEN excluded.last_read_at ELSE chat_preferences.last_read_at END,
    remote_unread=0`);
  const setRemote=d.prepare(`INSERT INTO chat_preferences(phone,remote_unread) VALUES (?,?)
    ON CONFLICT(phone) DO UPDATE SET remote_unread=excluded.remote_unread`);
  const update=d.transaction((chats:typeof result.chats)=>{
   for(const c of chats){
    if(typeof c.phone!=='string'||!(/^\d{5,40}$/.test(c.phone)||/^[0-9-]{5,50}@g\.us$/.test(c.phone)))continue;
    if(!Number.isInteger(c.unreadCount))continue;
    const row=latest.get(c.phone) as {last_date:string|null}|undefined;
    if(c.unreadCount===0){
      const previous=pref.get(c.phone) as {force_unread:number;force_unread_at:string}|undefined;
      // Una respuesta posterior desde WhatsApp indica que la marca manual ya fue atendida.
      if(previous?.force_unread&&previous.force_unread_at&&Number(c.lastOutgoingAt)*1000>Date.parse(previous.force_unread_at))clearLocalRead.run(c.phone);
      if(row?.last_date)setRead.run(c.phone,row.last_date);else setRemote.run(c.phone,0);continue;}
    // -1 indica marca manual sin una cantidad comprobable de mensajes nuevos.
    if(c.unreadCount===-1){
      if(row?.last_date)setRead.run(c.phone,row.last_date);
      setRemote.run(c.phone,1);
      continue;
    }
    const preference=pref.get(c.phone) as {last_read_at:string;force_unread:number}|undefined;
    const newCount=(unreadLocal.get(c.phone,preference?.last_read_at||'1970-01-01T00:00:00.000Z') as {amount:number}).amount;
    // Si WhatsApp señala no leído pero no hay eventos nuevos locales, mostrar punto, no número.
    setRemote.run(c.phone,c.unreadCount<0||newCount===0?1:0);
   }
  });
  update(result.chats);
  return NextResponse.json({ok:true,synced:result.chats.length},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({ok:false,skipped:true,reason:e instanceof Error?e.message:'No fue posible leer los vistos remotos'},{headers:{'Cache-Control':'no-store'}});}
}
