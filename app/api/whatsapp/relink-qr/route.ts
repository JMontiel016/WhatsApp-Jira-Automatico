import { NextRequest, NextResponse } from 'next/server';
import { rejectCrossOrigin } from '@/lib/security';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const denied = rejectCrossOrigin(request); if(denied) return denied;
  if(!/^(localhost|127\.0\.0\.1):3000$/.test(request.headers.get('host')||''))
    return NextResponse.json({error:'Solo acceso local'},{status:403});
  const body = await request.json().catch(() => null);
  if(body?.confirm !== 'RECUPERAR VINCULACION')
    return NextResponse.json({error:'Se requiere confirmación explícita'},{status:400});
  const secret = process.env.WHATSAPP_LOCAL_SECRET || '';
  if(secret.length < 24) return NextResponse.json({error:'Conector sin configurar'},{status:503});
  try {
    const response = await fetch('http://127.0.0.1:3217/relink-qr',{
      method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':secret},
      body:JSON.stringify({confirm:'RECUPERAR VINCULACION'}),
      cache:'no-store',signal:AbortSignal.timeout(6500)
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Conector sin respuesta. Ejecutá npm run whatsapp desde el proyecto.'},{status:503});
  }
}
