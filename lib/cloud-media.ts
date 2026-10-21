import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {cloudDb} from './cloud-store';
import {jiraAttach} from './jira';
const MEDIA_LIMIT=12*1024*1024;
function cfg(){const token=process.env.META_WHATSAPP_ACCESS_TOKEN||'';const version=process.env.META_GRAPH_VERSION||'v23.0';
 if(!token||!/^v\d+\.\d+$/.test(version))throw new Error('Token o versión de Meta inválidos');return {token,version};}
function safeHost(raw:string){
 const u=new URL(raw);const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||!['lookaside.fbsbx.com','mmg.whatsapp.net'].includes(h)&&!h.endsWith('.fbcdn.net')&&!h.endsWith('.fbsbx.com')&&!h.endsWith('.whatsapp.net'))throw new Error('Host multimedia no permitido');
 return u.toString();
}
async function boundedBuffer(res:Response){
 if(!res.ok||!res.body)throw new Error('Archivo multimedia no disponible');
 const reader=res.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MEDIA_LIMIT)throw new Error('Imagen demasiado grande (12 MB)');chunks.push(value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks.map(x=>Buffer.from(x)));
}
export async function saveCloudImage(phone:string,eventId:string,mediaId:string){
 if(!/^\d{5,30}$/.test(mediaId))throw new Error('Identificador multimedia inválido');
 const d=cloudDb();d.exec(`CREATE TABLE IF NOT EXISTS cloud_menu_media (
 message_id TEXT PRIMARY KEY,phone TEXT NOT NULL,filename TEXT,mime TEXT,path TEXT,
 status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_cloud_menu_media_phone ON cloud_menu_media(phone,created_at);`);
 const existing=d.prepare('SELECT status FROM cloud_menu_media WHERE message_id=?').get(eventId) as {status:string}|undefined;
 if(existing?.status==='ready')return;
 d.prepare("INSERT OR IGNORE INTO cloud_menu_media(message_id,phone,status) VALUES (?,?,'loading')").run(eventId,phone);
 try{
  const {token,version}=cfg();
  const meta=await fetch(`https://graph.facebook.com/${version}/${mediaId}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!meta.ok)throw new Error('Meta no entregó el enlace multimedia');
  const m=await meta.json() as {url?:string;mime_type?:string;file_size?:number};
  const mime=String(m.mime_type||'').split(';')[0].toLowerCase();
  const allowed:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  if(!allowed[mime])throw new Error('Tipo de imagen no permitido');
  if(Number(m.file_size)>MEDIA_LIMIT)throw new Error('Imagen mayor de 12 MB');
  const res=await fetch(safeHost(m.url||''),{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
  const data=await boundedBuffer(res);if(!data.length)throw new Error('Imagen vacía');
  const dir=path.join(process.cwd(),'data','cloud-media');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const name=createHash('sha256').update(eventId).digest('hex')+'.'+allowed[mime];
  const saved=path.join(dir,name);fs.writeFileSync(saved,data,{mode:0o600,flag:'wx'});
  d.prepare("UPDATE cloud_menu_media SET status='ready',filename=?,mime=?,path=?,error=NULL WHERE message_id=?").run(name,mime,saved,eventId);
 }catch(e){
  const message=e instanceof Error?e.message:'No se pudo descargar la imagen';
  d.prepare("UPDATE cloud_menu_media SET status='error',error=? WHERE message_id=?").run(message,eventId);
  throw new Error(message);
 }
}
export async function attachCloudImages(phone:string,jiraKey:string,startedAt:string){
 const d=cloudDb();const rows=d.prepare("SELECT message_id,filename,mime,path FROM cloud_menu_media WHERE phone=? AND status='ready' AND datetime(created_at)>=datetime(?) ORDER BY created_at DESC LIMIT 5").all(phone,startedAt) as Array<{message_id:string;filename:string;mime:string;path:string}>;
 const files: Array<{id:number;filename:string;mime:string;data:Buffer}>=[];
 for(let i=0;i<rows.length;i++){const r=rows[i];if(!r.path.startsWith(path.join(process.cwd(),'data','cloud-media')+path.sep))continue;
  if(fs.existsSync(r.path))files.push({id:i+1,filename:r.filename,mime:r.mime,data:fs.readFileSync(r.path)});
 }
 return files.length?jiraAttach(jiraKey,files):{uploaded:0,errors:[]};
}
