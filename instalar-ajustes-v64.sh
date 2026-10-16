#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$PWD}"
if [[ ! -f "$DEST/package.json" || ! -f "$DEST/app/page.tsx" || ! -f "$DEST/whatsapp/connector.cjs" || ! -f "$DEST/lib/whatsapp-version.ts" ]]; then
  echo 'ERROR: indicá la ruta del proyecto TicketBridge (donde está package.json).' >&2; exit 1
fi
if ! grep -q 'ticketbridge-sync-v6.3' "$DEST/lib/whatsapp-version.ts" || ! grep -q 'ticketbridge-sync-v6.3' "$DEST/whatsapp/connector.cjs"; then
  echo 'ERROR: este parche requiere la versión v6.3 instalada, no se modificó nada.' >&2; exit 1
fi
if ! grep -q 'async function sendReply' "$DEST/app/page.tsx" || ! grep -q 'function saveRecoveredMedia' "$DEST/lib/media.ts"; then
  echo 'ERROR: falta una parte del código base v6.3; no es seguro instalar.' >&2; exit 1
fi
node --check "$SOURCE/whatsapp/connector.cjs"
node --check "$SOURCE/whatsapp/compat-message.cjs"
FILES=(
  'app/page.tsx'
  'app/globals.css'
  'app/api/whatsapp/send-media/route.ts'
  'whatsapp/connector.cjs'
  'whatsapp/compat-message.cjs'
  'lib/whatsapp-version.ts'
)
for file in "${FILES[@]}"; do
  [[ -f "$SOURCE/$file" ]] || { echo "ERROR: falta $file en el ZIP" >&2; exit 1; }
done
BACKUP="$DEST/.ticketbridge-backups/media-v64-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for file in "${FILES[@]}"; do
  if [[ -f "$DEST/$file" ]]; then
    mkdir -p "$BACKUP/$(dirname "$file")"
    cp -p "$DEST/$file" "$BACKUP/$file"
  fi
done
for file in "${FILES[@]}"; do
  mkdir -p "$DEST/$(dirname "$file")"
  cp -p "$SOURCE/$file" "$DEST/$file"
  echo "Actualizado: $file"
done
printf '\nAjustes v6.4 instalados. Respaldo: %s\n' "$BACKUP"
echo 'No se modificaron .env.local, data/, sesiones, tickets ni base de datos.'
