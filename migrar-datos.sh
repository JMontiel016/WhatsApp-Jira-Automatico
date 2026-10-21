#!/usr/bin/env bash
set -euo pipefail
# EJECUTAR CON LA APLICACIÓN ANTERIOR DETENIDA para copiar SQLite de forma segura.
cd "$(dirname "$0")"
old="${1:-$HOME/Escritorio/whatsapp-jira}"
old="$(realpath -m "$old")"
new="$(pwd -P)"
[[ "$old" != "$new" ]] || { echo 'Origen y destino son iguales.' >&2; exit 2; }
[[ -f "$old/package.json" ]] || { echo "No es un proyecto válido: $old" >&2; exit 2; }
if [[ -f "$old/.env.local" ]]; then
 if [[ -e .env.local ]]; then
  echo '[NO TOCADO] .env.local ya existe en TicketWhatsapp.'
 else
  cp -p -- "$old/.env.local" .env.local
  chmod 600 .env.local
  echo '[OK] Se conservaron las configuraciones del proyecto anterior.'
 fi
fi
if [[ -d "$old/data" ]]; then
 if [[ -d data ]] && [[ -n "$(ls -A data)" ]]; then
   echo '[NO TOCADO] data/ de TicketWhatsapp ya contiene información. No se mezclan bases de datos.'
 else
   rmdir data 2>/dev/null || true
   cp -a -- "$old/data" ./data
   echo '[OK] Copiados base SQLite, multimedia y sesión vinculada.'
 fi
fi
printf 'IMPORTANTE: El proyecto anterior sigue intacto. No ejecutes ambas instancias simultáneamente.\n'
