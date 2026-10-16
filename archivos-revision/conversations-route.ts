import {NextResponse} from 'next/server';
import {database} from '@/lib/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 const d=database();
 const events=d.prepare("SELECT id,phone,customer,message,received_at,local_date,local_time,reason,outside_hours,status,jira_key,source,media_path,media_type,media_name,media_error,media_source,has_media,direction FROM cases WHERE source='whatsapp' ORDER BY received_at ASC,id ASC").all() as Array<Record<string,any>>;
 const tickets=d.prepare('SELECT * FROM conversation_tickets').all() as Array<{phone:string,jira_key:string|null,status:string,error:string|null}>;
 const history=d.prepare("SELECT * FROM customer_jira_tickets WHERE status='created' ORDER BY id DESC").all() as Array<{id:number,phone:string,jira_key:string,title:string,kind:string,parent_key:string|null,created_at:string}>;
 const linked=d.prepare('SELECT message_id FROM customer_ticket_messages').all() as Array<{message_id:number}>;const linkedIds=new Set(linked.map(x=>x.message_id));
 for(const e of events)e.usedInTicket=linkedIds.has(e.id);
 const historyByPhone=new Map<string,typeof history>();for(const t of history){const h=historyByPhone.get(t.phone)||[];h.push(t);historyByPhone.set(t.phone,h)}
 const profiles=d.prepare('SELECT phone,name,avatar_url FROM contact_profiles').all() as Array<{phone:string,name:string|null,avatar_url:string|null}>;
 const profileByPhone=new Map(profiles.map(p=>[p.phone,p]));
 const map=new Map<string,{phone:string,customer:string,avatar_url:string|null,events:typeof events,ticket:typeof tickets[number]|null,tickets:typeof history,outside:boolean}>();
 const byPhone=new Map(tickets.map(t=>[t.phone,t]));
 for(const e of events){let c=map.get(e.phone);if(!c){c={phone:e.phone,customer:profileByPhone.get(e.phone)?.name||e.customer,avatar_url:profileByPhone.get(e.phone)?.avatar_url||null,events:[],ticket:byPhone.get(e.phone)||null,tickets:historyByPhone.get(e.phone)||[],outside:false};map.set(e.phone,c)}c.events.push(e);c.outside ||= Boolean(e.outside_hours) && e.direction !== 'out';}
 return NextResponse.json([...map.values()].sort((a,b)=>b.events[b.events.length-1].received_at.localeCompare(a.events[a.events.length-1].received_at)),{headers:{'Cache-Control':'no-store'}});
}
