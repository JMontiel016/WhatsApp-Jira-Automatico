import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import {z} from 'zod';
export const runtime='nodejs';
const schema=z.object({phone:z.string().regex(/^(?:[0-9]{5,40}|[0-9-]{5,50}@g\.us)$/),id:z.number().int().positive(),action:z.enum(['pin','unpin','star','unstar','note']),note:z.string().max(1200).optional()});
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Solo acceso local'},{status:403});
 const parsed=schema.safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Datos inválidos'},{status:400});
 const {id,phone,action,note}=parsed.data;
 const db=database();
 const record=db.prepare("SELECT id FROM cases WHERE id=? AND phone=? AND source='whatsapp'").get(id,phone);
 if(!record)return NextResponse.json({error:'El mensaje no corresponde a esta conversación'},{status:404});
 db.prepare('INSERT OR IGNORE INTO message_flags(message_id) VALUES (?)').run(id);
 if(action==='note')db.prepare('UPDATE message_flags SET note=? WHERE message_id=?').run((note||'').trim(),id);
 else db.prepare(`UPDATE message_flags SET ${action==='pin'||action==='unpin'?'pinned':'starred'}=? WHERE message_id=?`).run(action==='pin'||action==='star'?1:0,id);
 return NextResponse.json({ok:true,localOnly:true},{headers:{'Cache-Control':'no-store'}});
}
