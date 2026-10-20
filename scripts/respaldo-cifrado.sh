#!/usr/bin/env bash
# Respaldo cifrado y LOCAL de .env.local y data/ sin dejar tar sin cifrar.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! command -v age >/dev/null 2>&1; then
  echo '[ERROR] Falta age. En Ubuntu: sudo apt install age' >&2
  exit 2
fi
if [[ ! -f .env.local || ! -d data ]]; then
  echo '[ERROR] Faltan .env.local o data/. No se creó respaldo.' >&2
  exit 2
fi
# Detener web y conector antes para evitar inconsistencias de SQLite.
if command -v fuser >/dev/null 2>&1 && { fuser -n tcp 3000 >/dev/null 2>&1 || fuser -n tcp 3217 >/dev/null 2>&1; }; then
  echo '[DETENIDO] Cerrá primero npm run dev y npm run whatsapp.' >&2
  exit 2
fi
umask 077
DEST="$HOME/Descargas/W-Ticket_privado_$(date +%Y%m%d_%H%M%S).tar.gz.age"
if [[ -e "$DEST" ]]; then
  echo '[DETENIDO] Ya existe el archivo destino. Reintentá luego.' >&2
  exit 2
fi
trap 'rm -f -- "$DEST"' ERR
printf 'Vas a crear un respaldo privado cifrado con contraseña, solo en tu equipo.\n'
printf 'La contraseña NO debe guardarse en .env.local ni en Git.\n'
tar -czf - -- .env.local data | age -p -o "$DEST"
chmod 600 "$DEST"
trap - ERR
printf '[OK] Respaldo cifrado creado: %s\n' "$DEST"
printf '[IMPORTANTE] Guardá la contraseña fuera del proyecto; sin ella no podrás restaurar.\n'
