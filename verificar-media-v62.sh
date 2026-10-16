#!/usr/bin/env bash
set -euo pipefail
DEST="${1:-$PWD}"
if [[ ! -d "$DEST" || ! -f "$DEST/lib/whatsapp-version.ts" ]]; then
  echo 'Uso: bash verificar-media-v62.sh /ruta/a/whatsapp-jira' >&2
  exit 1
fi
echo '[1/3] Código instalado'
grep -n 'WHATSAPP_CONNECTOR_VERSION' "$DEST/lib/whatsapp-version.ts" | head -1
grep -n "version: 'ticketbridge-sync" "$DEST/whatsapp/connector.cjs" | head -1
node --check "$DEST/whatsapp/connector.cjs" && echo 'Sintaxis conector: OK'
echo
echo '[2/3] Conexión del conector local'
if command -v curl >/dev/null; then
  curl --silent --show-error --max-time 4 'http://127.0.0.1:3217/status' || true
  echo
else
  echo 'curl no está instalado'
fi
echo
echo '[3/3] Multimedia persistida (sin mostrar números ni mensajes privados)'
python3 - "$DEST" <<'PY'
import os,sqlite3,sys
folder=sys.argv[1]
db=os.path.join(folder,'data','app.sqlite')
if not os.path.exists(db):
    print('La base de datos todavía no existe.');sys.exit(0)
try:
    con=sqlite3.connect('file:'+db+'?mode=ro',uri=True)
    cur=con.cursor()
    cur.execute("SELECT id,media_path,has_media,media_error FROM cases WHERE source='whatsapp'")
    rows=cur.fetchall()
    has=sum(bool(r[2]) for r in rows)
    saved=sum(bool(r[1]) for r in rows)
    missing=[r for r in rows if r[1] and not os.path.isfile(os.path.join(folder,'data','media',os.path.basename(r[1])))]
    awaiting=[r for r in rows if r[2] and not r[1]]
    print(f'Mensajes WhatsApp: {len(rows)}')
    print(f'Mensajes con adjunto detectado: {has}')
    print(f'Mensajes con archivo asociado: {saved}')
    print(f'Con ruta registrada pero archivo ausente: {len(missing)}')
    print(f'Adjuntos pendientes: {len(awaiting)}')
    if awaiting:
        print('Errores recientes (IDs locales, sin números ni contactos):')
        for rec in awaiting[-5:]:print(f'  #{rec[0]}: {str(rec[3] or "Pendiente de descargar")[:180]}')
except sqlite3.Error as exc:print('No se pudo leer la base de datos:',exc)
PY
