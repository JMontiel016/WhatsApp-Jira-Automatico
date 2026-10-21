'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {stopClientBounded,backupAuthSession}=require('../whatsapp/session-recovery.cjs');
(async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'tb-recovery-test-'));
  try {
    const root=path.join(parent,'auth');
    const session=path.join(root,'session-ticketbridge-test');
    const backups=path.join(parent,'backups');
    fs.mkdirSync(session,{recursive:true});
    fs.writeFileSync(path.join(session,'session.marker'),'fake-session-for-test');
    const backup=backupAuthSession({sessionDir:session,backupDir:backups});
    assert.equal(fs.existsSync(session),false,'perfil original liberado');
    assert.equal(fs.readFileSync(path.join(backup,'session.marker'),'utf8'),'fake-session-for-test','respaldo conservado');
    assert.equal(backupAuthSession({sessionDir:session,backupDir:backups}),null,'sin sesión no eliminar nada');
    assert.equal(fs.statSync(backups).mode & 0o777,0o700,'permisos del respaldo');
    const quick=await stopClientBounded({destroy:async()=>{}},200);
    assert.equal(quick,true,'detención normal');
    let termination='';
    const child={exitCode:null,kill(signal){termination=signal;this.exitCode=0;}};
    const timeout=await stopClientBounded({destroy:()=>new Promise(()=>{}),pupBrowser:{process:()=>child}},30);
    assert.equal(timeout,true,'libera solo Chromium del conector');
    assert.equal(termination,'SIGTERM');
    const blocked=await stopClientBounded({destroy:()=>Promise.reject(new Error('busy')),pupBrowser:{process:()=>null}},30);
    assert.equal(blocked,false,'no inicia un segundo cliente con navegador incierto');
    const code=fs.readFileSync(path.join(__dirname,'..','whatsapp','connector.cjs'),'utf8');
    assert.match(code,/let client = new Client\(clientOptions\(\)\)/);
    assert.match(code,/replaceClient\(\)/);
    assert.match(code,/POST' && route === '\/relink-qr'/);
    assert.match(code,/!ready && !pairingQr && !lastQrError/);
    assert.match(code,/\bAUTH_BACKUPS\b/);
    console.log('[OK] Perfil respaldado, reinicio con cliente nuevo, QR manual/automático y bloqueo seguro');
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
