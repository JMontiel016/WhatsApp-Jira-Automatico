import { NextRequest, NextResponse } from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';

// No se expone el QR en /status. El secreto de vinculación queda en el backend.
export async function GET(req:NextRequest){
 if(!/^(localhost|127\.0\.0\.1):3000$/.test(req.headers.get('host')||''))return NextResponse.json({connected:false,qr:null,error:'Acceso exclusivamente local'},{status:403});
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({connected:false,qr:null,error:'Conector sin configurar'});
 try{
  const response=await fetch('http://127.0.0.1:3217/pairing-qr',{headers:{'x-local-connector-secret':secret},cache:'no-store',signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw new Error('Conector HTTP '+response.status);
  const result=await response.json() as {connected:boolean;qr:string|null;phase?:string;error?:string|null};
  if(result.connected||!result.qr)return NextResponse.json({connected:result.connected,qr:null,phase:result.phase||'waiting',error:result.error||null},{headers:{'Cache-Control':'no-store'}});
  // qrcode-terminal ya es una dependencia de TicketBridge. Reutilizamos
  // su generador de matriz para no agregar paquetes ni servicios externos.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const QRCode=require('qrcode-terminal/vendor/QRCode');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Level=require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  const qr=new QRCode(-1,Level.L);
  qr.addData(result.qr);qr.make();
  const count=qr.getModuleCount(),scale=5,pad=4,size=(count+pad*2)*scale;
  let cells='';
  for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(qr.isDark(y,x))cells+=`<rect x="${(x+pad)*scale}" y="${(y+pad)*scale}" width="${scale}" height="${scale}"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="white"/><g fill="black">${cells}</g></svg>`;
  return NextResponse.json({connected:false,qr:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'),phase:result.phase||'scan',error:null},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({connected:false,qr:null,error:error instanceof Error?error.message:'Conector no disponible'},{headers:{'Cache-Control':'no-store'}});}
}
