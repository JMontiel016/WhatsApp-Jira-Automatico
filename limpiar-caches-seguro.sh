#!/usr/bin/env bash
set -euo pipefail
# Limpieza local segura: no modifica data/, sesiones ni .env.local.
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" != "--aplicar" ]]; then
  echo 'SIMULACIÓN. No se borró nada.'
  echo 'Se pueden limpiar .next, .turbo, node_modules/.cache y archivos *.log de la raíz.'
  echo 'Uso: bash limpiar-caches-seguro.sh --aplicar'
  exit 0
fi
for dir in .next .turbo node_modules/.cache; do
  if [[ -d "$PROJECT/$dir" ]]; then
    echo "Eliminando caché: $dir"
    rm -rf -- "$PROJECT/$dir"
  fi
done
find "$PROJECT" -maxdepth 1 -type f -name '*.log' -print -delete
printf '%s\n' 'Cachés limpiadas. No se tocó data/, .env.local, ni sesiones de WhatsApp.'
