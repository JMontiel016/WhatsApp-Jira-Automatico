#!/usr/bin/env bash
set -euo pipefail
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$PWD}"
DEST="$(cd "$DEST" && pwd)"
if [[ ! -f "$DEST/package.json" || ! -f "$DEST/app/page.tsx" ]];then
 echo "ERROR: el destino no es una carpeta de proyecto TicketBridge (faltan package.json o app/page.tsx)." >&2
 exit 1
fi
if [[ "$SOURCE" == "$DEST" ]];then
 echo 'ERROR: extraé el ZIP en otra carpeta para conservar el respaldo del proyecto.' >&2
 exit 1
fi
if [[ ! -f "$DEST/app/api/whatsapp/media/sync/route.ts" || ! -f "$DEST/app/api/whatsapp/contacts/route.ts" ]];then
 echo 'ERROR: faltan las rutas de sincronización de v5. Instalá primero la v5 (en un respaldo) antes de aplicar v6.' >&2
 exit 1
fi
if command -v ss >/dev/null && ss -ltn '( sport = :3217 )' | grep -q 'LISTEN';then
 echo 'AVISO: puerto 3217 ocupado. Detené la instancia anterior antes de iniciar WhatsApp v6.' >&2
fi
stamp="$(date +%Y%m%d-%H%M%S)"
backup="$DEST/.ticketbridge-respaldo-v6-$stamp"
mkdir -p "$backup"
files=(
 whatsapp/connector.cjs
 lib/whatsapp-version.ts
 lib/db.ts
 lib/media.ts
 app/page.tsx
 app/globals.css
 app/api/conversations/route.ts
 app/api/whatsapp/media/sync/route.ts
 app/api/whatsapp/reactions/route.ts
 app/api/whatsapp/reactions/ingest/route.ts
 app/api/whatsapp/reactions/sync/route.ts
)
for relative in "${files[@]}";do
 if [[ ! -f "$SOURCE/$relative" ]];then
  echo "FALTA EN ZIP: $relative" >&2
  exit 1
 fi
done
for relative in "${files[@]}";do
 mkdir -p "$DEST/$(dirname "$relative")" "$backup/$(dirname "$relative")"
 if [[ -f "$DEST/$relative" ]];then cp -p "$DEST/$relative" "$backup/$relative";fi
 cp -p "$SOURCE/$relative" "$DEST/$relative"
done
cp -p "$SOURCE/verificar-v6.sh" "$DEST/verificar-v6.sh"
cp -p "$SOURCE/LEEME_V6.txt" "$DEST/LEEME_V6.txt"
echo "OK: instalados ${#files[@]} archivos. Respaldo: $backup"
echo 'Ahora reiniciá Next.js y el conector, verificá ticketbridge-sync-v6 en :3217/status.'
