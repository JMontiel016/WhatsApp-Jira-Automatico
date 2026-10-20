import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';
/** Compatibilidad: no permitir registrar ni avanzar encuestas antiguas.
 * TicketWhatsapp utiliza exclusivamente mensajes numerados (1 a 4). */
function allowed(req:NextRequest){
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 const provided=req.headers.get('x-local-connector-secret')||'';
 return secret.length>=24&&secret.length===provided.length&&timingSafeEqual(Buffer.from(secret),Buffer.from(provided));
}
export async function GET(req:NextRequest){
 if(!allowed(req))return NextResponse.json({error:'No autorizado'},{status:401});
 return NextResponse.json({pending:[],retired:true});
}
export async function POST(req:NextRequest){
 if(!allowed(req))return NextResponse.json({error:'No autorizado'},{status:401});
 return NextResponse.json({ok:false,ignored:true,retired:true,reason:'El menú utiliza respuestas 1 a 4, sin encuestas.'});
}
