import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {processDueCalls} from '@/lib/phone-escalation';
import {refreshJiraStatuses} from '@/lib/automation-jira-sync';
export const runtime='nodejs'; export const dynamic='force-dynamic';
// Solo el conector local con secreto tiene permiso para revisar vencimientos.
export async function POST(req:NextRequest){
 const expected=process.env.WHATSAPP_LOCAL_SECRET||'';
 const supplied=req.headers.get('x-local-connector-secret')||'';
 if(expected.length<24||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return NextResponse.json({error:'No autorizado'},{status:401});
 try{const sync=await refreshJiraStatuses();return NextResponse.json({...await processDueCalls(),jira:sync},{headers:{'Cache-Control':'no-store'}});}
 catch(error){console.error('[GUARDIA] No se pudo comprobar vencimientos:',error);return NextResponse.json({error:'No se pudo revisar las llamadas pendientes'},{status:500});}
}
