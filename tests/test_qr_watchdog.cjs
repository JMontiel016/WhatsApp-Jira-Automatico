'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../whatsapp/connector.cjs'),'utf8');
function between(start,end){const a=code.indexOf(start),b=code.indexOf(end,a); assert.ok(a>=0 && b>a,`missing ${start}`);return code.slice(a,b);}
const qrFuncs=between('function currentQrAvailable() {','let compatibility =');
const watchdog=between('const connectionWatchdog=setInterval(()=>{','const startupMonitor=setInterval(()=>{');
assert.match(watchdog,/hadError=Boolean\(lastQrError\)/);
assert.match(code,/restartScheduled=true;/);
assert.match(code,/resetSession:true/);
const now=1_800_000;
const state={
  ready:false, pairingQr:'secret', pairingQrAt:now-10000, qrRefreshInFlight:false,
  restartScheduled:false, lastQrError:null, connectionPhase:'waiting',closing:false,
  clientStartingAt:now-190000, automaticRestartUsed:false,
  AUTO_RESTART_AFTER_MS:180000, QR_DISPLAY_MAX_AGE_MS:60000, QR_STALE_RECOVERY_MS:120000,
  Date:{now:()=>now}, console:{warn(){}}, setInterval:fn=>{state.intervalCallback=fn;return {unref(){}}},
  restartWhatsApp:args=>{state.restarts.push(args); return Promise.resolve({ok:true})},restarts:[]
};
vm.createContext(state);vm.runInContext(qrFuncs+watchdog,state);
assert.equal(vm.runInContext('currentQrAvailable()',state),true);
state.intervalCallback();assert.equal(state.restarts.length,0,'recent QR must not restart');
state.pairingQrAt=now-180000;
assert.equal(vm.runInContext('qrStalled()',state),true);
assert.equal(vm.runInContext('currentQrAvailable()',state),false);
state.lastQrError='Runtime.callFunctionOn timed out';
state.intervalCallback();assert.equal(state.restarts.length,1,'even with initialization error should retry once');
state.intervalCallback();assert.equal(state.restarts.length,1,'only one automatic retry');
state.restartScheduled=true;state.intervalCallback();assert.equal(state.restarts.length,1,'queued manual retry blocks watchdog');
console.log('[OK] QR vigente, QR vencido, recuperación tras timeout, un solo reintento y bloqueo de acciones simultáneas');
