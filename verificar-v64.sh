#!/usr/bin/env bash
set -Eeuo pipefail
DEST="${1:-$PWD}"
if [[ ! -f "$DEST/whatsapp/connector.cjs" || ! -f "$DEST/lib/whatsapp-version.ts" ]]; then
 echo 'Uso: bash verificar-v64.sh /ruta/al/proyecto' >&2; exit 1
fi
echo '[1/4] Versión y sintaxis'
grep 'WHATSAPP_CONNECTOR_VERSION' "$DEST/lib/whatsapp-version.ts" | head -1
node --check "$DEST/whatsapp/connector.cjs"
node --check "$DEST/whatsapp/compat-message.cjs"
echo '[2/4] IDs originales de mensajes (incluyendo grupos y remitentes)'
node - "$DEST" <<'JS'
const {patchMessageSerialization} = require(require('path').join(process.argv[2],'whatsapp/compat-message.cjs'));
class Msg { _patch(data){this.id=data.id;return this;} }
patchMessageSerialization(Msg);
for(const s of ['false_11111111@lid_AB12','false_12345-98765@g.us_CD34_22222222@lid','true_11111111@lid_EF56_out']){
 const parts=s.split('_');
 const id={fromMe:parts[0]==='true',remote:parts[1],id:parts[2],$1:s};
 if(new Msg()._patch({id}).id._serialized!==s) throw new Error('ID de mensaje no normalizado');
}
console.log('OK: privados, grupos y sufijo de mensaje propio');
JS
echo '[3/4] API y editor de imágenes'
test -f "$DEST/app/api/whatsapp/send-media/route.ts"
grep -q 'Ctrl+Enter: nueva línea' "$DEST/app/page.tsx"
grep -q 'media-mimetype-fallback' "$DEST/whatsapp/connector.cjs"
echo 'OK: ruta de envío y editor instalados'
echo '[4/4] Conector activo'
if command -v curl >/dev/null;then
 curl -sS --max-time 6 'http://127.0.0.1:3217/status' || true
 echo
fi
