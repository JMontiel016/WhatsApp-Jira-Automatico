import {NextResponse} from 'next/server';
import {database} from '@/lib/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 const d=database();
 // Ocultar avisos técnicos importados de versiones anteriores; no borrar registros.
 const events=d.prepare("SELECT id,phone,customer,message,received_at,local_date,local_time,reason,outside_hours,status,jira_key,source,media_path,media_type,media_name,media_error,media_source,has_media,direction,wa_message_id,wa_ack,is_group,sender_name FROM cases WHERE source='whatsapp' AND NOT (has_media=0 AND (message LIKE '[Adjunto WhatsApp: notification_template]%' OR message LIKE '[Adjunto WhatsApp: gp2]%' OR message LIKE '[Adjunto WhatsApp: notification]%' OR message LIKE '[Adjunto WhatsApp: e2e_notification]%')) ORDER BY received_at ASC,id ASC").all() as Array<Record<string,any>>;
 const rRows=d.prepare('SELECT wa_message_id,actor_id,emoji FROM message_reactions').all() as Array<{wa_message_id:string;actor_id:string;emoji:string}>;
 const reactions=new Map<string,Array<{actor_id:string;emoji:string}>>();
 for(const r of rRows){const prev=reactions.get(r.wa_message_id)||[];prev.push({actor_id:r.actor_id,emoji:r.emoji});reactions.set(r.wa_message_id,prev);}
 for(const e of events){
   const values=reactions.get(e.wa_message_id)||[];
   const grouped=new Map<string,{emoji:string;count:number;mine:boolean}>();
   for(const r of values){const curr=grouped.get(r.emoji)||{emoji:r.emoji,count:0,mine:false};curr.count++;curr.mine ||= r.actor_id==='self';grouped.set(r.emoji,curr);}
   e.reactions=[...grouped.values()];
 }
 const flags=d.prepare('SELECT message_id,pinned,starred,note FROM message_flags').all() as Array<{message_id:number;pinned:number;starred:number;note:string}>;
 const byFlag=new Map(flags.map(f=>[f.message_id,f]));
 for(const e of events){const m=byFlag.get(e.id);e.message_pinned=Boolean(m?.pinned);e.message_starred=Boolean(m?.starred);e.message_note=m?.note||'';}
 const tickets=d.prepare('SELECT * FROM conversation_tickets').all() as Array<{phone:string,jira_key:string|null,status:string,error:string|null}>;
 const history=d.prepare("SELECT * FROM customer_jira_tickets WHERE status='created' ORDER BY CAST(SUBSTR(jira_key, INSTR(jira_key, '-') + 1) AS INTEGER) DESC, id DESC").all() as Array<{id:number,phone:string,jira_key:string,title:string,kind:string,parent_key:string|null,created_at:string}>;
 const linked=d.prepare('SELECT message_id FROM customer_ticket_messages').all() as Array<{message_id:number}>;const linkedIds=new Set(linked.map(x=>x.message_id));
 // La vinculación es informativa: el operador puede volver a seleccionar una evidencia para un ticket diferente.
 for(const e of events)e.usedInTicket=linkedIds.has(e.id);
 const historyByPhone=new Map<string,typeof history>();for(const t of history){const h=historyByPhone.get(t.phone)||[];h.push(t);historyByPhone.set(t.phone,h)}
 const profiles=d.prepare('SELECT phone,name,avatar_url,is_group FROM contact_profiles').all() as Array<{phone:string,name:string|null,avatar_url:string|null,is_group:number}>;
 const profileByPhone=new Map(profiles.map(p=>[p.phone,p]));
 const prefs=d.prepare('SELECT phone,last_read_at,force_unread,remote_unread,pinned,favorite FROM chat_preferences').all() as Array<{phone:string,last_read_at:string,force_unread:number,remote_unread:number,pinned:number;favorite:number}>;
 const byPref=new Map(prefs.map(p=>[p.phone,p]));
 const map=new Map<string,{phone:string,customer:string,avatar_url:string|null,is_group:boolean,unread_count:number,marked_unread:boolean,pinned:boolean,favorite:boolean,events:typeof events,ticket:typeof tickets[number]|null,tickets:typeof history,outside:boolean}>();
 const byPhone=new Map(tickets.map(t=>[t.phone,t]));
 for(const e of events){let c=map.get(e.phone);if(!c){c={phone:e.phone,customer:profileByPhone.get(e.phone)?.name||e.customer,avatar_url:profileByPhone.get(e.phone)?.avatar_url||null,is_group:Boolean(e.is_group||profileByPhone.get(e.phone)?.is_group),unread_count:0,marked_unread:Boolean(byPref.get(e.phone)?.force_unread||byPref.get(e.phone)?.remote_unread),pinned:Boolean(byPref.get(e.phone)?.pinned),favorite:Boolean(byPref.get(e.phone)?.favorite),events:[],ticket:byPhone.get(e.phone)||null,tickets:historyByPhone.get(e.phone)||[],outside:false};map.set(e.phone,c)}c.events.push(e);if(e.direction!=='out'&&e.received_at>(byPref.get(e.phone)?.last_read_at||'1970-01-01T00:00:00.000Z'))c.unread_count++;c.outside ||= Boolean(e.outside_hours) && e.direction !== 'out';}
 // No inventar un mensaje nuevo por haber marcado manualmente como no leído.
 // La marca se representa con un punto y unread_count refleja SOLO mensajes entrantes nuevos.

 return NextResponse.json([...map.values()].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.events[b.events.length-1].received_at.localeCompare(a.events[a.events.length-1].received_at)),{headers:{'Cache-Control':'no-store'}});
}
