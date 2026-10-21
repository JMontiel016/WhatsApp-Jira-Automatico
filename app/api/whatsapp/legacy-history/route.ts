import {NextRequest,NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {linkedAccount} from '@/lib/active-account';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){const account=await linkedAccount();if(!account)return NextResponse.json({connected:false,count:0});
 const d=database();const count=(d.prepare("SELECT COUNT(*) AS n FROM cases WHERE source='whatsapp' AND account_id=''").get() as {n:number}).n;
 return NextResponse.json({connected:true,count},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:NextRequest){const denied=rejectCrossOrigin(req);if(denied)return denied;
 const account=await linkedAccount();if(!account)return NextResponse.json({error:'Vinculá WhatsApp antes de asociar mensajes'},{status:409});
 const raw=await req.json().catch(()=>null);if(raw?.confirm!=='ASOCIAR_HISTORIAL')return NextResponse.json({error:'Confirmación requerida'},{status:400});
 const d=database();const prior=d.prepare("SELECT value FROM settings WHERE name='legacy_history_account'").get() as {value:string}|undefined;
 if(prior && prior.value!==account)return NextResponse.json({error:'Este historial ya fue asociado a otro número de WhatsApp'},{status:409});
 const tx=d.transaction(()=>{const count=d.prepare("UPDATE cases SET account_id=? WHERE source='whatsapp' AND account_id=''").run(account).changes;
 d.prepare("INSERT INTO settings(name,value) VALUES('legacy_history_account',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(account);return count;});
 return NextResponse.json({ok:true,associated:tx()});}
