#!/usr/bin/env bash
set -Eeuo pipefail
DEST="${1:-$PWD}"
[[ -f "$DEST/app/api/jira/media/import/route.ts" ]] || { echo 'ERROR: falta la ruta de evidencia para Jira'; exit 1; }
[[ -f "$DEST/lib/jira-evidence.ts" ]] || { echo 'ERROR: falta el sincronizador para Jira'; exit 1; }
node --check "$DEST/whatsapp/connector.cjs"
echo 'Código v6.5: OK'
python3 - "$DEST" <<'PY'
import os,sys,sqlite3,json,urllib.request
root=sys.argv[1]
try:
 d=json.load(urllib.request.urlopen('http://127.0.0.1:3217/status',timeout=4))
 print('Conector:',d.get('version'),'conectado:',d.get('connected'),'compatibilidad:',d.get('compatibility'))
except Exception as exc:print('Conector: no disponible, arrancá npm run whatsapp ('+type(exc).__name__+')')
try:
 d=json.load(urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=4))
 print('Next.js responde correctamente')
except Exception as exc:print('Next.js: no disponible, arrancá npm run dev ('+type(exc).__name__+')')
db=os.path.join(root,'data','app.sqlite')
if not os.path.isfile(db):print('Base de datos: no disponible');sys.exit(0)
con=sqlite3.connect('file:'+db+'?mode=ro',uri=True)
print('Pendientes:',con.execute("SELECT count(*) FROM cases WHERE source='whatsapp' AND has_media=1 AND (media_path IS NULL OR media_path='')").fetchone()[0])
try:
 for row in con.execute('SELECT state,count(*) FROM jira_media_deliveries GROUP BY state'):
  print('Evidencia Jira, estado',row[0]+':',row[1])
except sqlite3.OperationalError:print('Tabla Jira: se creará con la primera sincronización')
con.close()
PY
