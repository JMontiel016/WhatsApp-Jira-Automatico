#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$PWD}"
if [[ ! -f "$DEST/package.json" || ! -f "$DEST/whatsapp/connector.cjs" || ! -f "$DEST/lib/jira.ts" || ! -f "$DEST/app/page.tsx" ]]; then
 echo 'ERROR: indicá la carpeta TicketBridge donde está package.json.' >&2; exit 1
fi
if ! grep -q 'ticketbridge-sync-v6.4' "$DEST/whatsapp/connector.cjs"; then
 echo 'ERROR: requiere el conector de v6.4. El proyecto no se modificó.' >&2; exit 1
fi
if ! grep -q 'saveRecoveredMedia' "$DEST/lib/media.ts" || ! grep -q 'customer_ticket_messages' "$DEST/app/api/jira/create/route.ts"; then
 echo 'ERROR: no se encontró la estructura TicketBridge esperada; no se modificó nada.' >&2; exit 1
fi
node --check "$SOURCE/whatsapp/connector.cjs"
python3 -m py_compile "$SOURCE/resincronizar-pendientes-v65.py"
FILES=(
 'whatsapp/connector.cjs'
 'lib/jira-evidence.ts'
 'app/page.tsx'
 'app/api/jira/create/route.ts'
 'app/api/jira/details/route.ts'
 'app/api/jira/media/import/route.ts'
 'app/api/jira/media/sync/route.ts'
 'app/api/whatsapp/ingest/route.ts'
 'app/api/whatsapp/media/import/route.ts'
 'app/api/whatsapp/media/recover/route.ts'
 'app/api/whatsapp/media/sync/route.ts'
 'app/api/whatsapp/media/discover/route.ts'
)
for file in "${FILES[@]}"; do
 [[ -f "$SOURCE/$file" ]] || { echo "ERROR: falta $file" >&2; exit 1; }
done
BACKUP="$DEST/.ticketbridge-backups/media-v65-$(date +%Y%m%d-%H%M%S)-$$"
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
install -m 700 "$SOURCE/resincronizar-pendientes-v65.py" "$DEST/resincronizar-pendientes-v65.py"
install -m 700 "$SOURCE/verificar-v65.sh" "$DEST/verificar-v65.sh"
printf '\nInstalado sobre v6.4. Copia de seguridad: %s\n' "$BACKUP"
echo 'No se tocan .env.local, data/, sesiones ni tickets existentes. La tabla de seguimiento se crea sin borrar filas.'
