import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const expected=process.env.WHATSAPP_LOCAL_SECRET||'';
 const supplied=req.headers.get('x-local-connector-secret')||'';
 if(expected.length<24||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return NextResponse.json({error:'No autorizado'},{status:401});
 const parsed=z.object({waMessageId:z.string().min(10).max(300),actorId:z.string().min(1).max(120),emoji:z.string().max(24)}).safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Datos inválidos'},{status:400});
 const {waMessageId,actorId,emoji}=parsed.data;
 const d=database();
 // Solo aceptar reacciones que pertenecen a mensajes registrados.
 if(!d.prepare("SELECT id FROM cases WHERE source='whatsapp' AND wa_message_id=? LIMIT 1").get(waMessageId))return NextResponse.json({ok:true,pending:true});
 if(emoji)d.prepare('INSERT INTO message_reactions(wa_message_id,actor_id,emoji) VALUES (?,?,?) ON CONFLICT(wa_message_id,actor_id) DO UPDATE SET emoji=excluded.emoji,updated_at=CURRENT_TIMESTAMP').run(waMessageId,actorId,emoji);
 else d.prepare('DELETE FROM message_reactions WHERE wa_message_id=? AND actor_id=?').run(waMessageId,actorId);
 return NextResponse.json({ok:true});
}
