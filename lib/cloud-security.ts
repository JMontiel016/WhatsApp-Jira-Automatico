import {createHmac,timingSafeEqual} from 'node:crypto';
import type {NextRequest} from 'next/server';
export function constantEqual(a:string,b:string){const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);}
export function adminAllowed(r:NextRequest){const key=process.env.TICKETBRIDGE_CLOUD_ADMIN_TOKEN||'';
 return key.length>=24&&constantEqual(r.headers.get('x-ticketbridge-admin-token')||'',key);
}
export function cloudLiveAllowed(){return process.env.TICKETBRIDGE_CLOUD_ENABLED==='true'&&process.env.TICKETBRIDGE_CLOUD_AUTOMATION_ENABLED==='true'&&process.env.TICKETBRIDGE_CLOUD_COEXISTENCE_VERIFIED==='true'&&process.env.TICKETBRIDGE_CLOUD_ROUTING_APPROVED==='true';}
export function signatureValid(raw:string,header:string|null){const secret=process.env.META_APP_SECRET||'';
 if(secret.length<16||!header?.startsWith('sha256='))return false;
 const digest='sha256='+createHmac('sha256',secret).update(raw,'utf8').digest('hex');return constantEqual(digest,header);
}
