import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {rejectCrossOrigin} from '@/lib/security';
import fs from 'node:fs';
import path from 'node:path';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const denied=rejectCrossOrigin(req);if(denied)return denied;
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({error:'Acceso local requerido'},{status:403});
 const data=await req.json().catch(()=>null);
 if(!data||!(/^[0-9]{5,40}$/.test(data.phone||'')||/^[0-9-]{5,50}@g\.us$/.test(data.phone||''))||!Number.isSafeInteger(data.id)||data.id<=0)return NextResponse.json({error:'Datos inválidos'},{status:400});
 const db=database();
 const row=db.prepare("SELECT media_path,media_source FROM cases WHERE id=? AND phone=? AND source='whatsapp'").get(data.id,data.phone) as {media_path:string|null;media_source:string}|undefined;
 if(!row)return NextResponse.json({error:'Mensaje inexistente'},{status:404});
 if(row.media_source!=='manual'||!row.media_path)return NextResponse.json({error:'Solo se pueden quitar evidencias cargadas manualmente'},{status:409});
 const attached=db.prepare(`SELECT COUNT(*) as n FROM customer_ticket_messages ctm
    INNER JOIN customer_jira_tickets t ON t.id=ctm.ticket_id
    WHERE ctm.message_id=? AND t.status='created'`).get(data.id) as {n:number};
 if(attached.n>0)return NextResponse.json({error:'Esta evidencia ya se asoció a un ticket creado; quitá el archivo desde Jira si corresponde.'},{status:409});
 const previous=path.basename(row.media_path);
 db.prepare("UPDATE cases SET media_path=NULL,media_type=NULL,media_name=NULL,media_source='whatsapp' WHERE id=? AND phone=? AND media_source='manual'").run(data.id,data.phone);
 const reused=db.prepare('SELECT COUNT(*) as n FROM cases WHERE media_path=?').get(previous) as {n:number};
 if(reused.n===0)try{fs.unlinkSync(path.join(process.cwd(),'data','media',previous));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')console.warn('[MEDIA] No se pudo borrar archivo huérfano');}
 return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
