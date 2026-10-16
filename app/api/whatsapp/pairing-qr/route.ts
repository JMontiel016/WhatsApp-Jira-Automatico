import { NextResponse } from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';

// Expuesto solamente a la interfaz local; el secreto jamás llega al navegador.
// El QR expira y desaparece al autenticarse la sesión.
export async function GET(){
 const secret=process.env.WHATSAPP_LOCAL_SECRET||'';
 if(secret.length<24)return NextResponse.json({connected:false,qr:null,error:'Conector no configurado'});
 try{
  const r=await fetch('http://127.0.0.1:3217/pairing-qr',{
   headers:{'x-local-connector-secret':secret},signal:AbortSignal.timeout(2500),cache:'no-store'
  });
  if(!r.ok)throw new Error('Conector HTTP '+r.status);
  const data=await r.json() as {connected:boolean;qr:string|null};
  if(data.connected||!data.qr)return NextResponse.json({connected:data.connected,qr:null},{headers:{'Cache-Control':'no-store'}});
  // Generador de matriz QR incluido en qrcode-terminal (dependencia existente).
  // No se solicita ningún servicio externo para representar los datos de vinculación.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const QRCode=require('qrcode-terminal/vendor/QRCode');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L=require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  const qr=new QRCode(-1,L.L);qr.addData(data.qr);qr.make();
  const n=qr.getModuleCount(), quiet=4, scale=5, size=(n+quiet*2)*scale;
  let cells='';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))cells+='<rect x="'+((x+quiet)*scale)+'" y="'+((y+quiet)*scale)+'" width="'+scale+'" height="'+scale+'"/>';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'"><rect width="100%" height="100%" fill="white"/><g fill="black">'+cells+'</g></svg>';
  return NextResponse.json({connected:false,qr:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({connected:false,qr:null,error:error instanceof Error?error.message:'WhatsApp no disponible'},{headers:{'Cache-Control':'no-store'}});}
}
