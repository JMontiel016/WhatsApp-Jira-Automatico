import {database} from '@/lib/db';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export type DownloadedMedia={mime:string;filename?:string;data:string};

const types:Record<string,string>={
 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif',
 'application/pdf':'pdf','audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a',
 'video/mp4':'mp4','text/plain':'txt','text/csv':'csv','application/json':'json',
 'application/xml':'xml','text/xml':'xml','application/zip':'zip',
 'application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
 'application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
 'application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'
};

const isPng=(b:Buffer)=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
const isJpeg=(b:Buffer)=>b.subarray(0,3).equals(Buffer.from([255,216,255]));
const isWebp=(b:Buffer)=>b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
const isGif=(b:Buffer)=>['GIF87a','GIF89a'].includes(b.subarray(0,6).toString());
const isAvif=(b:Buffer)=>b.subarray(4,8).toString()==='ftyp'&&['avif','avis'].includes(b.subarray(8,12).toString());

// Identificar los formatos por sus bytes: WhatsApp puede anunciar JPEG
// y enviar WebP, o enviar image/jpeg con un tipo genérico.
export function mediaMime(mime:string,bytes:Buffer):string {
 if(isJpeg(bytes))return 'image/jpeg';
 if(isPng(bytes))return 'image/png';
 if(isWebp(bytes))return 'image/webp';
 if(isGif(bytes))return 'image/gif';
 if(isAvif(bytes))return 'image/avif';
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(bytes.subarray(0,4).toString()==='OggS')return 'audio/ogg';
 const declared=String(mime||'').split(';')[0].toLowerCase().trim();
 if(declared.startsWith('image/')||declared==='application/pdf')
   throw new Error('La imagen o el PDF no coincide con los bytes recibidos');
 // Verificación mínima de contenido: impedir archivos ejecutables renombrados.
 const zip=bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));
 const ole=bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
 if(['application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(declared)&&!zip)
   throw new Error('El documento ZIP/Office no tiene una cabecera ZIP válida');
 if(['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(declared)&&!ole)
   throw new Error('El archivo Office antiguo no tiene una cabecera OLE válida');
 if(['text/plain','text/csv'].includes(declared)&&(bytes.includes(0)||bytes.subarray(0,256).toString('utf8').trimStart().startsWith('<')))
   throw new Error('Archivo de texto no válido');
 if(declared==='video/mp4'||declared==='audio/mp4') {
   if(bytes.subarray(4,8).toString()!=='ftyp')throw new Error('Archivo MP4 inválido');
 }
 // Rechazar SVG y HTML. Su contenido activo no debe servirse como evidencia.
 if(!types[declared])throw new Error('Tipo de archivo no compatible: '+declared.slice(0,100));
 return declared;
}

type Row={id:number;media_path:string|null;media_type:string|null;media_name:string|null;media_source:string|null};
export function saveRecoveredMedia(id:number,media:DownloadedMedia,origin:'whatsapp'|'manual'='whatsapp') {
 if(!Number.isSafeInteger(id)||id<=0)throw new Error('ID de mensaje inválido');
 if(typeof media?.data!=='string'||!media.data.length||media.data.length>17_000_000)
   throw new Error('Adjunto vacío o demasiado grande');
 const d=database();
 const row=d.prepare("SELECT id,media_path,media_type,media_name,media_source FROM cases WHERE id=? AND source='whatsapp'").get(id) as Row|undefined;
 if(!row)throw new Error('No existe el mensaje de WhatsApp que contiene el adjunto');
 const dir=path.join(process.cwd(),'data','media');
 const previous=row.media_path?path.join(dir,path.basename(row.media_path)):null;
 // No sobrescribir evidencia válida con reintentos idénticos. Tampoco sustituir
 // las capturas cargadas manualmente sin que la persona lo indique.
 if(origin==='whatsapp'&&previous&&fs.existsSync(previous)&&fs.statSync(previous).size>0) {
   return {filename:row.media_name||path.basename(previous),mime:row.media_type||'application/octet-stream',already:true};
 }
 const bytes=Buffer.from(media.data,'base64');
 if(!bytes.length||bytes.length>12*1024*1024)throw new Error('El archivo supera el límite de 12 MB o está vacío');
 const mime=mediaMime(media.mime,bytes);
 const ext=types[mime];
 const filename=createHash('sha256').update(`whatsapp-media:${id}:`).update(bytes).digest('hex')+'.'+ext;
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const destination=path.join(dir,filename);
 try {fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});}
 catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 if(fs.statSync(destination).size!==bytes.length)throw new Error('No se pudo verificar el archivo guardado');
 let safeName=String(media.filename||'archivo.'+ext).replace(/[\r\n\\/"\x00-\x1f]/g,' ').trim().slice(0,160);
 if(!safeName)safeName='archivo.'+ext;
 if(!(new RegExp('\\.'+ext+'$','i').test(safeName)||(ext==='jpg'&&/\.jpeg$/i.test(safeName)))) {
   safeName=safeName.replace(/\.(jpeg|jpg|png|webp|gif|avif)$/i,'')+'.'+ext;
 }
 const updated=d.prepare("UPDATE cases SET media_path=?,media_type=?,media_name=?,media_source=?,has_media=1,media_error=NULL WHERE id=? AND source='whatsapp'").run(filename,mime,safeName,origin,id);
 if(updated.changes!==1)throw new Error('No se pudo asociar el adjunto al mensaje original');
 console.log('[MEDIA] Archivo guardado:',{caseId:id,mime,bytes:bytes.length,source:origin});
 return {filename:safeName,mime,already:false};
}
