import {NextResponse} from 'next/server';
import {configuredTelephony,callOverview} from '@/lib/phone-escalation';
export const runtime='nodejs'; export const dynamic='force-dynamic';
// Solo lectura. Consultar el panel nunca inicia una llamada.
export async function GET(){return NextResponse.json({providerReady:configuredTelephony(),calls:callOverview()},{headers:{'Cache-Control':'no-store'}});}
