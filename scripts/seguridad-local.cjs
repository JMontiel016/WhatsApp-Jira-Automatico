#!/usr/bin/env node
'use strict';
/* W-Ticket / defensa de publicación. Sin dependencias externas. */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const red = m => process.stderr.write(m + '\n');
const log = m => process.stdout.write(m + '\n');
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

function runGit(args, options={}) {
 return cp.execFileSync('git', args, {cwd:root, encoding:'utf8', maxBuffer:16*1024*1024, ...options});
}
function getGitRoot() {
 try{return path.resolve(runGit(['rev-parse','--show-toplevel']).trim())}
 catch{return null}
}
function normalized(name) { return String(name||'').replace(/\\/g,'/').replace(/^\.\//,''); }
function blockedPath(input) {
 const p=normalized(input), segments=p.split('/');
 if (!p || p.startsWith('/') || segments.includes('..')) return true;
 if (segments.some(x=>['node_modules','.next','.git','data','.wwebjs_auth','.wwebjs_cache','.ticketbridge-backups','.vercel'].includes(x)))return true;
 const name=segments[segments.length-1];
 if (name==='.env.example' || /^\.env\.[A-Za-z0-9_-]+\.example$/.test(name))return false;
 if (name==='.env' || name.startsWith('.env.') || /\.env(?:\.|$)/i.test(name))return true;
 if (['.npmrc','.pypirc','credentials.json'].includes(name.toLowerCase()))return true;
 if (/^(?:service[-_]account|client_secret)/i.test(name))return true;
 if (/^(?:id_rsa|id_ed25519)/i.test(name))return true;
 if (/(?:\.sqlite(?:3|-wal|-shm)?|\.db(?:-wal|-shm)?|\.pem|\.key|\.p12|\.pfx|\.jks|\.keystore|\.log|\.bak|\.backup|\.zip|\.7z|\.rar|\.tar|\.tgz|\.tar\.gz)$/i.test(name))return true;
 return false;
}
const sensitiveAssignment = /(?:^|[\s"'])((?:JIRA_API_TOKEN|WHATSAPP_LOCAL_SECRET|META_ACCESS_TOKEN|META_APP_SECRET|META_WEBHOOK_VERIFY_TOKEN|TICKETBRIDGE_CLOUD_ADMIN_TOKEN|(?:AWS|GITHUB|OPENAI)_?(?:API_)?(?:TOKEN|SECRET|KEY)))[ \t]*[:=][ \t]*["']?([^\s"'`,;]+)/gmi;
function sampleIsSecret(s) {
 const v=String(s||'').trim();
 if(!v || /^\$?\{|^\$\(|^process\.|^env\.|^<|^TU[_-]|^YOUR[_-]|^CAMBIAR|^REEMPLAZAR|^EXAMPLE|^PLACEHOLDER|^DUMMY|^XXXX/i.test(v))return false;
 if (/^(?:true|false|null|undefined)$/i.test(v))return false;
 return v.length>=14;
}
function findSecrets(text, filename='') {
 const found=[];
 const patterns=[
  ['token Atlassian', /\bATATT[A-Za-z0-9_=-]{20,}/g],
  ['clave privada', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['token GitHub', /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g],
  ['token Slack', /\bxox[baprs]-[A-Za-z0-9-]{20,}/g],
  ['clave OpenAI', /\bsk-[A-Za-z0-9_-]{25,}/g]
 ];
 for (const [label,re] of patterns)if(re.test(text))found.push(label);
 for(const match of text.matchAll(sensitiveAssignment))if(sampleIsSecret(match[2]))found.push('valor sensible asignado: '+match[1]);
 if (normalized(filename).endsWith('.env.example')) {
  for(const line of text.split(/\r?\n/)){
   const m=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
   if(m && /(?:TOKEN|SECRET|PASSWORD|KEY)$/.test(m[1]) && sampleIsSecret(m[2]))found.push('plantilla contiene secreto: '+m[1]);
  }
 }
 return [...new Set(found)];
}
function gitPaths(command) {
 try {
  const args=command==='staged' ? ['diff','--cached','--name-only','--diff-filter=ACMR','-z'] : ['ls-files','-z'];
  return runGit(args,{encoding:'buffer'}).toString('utf8').split('\0').filter(Boolean);
 }catch(e){red('[ERROR] No se pudieron leer los archivos de Git.');process.exitCode=2;return []}
}
function scanFiles(mode='tracked') {
 const gitroot=getGitRoot();
 if (!gitroot || gitroot!==root) {
  red('[ERROR] El proyecto no es la raíz de un repositorio Git. Verificá la carpeta antes de publicar.');return false;
 }
 const names=gitPaths(mode), violations=[];
 for (const file of names) {
  const name=normalized(file);
  if(blockedPath(name)){violations.push(name+' — ruta de datos/secretos');continue}
  try {
   let data;
   if(mode==='staged')data=cp.execFileSync('git',['show',':'+name],{cwd:root,maxBuffer:MAX_SCAN_BYTES+1024});
   else data=fs.readFileSync(path.join(root,name));
   if(data.length>MAX_SCAN_BYTES){violations.push(name+' — archivo demasiado grande para auditar');continue}
   if(data.includes(0)){violations.push(name+' — archivo binario no permitido en control de código');continue}
   for(const finding of findSecrets(data.toString('utf8'),name))violations.push(name+' — '+finding);
  }catch(e){violations.push(name+' — no se pudo verificar su contenido')}
 }
 if (violations.length){
  red('[BLOQUEADO] Posible publicación de información sensible:');
  for(const violation of violations)red(' • '+violation);
  red('No se muestran los valores. Corregí estos archivos, quitá del índice y revocá credenciales expuestas.');
  return false;
 }
 log('[OK] '+names.length+' archivos de Git revisados; no se detectaron los patrones cubiertos.');
 return true;
}
function checkExample() {
 const file=path.join(root,'.env.example');
 if(!fs.existsSync(file)){red('[ERROR] Falta .env.example segura.');return false}
 const found=findSecrets(fs.readFileSync(file,'utf8'),'.env.example');
 if(found.length){red('[BLOQUEADO] .env.example contiene posible credencial.');found.forEach(x=>red(' • '+x));return false}
 log('[OK] .env.example no incluye valores secretos detectados.');return true;
}
function checkLocal() {
 let ok=true;
 for(const name of ['.env.local','.env']){
  const file=path.join(root,name);
  if(!fs.existsSync(file))continue;
  const s=fs.lstatSync(file);
  if(s.isSymbolicLink()){red('[RIESGO] '+name+' es un enlace simbólico.');ok=false;continue}
  if((s.mode&0o077)!==0){red('[RIESGO] '+name+' puede ser leído por otros usuarios: ejecutá proteger.');ok=false}
  else log('[OK] Permisos privados: '+name);
 }
 for(const name of ['data','data/.wwebjs_auth','data/media']){
  const file=path.join(root,name);if(!fs.existsSync(file))continue;
  const s=fs.lstatSync(file);if(!s.isDirectory()||s.isSymbolicLink()){red('[RIESGO] '+name+' no es un directorio normal.');ok=false;continue}
  if((s.mode&0o077)!==0){red('[RIESGO] Permisos abiertos en '+name);ok=false}
  else log('[OK] Directorio privado: '+name);
 }
 return ok;
}
function protect() {
 if(process.platform==='win32'){red('Usar ACL de Windows; este comando protege POSIX/Linux solamente.');return false}
 let count=0;
 for(const f of ['.env.local','.env']){
  const p=path.join(root,f);if(!fs.existsSync(p))continue;
  if(fs.lstatSync(p).isSymbolicLink()){red('[ERROR] Enlace simbólico: '+f);return false}
  fs.chmodSync(p,0o600);count++;
 }
 const data=path.join(root,'data');
 function recurse(p){
  const stat=fs.lstatSync(p);
  if(stat.isSymbolicLink()){red('[ADVERTENCIA] Enlace simbólico omitido: '+path.relative(root,p));return}
  if(stat.isDirectory()){
   fs.chmodSync(p,0o700);
   for(const entry of fs.readdirSync(p)){
    if(++count>150000)throw new Error('Demasiados archivos; se detuvo para revisión manual');
    recurse(path.join(p,entry));
   }
  } else if(stat.isFile())fs.chmodSync(p,0o600);
 }
 if(fs.existsSync(data))recurse(data);
 log('[OK] Permisos privados aplicados. No se alteró el contenido de datos ni de claves.');return true;
}
function installHooks() {
 const gitroot=getGitRoot();if(gitroot!==root){red('[ERROR] Abrí la raíz Git de W-Ticket; no se aplicó configuración.');return false}
 let current=''; try{ current=runGit(['config','--local','--get','core.hooksPath'],{stdio:['ignore','pipe','ignore']}).trim() }catch{}
 if(current && current!=='.githooks'){
  red('[DETENIDO] Ya existe core.hooksPath personalizado. Revisalo antes de modificarlo.');return false;
 }
 for(const file of ['pre-commit','pre-push']){
  const p=path.join(root,'.githooks',file);
  if(!fs.existsSync(p)){red('[ERROR] Falta .githooks/'+file);return false}
  fs.chmodSync(p,0o755);
 }
 runGit(['config','--local','core.hooksPath','.githooks']);
 log('[OK] Hook de pre-commit y pre-push activados en este repositorio.');
 return true;
}
function verifyNext() {
 let installed='';
 for(const p of [path.join(root,'package-lock.json'),path.join(root,'node_modules','next','package.json')]){
  if(!fs.existsSync(p))continue;
  try {
   const data=JSON.parse(fs.readFileSync(p,'utf8'));
   const v=p.endsWith('package-lock.json')?data.packages?.['node_modules/next']?.version:data.version;
   if(v){installed=v;break}
  }catch{}
 }
 if(!installed){red('[RIESGO] No se pudo comprobar la versión exacta de Next.js.');return false}
 const m=/^(\d+)\.(\d+)\.(\d+)/.exec(installed);
 if(!m){red('[RIESGO] Versión Next no reconocida.');return false}
 const major=+m[1],minor=+m[2],patch=+m[3];
 const supported=(major===15&&minor===5&&patch>=28)||(major===16&&(minor>4||(minor===4&&patch>=1)));
 if(!supported){red(`[RIESGO CRÍTICO] Next.js ${installed}. Revisar actualización a 15.5.28 o versión más reciente corregida.`);return false}
 log('[OK] Versión Next.js revisada: '+installed+' (consultá npm audit para el resto).');return true;
}
function main() {
 const command=process.argv[2]||'comprobar';let ok=true;
 switch(command){
 case 'staged':ok=scanFiles('staged');break;
 case 'tracked':ok=scanFiles('tracked');break;
 case 'comprobar':ok=checkExample()&&checkLocal()&&verifyNext();if(getGitRoot()===root)ok=scanFiles('tracked')&&ok;break;
 case 'proteger':ok=protect()&&checkLocal();break;
 case 'instalar-hooks':try{ok=installHooks()}catch(e){red('[ERROR] No se pudo instalar hooks: '+e.message);ok=false}break;
 case 'verificar-next':ok=verifyNext();break;
 default:red('Uso: node scripts/seguridad-local.cjs [comprobar|proteger|instalar-hooks|staged|tracked|verificar-next]');ok=false;
 }
 if(!ok)process.exitCode=1;
}
if(require.main===module)main();
module.exports={blockedPath,findSecrets,sampleIsSecret};
