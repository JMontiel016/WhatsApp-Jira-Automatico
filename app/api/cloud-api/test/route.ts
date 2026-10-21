import {NextRequest,NextResponse} from 'next/server';
import {adminAllowed} from '@/lib/cloud-security';
import {advance,validateConfig,newState,CloudState,CloudEvent} from '@/lib/cloud-menu';
export const runtime='nodejs';
export async function POST(r:NextRequest){if(!adminAllowed(r))return NextResponse.json({error:'Acceso denegado'},{status:401});
 try{const b=await r.json() as {config:unknown;state?:CloudState;event:CloudEvent};const c=validateConfig(b.config);const x=advance(c,b.state||newState(),b.event);
 return NextResponse.json({...x,simulation:true,jiraCreated:false,sentToWhatsapp:false});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Simulación inválida'},{status:400});}}
