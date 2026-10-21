import {NextRequest,NextResponse} from 'next/server';
import {linkedAccount} from '@/lib/active-account';
import {database} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 const account=await linkedAccount();
 if(!account)return NextResponse.json({error:'Primero conectá WhatsApp'}, {status:503});
 const phone=(req.nextUrl.searchParams.get('phone')||'').replace(/[^0-9]/g,'');
 if(!/^\d{5,40}$/.test(phone))return NextResponse.json({error:'Indicá un número válido'}, {status:400});
 const found=database().prepare('SELECT is_saved,checked_at FROM automation_saved_contacts WHERE account_id=? AND phone=?').get(account,phone) as {is_saved:number;checked_at:string}|undefined;
 const recent=found && Number.isFinite(Date.parse(found.checked_at+'Z')) && Date.now()-Date.parse(found.checked_at+'Z')<30*86400000;
 return NextResponse.json({saved:recent?found!.is_saved===1:null,checkedAt:found?.checked_at||null,source:recent?'whatsapp':'unknown',note:recent?'Comprobado por WhatsApp al recibir un mensaje de este contacto':'Todavía no confirmado con un mensaje reciente; no se infiere por el nombre del chat'}, {headers:{'Cache-Control':'no-store'}});
}
