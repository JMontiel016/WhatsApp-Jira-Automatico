import {DateTime} from 'luxon';
import {database} from '@/lib/db';
import type {Roster} from '@/app/api/support-roster/route';

// Avisos internos independientes del éxito de Jira. En caso de error, nunca
// vuelve a crear tickets; el operador puede revisar el log y Mattermost.
export async function notifySupportRoster(key:string,title:string){
 const webhook=process.env.MATTERMOST_WEBHOOK_URL||'';
 if(!webhook)return; // Configuración opt-in; no se envían datos a un destino desconocido.
 if(!/^https:\/\//.test(webhook))return;
 try{
  const saved=database().prepare("SELECT value FROM settings WHERE name='support_roster_v1'").get() as {value:string}|undefined;
  if(!saved)return;
  const roster=JSON.parse(saved.value) as Roster;
  const now=DateTime.now().setZone('America/Asuncion');
  const day=roster.schedule[now.weekday-1];
  const clock=now.toFormat('HH:mm');
  const lunch=day?.enabled&&day.lunchEnabled&&clock>=day.lunchStart&&clock<day.lunchEnd;
  const inside=day?.enabled&&clock>=day.start&&clock<day.end;
  const slot=roster[lunch&&roster.lunchCoverage==='guard'?'guard':inside?'work':'guard'];
  if(!slot?.enabled)return;
  const people=[...slot.level1,...slot.level2,...slot.manager].filter(p=>p.active&&p.notifyMattermost&&p.mattermost.trim());
  if(!people.length)return;
  let chosen=people;
  if(slot.distribution==='random')chosen=[people[Math.floor(Math.random()*people.length)]];
  if(slot.distribution==='weighted'){
   const sum=people.reduce((n,p)=>n+p.weight,0);
   if(sum<=0)return;
   let n=Math.random()*sum;
   chosen=[people.find(p=>(n-=p.weight)<0)||people.at(-1)!];
  }
  if(slot.distribution==='round'){
   const db=database();
   db.exec('CREATE TABLE IF NOT EXISTS support_roster_rotation (slot TEXT PRIMARY KEY, next_index INTEGER NOT NULL DEFAULT 0)');
   const type=inside&&!lunch?'work':'guard';
   const index=(db.prepare('SELECT next_index FROM support_roster_rotation WHERE slot=?').get(type) as {next_index:number}|undefined)?.next_index||0;
   chosen=[people[index%people.length]];
   db.prepare('INSERT INTO support_roster_rotation(slot,next_index) VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET next_index=excluded.next_index').run(type,index+1);
  }
  // Manual = todos los integrantes activos con Mattermost habilitado; no se elige uno automáticamente.
  const mention=chosen.map(p=>'@'+p.mattermost.replace(/^@/,'').replace(/[^a-zA-Z0-9._-]/g,'')).filter(x=>x.length>1).join(' ');
  const base=(process.env.JIRA_BASE_URL||'').replace(/\/$/,'');
  const text=`Soporte TI · Ticket ${key}\n${mention}\n${title.slice(0,160)}\n${base}/browse/${key}`;
  const r=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(6000)});
  if(!r.ok)console.warn('[SOPORTE] Mattermost no confirmó aviso:',r.status,key);
 }catch(e){console.warn('[SOPORTE] No se pudo notificar Mattermost:',e instanceof Error?e.message:'error');}
}
