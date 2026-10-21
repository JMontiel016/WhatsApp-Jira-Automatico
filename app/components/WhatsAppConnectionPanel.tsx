'use client';

import {useCallback,useEffect,useState} from 'react';
import {AlertCircle, CheckCircle2, Clock3, Link2, LogOut, MessageCircle, RefreshCw, ShieldCheck, Smartphone, Wifi, WifiOff} from 'lucide-react';

type Status={connected:boolean;service:boolean;compatible?:boolean;accountId?:string|null;error?:string|null;diagnostic?:string|null;phase?:string;historySync?:string;startupSeconds?:number;qrAvailable?:boolean;browserActive?:boolean;browserPageOpen?:boolean;recoveryAvailable?:boolean;restartCount?:number;restartReason?:string};
type Pairing={connected:boolean;qr:string|null;phase?:string;error?:string|null};
const json=async<T,>(url:string,options?:RequestInit):Promise<T>=>{
 const response=await fetch(url,{cache:'no-store',...options});
 const result=await response.json().catch(()=>({error:'No se pudo leer la respuesta del servidor'}));
 if(!response.ok)throw new Error(result.error||`Error HTTP ${response.status}`);
 return result as T;
};
const stages:Record<string,string>={starting:'Iniciando Chromium',loading:'Cargando WhatsApp Web',authenticated:'Autenticando sesión',synchronizing:'Sincronizando cuenta',restarting:'Renovando vinculación',scan:'QR listo para escanear',waiting:'Esperando WhatsApp Web',initialization_error:'Error al iniciar WhatsApp',auth_failure:'Falló la autenticación',disconnected:'Sesión desconectada',stalled:'Inicio detenido: QR no disponible',incompatible:'Versión del conector incompatible',unavailable:'Conector fuera de línea',connected:'WhatsApp conectado'};
export default function WhatsAppConnectionPanel(){
 const [status,setStatus]=useState<Status>({connected:false,service:false});
 const [pair,setPair]=useState<Pairing|null>(null);
 const [refreshing,setRefreshing]=useState(false),[syncing,setSyncing]=useState(false),[disconnecting,setDisconnecting]=useState(false),[recovering,setRecovering]=useState(false);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 const poll=useCallback(async()=>{
   const current=await json<Status>('/api/whatsapp/status');
   setStatus(current);
   if(current.connected){setPair(null);return;}
   if(!current.service){setPair(null);return;}
   try{setPair(await json<Pairing>('/api/whatsapp/pairing-qr'));}catch(e){setPair({connected:false,qr:null,error:e instanceof Error?e.message:'No se pudo consultar el QR'});}
 },[]);
 useEffect(()=>{let active=true,working=false;const tick=async()=>{if(working||!active)return;working=true;try{await poll();}catch{if(active)setStatus({connected:false,service:false,phase:'unavailable'});}finally{working=false;}};void tick();const timer=setInterval(()=>void tick(),3000);return()=>{active=false;clearInterval(timer);};},[poll]);
 const regenerate=async()=>{if(refreshing||status.connected||!status.service)return;setRefreshing(true);setNotice('');setError('');
  try{const result=await json<{message?:string}>('/api/whatsapp/regenerate-qr',{method:'POST'});setNotice(result.message||'Solicitando un nuevo QR...');setPair(null);}
  catch(e){setError(e instanceof Error?e.message:'Error solicitando QR');}finally{setRefreshing(false);}};
 const recover=async()=>{
  if(recovering||status.connected||!status.service)return;
  if(!window.confirm('¿Recuperar vinculación de WhatsApp? Se creará un perfil NUEVO sin borrar el anterior. Tendrás que escanear otro QR; los mensajes antiguos se conservan en SQLite. Continuar solo si la conexión quedó atascada.'))return;
  setRecovering(true);setError('');setNotice('');
  try{
   const res=await json<{message?:string}>('/api/whatsapp/relink-qr',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'RECUPERAR VINCULACION'})
   });
   setNotice(res.message||'Preparando sesión nueva sin borrar la anterior.');setPair(null);
  }catch(e){setError(e instanceof Error?e.message:'No se pudo recuperar la sesión');}
  finally{setRecovering(false);}
 };
 const syncToday=async()=>{if(syncing||!status.connected)return;setSyncing(true);setNotice('');setError('');try{await json('/api/whatsapp/sync-today',{method:'POST'});setNotice('Sincronización iniciada. Consultá Conversaciones en unos segundos; no se crearán tickets por los mensajes históricos.');}catch(e){setError(e instanceof Error?e.message:'No se pudo sincronizar');}finally{setSyncing(false);}};
 const logout=async()=>{if(disconnecting||!status.connected||!window.confirm('¿Desvincular este WhatsApp? La sesión dejará de sincronizarse hasta volver a escanear un QR.'))return;setDisconnecting(true);setError('');setNotice('');try{await json('/api/whatsapp/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DESCONECTAR'})});setNotice('Cuenta desvinculada. Esperá un QR nuevo o reiniciá el conector.');await poll();}catch(e){setError(e instanceof Error?e.message:'No se pudo desvincular');}finally{setDisconnecting(false);}};
 const phase=status.connected?'connected':pair?.phase&&pair.phase!=='waiting'?pair.phase:status.phase||pair?.phase||'waiting';
 const stalled=Boolean(status.service&&!status.connected&&!pair?.qr&&((status.startupSeconds||0)>90||status.error||pair?.error));
 const problems=[status.error,pair?.error,status.diagnostic].filter((value):value is string=>Boolean(value));
 return <section className="card waConnectionCard waConnectionPro" aria-label="Vinculación WhatsApp" aria-live="polite">
   <header className="waProHeader"><div className="waProIdentity"><span className="waProLogo"><MessageCircle size={20}/></span><div><small>CANAL DE ATENCIÓN</small><h2>WhatsApp Business</h2><p>Conectá la cuenta para habilitar chats, contactos y automatizaciones.</p></div></div><span className={'waProPill '+(status.connected?'online':status.service?'waiting':'offline')}>{status.connected?<Wifi size={14}/>:<WifiOff size={14}/>} {status.connected?'Conectado':status.service?'Sin vincular':'Desconectado'}</span></header>
   <div className="waProSteps" role="status"><span className={status.service?'active':''}><span>1</span> Conector</span><span className={pair?.qr||status.connected?'active':''}><span>2</span> Vinculación</span><span className={status.connected?'active':''}><span>3</span> Sincronización</span></div>
   {status.connected?<div className="waProConnected"><div className="waProSuccess"><CheckCircle2 size={24}/><div><strong>Cuenta conectada y autenticada</strong><p>{status.accountId?'Identificador: '+status.accountId.replace(/^(\d{3})\d+/, '$1••••'):''} {status.historySync?' · Historial: '+status.historySync:''}</p></div></div><div className="waProActions"><button type="button" onClick={()=>void syncToday()} disabled={syncing} className="waProPrimary"><RefreshCw size={15} className={syncing?'waQrSpinner':''}/>{syncing?'Sincronizando…':'Sincronizar hoy'}</button><button type="button" onClick={()=>void logout()} disabled={disconnecting} className="waProDanger"><LogOut size={15}/>{disconnecting?'Desvinculando…':'Desvincular'}</button></div></div>:
   <div className="waProConnectBody"><div className="waProInstructions"><div className="waProLabel"><Smartphone size={16}/> VINCULAR EL TELÉFONO</div><h3>Escaneá el QR desde WhatsApp</h3><ol><li>Abrí WhatsApp en el teléfono de Soporte TI.</li><li>Entrá en <strong>Dispositivos vinculados</strong>.</li><li>Seleccioná <strong>Vincular dispositivo</strong> y escaneá el QR.</li></ol><div className="waProDiagnostic"><Clock3 size={16}/><div><strong>{stages[phase]||phase}</strong><span>{!status.service?'El conector no responde. Iniciá npm run whatsapp desde el proyecto.':stalled?'El inicio está demorado. Consultá el detalle y usá Renovar QR si es necesario.':pair?.qr?'El QR se renueva automáticamente cuando WhatsApp genera uno nuevo.':'Esperando que WhatsApp Web finalice el inicio.'}</span></div></div>{status.service&&!status.connected&&<div className="waProBrowser"><span>Navegador: {status.browserPageOpen?'página abierta':status.browserActive?'proceso abierto':'iniciando o sin datos'}</span><span>Tiempo de inicio: {status.startupSeconds??0} s</span><span>Reinicios: {status.restartCount??0}</span></div>}</div><div className="waProQrCard"><div className="waProQrSquare">{pair?.qr?<img src={pair.qr} alt="Código QR privado para vincular WhatsApp" width={240} height={240}/>:<div className="waProQrEmpty"><RefreshCw className={status.service?'waQrSpinner':''} size={29}/><strong>QR no disponible</strong><small>{status.service?'Esperando código de WhatsApp…':'Conector desconectado'}</small></div>}</div><span className="waProSecure"><ShieldCheck size={14}/> Solo para vincular tu cuenta</span><button type="button" className="waProPrimary" disabled={!status.service||refreshing} onClick={()=>void regenerate()}><RefreshCw size={16} className={refreshing?'waQrSpinner':''}/>{refreshing?'Renovando…':'Generar nuevo QR'}</button>
   {status.service&&(status.recoveryAvailable||stalled)&&<div className="waRecoveryActions"><p>¿No aparece el QR después de varios minutos? Podés recuperar la vinculación sin borrar tu perfil anterior.</p><button type="button" className="waProRecovery" disabled={recovering||refreshing} onClick={()=>void recover()}><ShieldCheck size={15}/>{recovering?'Preparando respaldo…':'Recuperar vinculación'}</button></div>}
   </div></div>}
   {problems.length>0&&!status.connected&&<div className="waProProblem" role="alert"><AlertCircle size={17}/><div><strong>Diagnóstico de conexión</strong>{[...new Set(problems)].map((text,i)=><p key={i}>{text}</p>)}<small>El puerto 3217 disponible no implica autenticación. No borres la carpeta de sesión para intentar solucionarlo.</small></div></div>}
   {error&&<div className="waProToast error" role="alert"><AlertCircle size={16}/>{error}</div>}{notice&&<div className="waProToast" role="status"><CheckCircle2 size={16}/>{notice}</div>}
   <footer className="waProFooter"><Link2 size={14}/> Conexión local · Solo muestra mensajes y contactos cuando WhatsApp confirma la sesión.</footer>
 </section>;
}
