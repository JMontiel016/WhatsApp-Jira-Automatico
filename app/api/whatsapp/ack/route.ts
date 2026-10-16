import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 const expected=process.env.WHATSAPP_LOCAL_SECRET||'';
 const supplied=request.headers.get('x-local-connector-secret')||'';
 if(expected.length<24||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return NextResponse.json({error:'No autorizado'},{status:401});
 const input=z.object({id:z.string().min(1).max(300),ack:z.number().int().min(-1).max(4)}).safeParse(await request.json().catch(()=>null));
 if(!input.success)return NextResponse.json({error:'Confirmación inválida'},{status:400});
 const d=database();const {id,ack}=input.data;
 d.prepare(`INSERT INTO message_receipts(wa_message_id,ack) VALUES(?,?)
 ON CONFLICT(wa_message_id) DO UPDATE SET ack=CASE WHEN excluded.ack>message_receipts.ack THEN excluded.ack ELSE message_receipts.ack END,updated_at=CURRENT_TIMESTAMP`).run(id,ack);
 d.prepare("UPDATE cases SET wa_ack=CASE WHEN wa_ack IS NULL OR wa_ack<? THEN ? ELSE wa_ack END WHERE source='whatsapp' AND direction='out' AND wa_message_id=?").run(ack,ack,id);
 return NextResponse.json({ok:true});
}
