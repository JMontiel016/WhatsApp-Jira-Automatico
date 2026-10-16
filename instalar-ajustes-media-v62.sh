#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$PWD}"
if [[ ! -f "$DEST/package.json" || ! -f "$DEST/whatsapp/connector.cjs" || ! -f "$DEST/lib/media.ts" ]]; then
  echo 'ERROR: indicá la ruta real de TicketBridge (debe contener package.json, whatsapp y lib).' >&2
  exit 1
fi
if ! grep -q "ticketbridge-sync-v6\.1\|ticketbridge-sync-v6\.2" "$DEST/lib/whatsapp-version.ts"; then
  echo 'ERROR: este parche necesita TicketBridge v6.1. Instalá esa versión antes de aplicar v6.2.' >&2
  exit 1
fi
FILES=(
  'whatsapp/connector.cjs'
  'lib/whatsapp-version.ts'
  'lib/media.ts'
  'app/api/whatsapp/ingest/route.ts'
  'app/api/whatsapp/media/recover/route.ts'
)
for file in "${FILES[@]}"; do
  if [[ ! -f "$HERE/$file" || ! -f "$DEST/$file" ]]; then
    echo "ERROR: falta un archivo requerido: $file" >&2
    exit 1
  fi
done
node --check "$HERE/whatsapp/connector.cjs"
BACKUP="$DEST/.ticketbridge-backups/media-v62-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for file in "${FILES[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$file")"
  cp -p "$DEST/$file" "$BACKUP/$file"
done
for file in "${FILES[@]}"; do
  cp -p "$HERE/$file" "$DEST/$file"
  echo "Actualizado: $file"
done
echo
printf 'Instalación completada. Respaldo del código anterior: %s\n' "$BACKUP"
echo 'NO se modificaron .env.local, data/, data/media/ ni las sesiones vinculadas.'
echo 'Reiniciá ambos procesos: npm run dev y npm run whatsapp.'
