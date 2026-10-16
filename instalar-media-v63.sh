#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$PWD}"
if [[ ! -f "$DEST/package.json" || ! -f "$DEST/whatsapp/connector.cjs" || ! -f "$DEST/lib/whatsapp-version.ts" ]]; then
  echo 'ERROR: indicá la ruta real del proyecto TicketBridge.' >&2; exit 1
fi
if ! grep -q "ticketbridge-sync-v6\.2\|ticketbridge-sync-v6\.3" "$DEST/lib/whatsapp-version.ts"; then
  echo 'ERROR: requiere TicketBridge v6.2. No reemplazamos otros proyectos.' >&2; exit 1
fi
if [[ -f "$DEST/whatsapp/connector.cjs" ]] && ! grep -q "ticketbridge-sync-v6\.2\|ticketbridge-sync-v6\.3" "$DEST/whatsapp/connector.cjs"; then
  echo 'ERROR: el conector instalado no parece ser v6.2; no se aplicó nada.' >&2; exit 1
fi
node --check "$SOURCE/whatsapp/connector.cjs"
node --check "$SOURCE/whatsapp/compat-message.cjs"
python3 -m py_compile "$SOURCE/resincronizar-pendientes-v63.py"
FILES=( 'whatsapp/connector.cjs' 'lib/whatsapp-version.ts' 'whatsapp/compat-message.cjs' )
BACKUP="$DEST/.ticketbridge-backups/media-v63-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP"
for file in "${FILES[@]}"; do
  [[ -f "$SOURCE/$file" ]] || { echo "ERROR: falta $file en el ZIP" >&2; exit 1; }
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
printf '\nParche v6.3 instalado. Respaldo: %s\n' "$BACKUP"
echo 'No se han alterado data/, .env.local, tickets, base de datos ni sesiones.'
echo 'Detené ambos procesos antes de volver a iniciar npm run dev y npm run whatsapp.'
