import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';export const dynamic='force-dynamic';
const person=z.object({id:z.string().max(160),name:z.string().min(1).max(120),email:z.string().email().or(z.literal('')),mattermost:z.string().max(100),active:z.boolean(),weight:z.number().int().min(0).max(100),notifyMattermost:z.boolean(),notifyEmail:z.boolean()});
const slot=z.object({level1:z.array(person).max(50),level2:z.array(person).max(50),manager:z.array(person).max(50),distribution:z.enum(['random','round','weighted','manual']),enabled:z.boolean()});
const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day=z.object({enabled:z.boolean(),start:clock,end:clock,lunchEnabled:z.boolean(),lunchStart:clock,lunchEnd:clock});
const schema=z.object({work:slot,guard:slot,schedule:z.array(day).length(7),lunchCoverage:z.enum(['work','guard'])});
export type Roster=z.infer<typeof schema>;
const defaultDay=(enabled:boolean)=>({enabled,start:'08:00',end:'18:00',lunchEnabled:false,lunchStart:'12:00',lunchEnd:'13:00'});
export const initialRoster:Roster={work:{level1:[],level2:[],manager:[],distribution:'round',enabled:true},guard:{level1:[],level2:[],manager:[],distribution:'manual',enabled:true},schedule:Array.from({length:7},(_,i)=>defaultDay(i<5)),lunchCoverage:'guard'};
export async function GET(){const row=database().prepare("SELECT value FROM settings WHERE name='support_roster_v1'").get() as {value:string}|undefined;let roster=initialRoster;try{if(row)roster=schema.parse(JSON.parse(row.value));}catch{}return NextResponse.json(roster,{headers:{'Cache-Control':'no-store'}});}
export async function PUT(req:NextRequest){const denied=rejectCrossOrigin(req);if(denied)return denied;const result=schema.safeParse(await req.json().catch(()=>null));if(!result.success)return NextResponse.json({error:'Revisá los integrantes y horarios ingresados.'},{status:400});
 for(const slot of [result.data.work,result.data.guard]){const people=[...slot.level1,...slot.level2,...slot.manager].filter(p=>p.active);if(slot.distribution==='weighted'&&people.length&&people.reduce((n,p)=>n+p.weight,0)!==100)return NextResponse.json({error:'Los porcentajes activos deben sumar 100%.'},{status:400});const ids=people.map(p=>p.id).filter(Boolean);if(ids.length!==new Set(ids).size)return NextResponse.json({error:'Un usuario de Jira no puede estar dos veces en el mismo turno.'},{status:400});}
 if(result.data.schedule.some(d=>d.enabled&&(d.start>=d.end||(d.lunchEnabled&&(d.lunchStart>=d.lunchEnd||d.lunchStart<d.start||d.lunchEnd>d.end)))))return NextResponse.json({error:'Los horarios de entrada, salida o almuerzo no son válidos.'},{status:400});
 database().prepare("INSERT INTO settings(name,value) VALUES ('support_roster_v1',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(JSON.stringify(result.data));return NextResponse.json({ok:true});}
