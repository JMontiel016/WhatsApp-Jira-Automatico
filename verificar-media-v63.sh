#!/usr/bin/env bash
set -euo pipefail
DEST="${1:-$PWD}"
if [[ ! -f "$DEST/whatsapp/connector.cjs" || ! -f "$DEST/lib/whatsapp-version.ts" ]];then
 echo 'Uso: bash verificar-media-v63.sh /ruta/al/proyecto' >&2;exit 1
fi
echo '[1/3] Compatibilidad local instalada'
node --check "$DEST/whatsapp/connector.cjs"
node --check "$DEST/whatsapp/compat-message.cjs"
node - "$DEST" <<'JS'
const path=require('path');
const dest=process.argv[2];
const compat=require(path.join(dest,'whatsapp/compat-message.cjs'));
class TestMessage { _patch(data){this.id=data.id; return this;} }
compat.patchMessageSerialization(TestMessage);
const msg=new TestMessage()._patch({id:{fromMe:false,remote:'11111111@lid',id:'ABC123',$1:'false_11111111@lid_ABC123'}});
if(msg.id._serialized!=='false_11111111@lid_ABC123') process.exit(1);
console.log('Normalización de ID: OK');
JS
grep 'WHATSAPP_CONNECTOR_VERSION' "$DEST/lib/whatsapp-version.ts" | head -1
echo '[2/3] Conector activo'
if command -v curl >/dev/null;then
 curl --silent --show-error --max-time 5 'http://127.0.0.1:3217/status' || true
 echo
fi
echo '[3/3] Contadores de adjuntos locales'
python3 - "$DEST" <<'PY'
import os,sqlite3,sys
p=os.path.join(sys.argv[1],'data','app.sqlite')
if not os.path.isfile(p): print('Base de datos no encontrada');sys.exit(0)
c=sqlite3.connect(f'file:{p}?mode=ro',uri=True)
rows=c.execute("SELECT media_path,has_media FROM cases WHERE source='whatsapp'").fetchall()
print('Adjuntos detectados:',sum(bool(a[1]) for a in rows))
print('Archivos asociados:',sum(bool(a[0]) for a in rows))
print('Pendientes:',sum(bool(a[1]) and not bool(a[0]) for a in rows))
print('No se muestran números ni mensajes privados.')
PY
