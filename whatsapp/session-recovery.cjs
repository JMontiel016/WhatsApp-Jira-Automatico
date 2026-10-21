'use strict';
/**
 * Recuperación de sesión LocalAuth sin borrar credenciales.
 * No contiene rutas de usuario ni secretos: los define el conector.
 */
const fs = require('node:fs');
const path = require('node:path');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function stopClientBounded(client, maximumMs=12000) {
  if (!client) return true;
  let timer;
  const result = await Promise.race([
    Promise.resolve().then(() => client.destroy()).then(() => 'closed', () => 'error'),
    new Promise(resolve => { timer=setTimeout(() => resolve('timeout'), maximumMs); })
  ]);
  clearTimeout(timer);
  if (result === 'closed') return true;
  // Solo se actúa sobre el proceso Chromium que este Client inició.
  const process = client.pupBrowser?.process?.();
  if (process && process.exitCode === null) {
    try { process.kill('SIGTERM'); } catch { return false; }
    await delay(600);
    if (process.exitCode === null) {
      try { process.kill('SIGKILL'); } catch { return false; }
      await delay(250);
    }
    return true;
  }
  // Si el cliente no llegó a crear navegador, no hay proceso que liberar.
  if (!client.pupBrowser && !client.pupPage) return true;
  // No iniciar otra sesión con un perfil potencialmente aún en uso.
  return false;
}

function backupAuthSession({sessionDir, backupDir}) {
  if (!path.isAbsolute(sessionDir) || !path.isAbsolute(backupDir))
    throw new Error('Se requieren rutas absolutas');
  if (!fs.existsSync(sessionDir)) return null;
  const info=fs.lstatSync(sessionDir);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('La carpeta de sesión no es un directorio seguro');
  fs.mkdirSync(backupDir, {recursive:true, mode:0o700});
  fs.chmodSync(backupDir,0o700);
  const now=new Date().toISOString().replace(/[:.]/g,'-');
  const prefix=path.basename(sessionDir);
  let target;
  for(let i=0; i<100; i++) {
    const candidate=path.join(backupDir, `${prefix}-${now}-${i}`);
    if(!fs.existsSync(candidate)){target=candidate;break;}
  }
  if (!target) throw new Error('No se encontró un nombre libre para el respaldo');
  // Mover atómicamente en el mismo sistema de archivos, sin tocar SQLite.
  fs.renameSync(sessionDir,target);
  return target;
}
module.exports={stopClientBounded,backupAuthSession};
