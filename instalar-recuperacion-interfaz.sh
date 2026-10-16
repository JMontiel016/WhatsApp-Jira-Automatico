#!/usr/bin/env bash
set -Eeuo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-}"
FLAG="${2:-}"
if [[ -z "$DEST" || ! -f "$DEST/package.json" || ! -f "$DEST/app/page.tsx" || ! -f "$DEST/app/globals.css" ]]; then
  echo 'ERROR: indicá la carpeta raíz de TicketBridge (que tenga app/page.tsx y app/globals.css)' >&2
  echo 'Uso: bash instalar-recuperacion-interfaz.sh "$HOME/Escritorio/whatsapp-jira" --aplicar' >&2
  exit 1
fi
if [[ ! -f "$DEST/whatsapp/connector.cjs" ]]; then
  echo 'ERROR: no se encontró el conector en la carpeta del proyecto' >&2;exit 1
fi
if [[ "$FLAG" != '--aplicar' ]]; then
  echo 'MODO CONSULTA: no se modificó nada.'
  echo "Proyecto: $DEST"
  echo 'Estado de la interfaz actual:'
  for entry in 'waFilterChips:Filtros WhatsApp' 'reactionPickToggle:Reacciones' 'send-media:Envío de imágenes' 'replyKeyDown:Enter/Ctrl+Enter' 'ticketOverviewAttachments:Adjuntos de Jira' 'rosterMode:Chats y contactos' 'showAppearance:Apariencia'; do
    TOKEN="${entry%%:*}"; NAME="${entry#*:}"
    if grep -Fq "$TOKEN" "$DEST/app/page.tsx"; then echo "  OK $NAME"; else echo "  FALTA $NAME"; fi
  done
  echo 'Respaldos disponibles de versiones anteriores:'
  find "$DEST/.ticketbridge-backups" -mindepth 1 -maxdepth 2 -type f -path '*/app/page.tsx' -print 2>/dev/null | sort | tail -10 || true
  echo 'Para aplicar la restauración de la interfaz sin tocar el backend, agregá --aplicar.'
  exit 0
fi
for token in 'waFilterChips' 'reactionFloatingPanel' 'replyKeyDown' 'ticketOverviewAttachments' 'rosterMode'; do
 if ! grep -Fq "$token" "$SRC/app/page.tsx" "$SRC/app/globals.css"; then
   echo "ERROR: paquete incompleto ($token)" >&2;exit 1
 fi
done
if [[ -f "$DEST/lib/whatsapp-version.ts" ]] && ! grep -Eq 'ticketbridge-sync-v6\.' "$DEST/lib/whatsapp-version.ts";then
  echo 'ERROR: estructura incompatible. No se modificó nada.' >&2;exit 1
fi
BACKUP="$DEST/.ticketbridge-backups/recuperacion-interfaz-v66-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP/app"
cp -p "$DEST/app/page.tsx" "$BACKUP/app/page.tsx"
cp -p "$DEST/app/globals.css" "$BACKUP/app/globals.css"
# Eliminar únicamente el estado compilado de Next.js (no datos ni sesiones).
cp -p "$SRC/app/page.tsx" "$DEST/app/page.tsx"
cp -p "$SRC/app/globals.css" "$DEST/app/globals.css"
printf '\nInterfaz restaurada (2 archivos).\nRespaldo original: %s\n' "$BACKUP"
echo 'No se han tocado .env.local, data/, sesiones, Jira, conector ni rutas API.'
echo 'Siguiente paso: reiniciá npm run dev, luego Ctrl+Shift+R en el navegador.'
