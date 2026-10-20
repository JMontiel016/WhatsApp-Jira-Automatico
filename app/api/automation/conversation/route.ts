import {NextRequest,NextResponse} from 'next/server';
import {linkedAccount} from '@/lib/active-account';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';
const phoneRegex=/^\d{5,40}$/;
function db(){const d=database();d.exec('CREATE TABLE IF NOT EXISTS automation_paused (account_id TEXT NOT NULL, phone TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 0, force_enabled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,phone))');const cols=d.prepare('PRAGMA table_info(automation_paused)').all() as Array<{name:string}>;if(!cols.some(c=>c.name==='force_enabled'))d.exec('ALTER TABLE automation_paused ADD COLUMN force_enabled INTEGER NOT NULL DEFAULT 0');return d;}
export async function GET(req:NextRequest){
 const phone=req.nextUrl.searchParams.get('phone')||'';if(!phoneRegex.test(phone))return NextResponse.json({error:'Número inválido'},{status:400});
 const account=await linkedAccount();if(!account)return NextResponse.json({error:'Conectá WhatsApp'},{status:503});
 const row=db().prepare('SELECT paused,force_enabled FROM automation_paused WHERE account_id=? AND phone=?').get(account,phone) as {paused:number;force_enabled:number}|undefined;
 return NextResponse.json({paused:row?.paused===1,forceEnabled:row?.force_enabled===1});
}
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 const parsed=z.object({phone:z.string().regex(phoneRegex),paused:z.boolean(),forceEnabled:z.boolean()}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Datos inválidos'},{status:400});
 const account=await linkedAccount();if(!account)return NextResponse.json({error:'WhatsApp desconectado'},{status:503});
 const v=parsed.data;
 db().prepare('INSERT INTO automation_paused(account_id,phone,paused,force_enabled) VALUES (?,?,?,?) ON CONFLICT(account_id,phone) DO UPDATE SET paused=excluded.paused,force_enabled=excluded.force_enabled').run(account,v.phone,v.paused?1:0,v.forceEnabled?1:0);
 return NextResponse.json({ok:true});
}
