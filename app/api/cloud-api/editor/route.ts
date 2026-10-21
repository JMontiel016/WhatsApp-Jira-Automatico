import {NextRequest,NextResponse} from 'next/server';
import {adminAllowed,cloudLiveAllowed} from '@/lib/cloud-security';
import {getConfig,saveConfig} from '@/lib/cloud-store';
export const runtime='nodejs';
export async function GET(r:NextRequest){if(!adminAllowed(r))return NextResponse.json({error:'Acceso denegado'},{status:401});
 return NextResponse.json({config:getConfig(),enabled:cloudLiveAllowed(),eligibilityVerified:process.env.TICKETBRIDGE_CLOUD_COEXISTENCE_VERIFIED==='true'});
}
export async function PUT(r:NextRequest){if(!adminAllowed(r))return NextResponse.json({error:'Acceso denegado'},{status:401});
 try{return NextResponse.json({ok:true,config:saveConfig(await r.json())});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Configuración inválida'},{status:400});}}
