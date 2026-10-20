import {listMessage,buttons,CloudConfig,OutputMessage} from './cloud-menu';
export async function sendMeta(to:string,payload:unknown){
 if(!/^\d{8,16}$/.test(to))throw new Error('Destinatario inválido');
 const token=process.env.META_WHATSAPP_ACCESS_TOKEN||'';
 const number=process.env.META_WHATSAPP_PHONE_NUMBER_ID||'';
 const version=process.env.META_GRAPH_VERSION||'v23.0';
 if(!token||!/^\d{6,25}$/.test(number)||!/^v\d+\.\d+$/.test(version))throw new Error('Credenciales Meta no configuradas');
 const res=await fetch(`https://graph.facebook.com/${version}/${number}/messages`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw new Error(`Meta HTTP ${res.status}: revisá la configuración o la ventana de conversación`);
 return await res.json() as unknown;
}
export async function deliverCloudMessage(to:string,c:CloudConfig,out:OutputMessage){
 if(out.kind==='menu')return sendMeta(to,listMessage(c,to));
 if(out.kind==='buttons')return sendMeta(to,buttons(c,to));
 if(out.kind==='text')return sendMeta(to,{messaging_product:'whatsapp',to,type:'text',text:{body:out.text}});
 throw new Error('Mensaje no permitido');
}
