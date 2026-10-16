import { NextRequest, NextResponse } from 'next/server';
// El servidor escucha solo en 127.0.0.1. Validación adicional contra solicitudes cross-origin.
export function rejectCrossOrigin(request:NextRequest){
  const origin=request.headers.get('origin');
  if(!origin) return null; // CLI / curl local sin Origin.
  try {
    const u=new URL(origin);
    if(['localhost','127.0.0.1'].includes(u.hostname) && u.port==='3000' && ['http:'].includes(u.protocol))return null;
  } catch { /* origen inválido */ }
  return NextResponse.json({error:'Origen no permitido'}, {status:403});
}
