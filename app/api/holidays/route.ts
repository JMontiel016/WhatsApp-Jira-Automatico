import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {DateTime} from 'luxon';
export const runtime='nodejs';
export async function GET(){return NextResponse.json(database().prepare('SELECT date,name FROM holidays ORDER BY date').all());}
export async function POST(r:NextRequest){const reject=rejectCrossOrigin(r);if(reject)return reject;const p=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),name:z.string().trim().min(2).max(120)}).safeParse(await r.json().catch(()=>null));if(!p.success||!DateTime.fromISO(p.data.date).isValid)return NextResponse.json({error:'Fecha o nombre inválido'},{status:400});database().prepare('INSERT INTO holidays(date,name) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name').run(p.data.date,p.data.name);return NextResponse.json({ok:true});}
export async function DELETE(r:NextRequest){const reject=rejectCrossOrigin(r);if(reject)return reject;const p=z.object({date:z.string()}).safeParse(await r.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Fecha inválida'},{status:400});database().prepare('DELETE FROM holidays WHERE date=?').run(p.data.date);return NextResponse.json({ok:true});}
