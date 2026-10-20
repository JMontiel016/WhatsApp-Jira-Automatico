import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {database,CaseRecord} from '@/lib/db';
import {evaluate} from '@/lib/rules';
import {rejectCrossOrigin} from '@/lib/security';
import crypto from 'node:crypto';
export const runtime='nodejs';
export async function POST(r:NextRequest){
  const denied=rejectCrossOrigin(r);if(denied)return denied;
  const schema=z.object({customer:z.string().trim().min(2).max(120),phone:z.string().trim().min(5).max(30),message:z.string().trim().min(3).max(3000),receivedAt:z.string().datetime({offset:true}),eventId:z.string().trim().max(120).optional()});
  const parsed=schema.safeParse(await r.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Datos de simulación inválidos'},{status:400});
  try{
    const v=parsed.data;const rule=evaluate(v.receivedAt);
    // Cada clic de simulación es un evento distinto; eventId permite reintentos idempotentes.
    const eventId=v.eventId||crypto.randomUUID();
    const dedupe=crypto.createHash('sha256').update('sim:'+eventId).digest('hex');
    const d=database();
    d.prepare('INSERT OR IGNORE INTO cases(phone,customer,message,received_at,local_date,local_time,reason,outside_hours,status,dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?)').run(v.phone,v.customer,v.message,v.receivedAt,rule.date,rule.hour,rule.reason,rule.outside?1:0,rule.outside?'pending':'ignored',dedupe);
    const item=d.prepare('SELECT * FROM cases WHERE dedupe_key=?').get(dedupe) as CaseRecord;
    return NextResponse.json({case:item,rule,explanation:rule.outside?'Elegible para envío manual a Jira':'Dentro del horario: no se genera ticket automático'}, {status:201});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Error inesperado'},{status:400});}
}
