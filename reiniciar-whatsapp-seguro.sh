#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v ss >/dev/null 2>&1; then
  echo "Falta ss (paquete iproute2). Usá: sudo apt install iproute2"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js en esta terminal. Activá tu instalación de Node antes de continuar."
  exit 1
fi
if [[ ! -d node_modules/whatsapp-web.js ]]; then
  echo "No encuentro node_modules. Ejecutá npm ci desde la carpeta del proyecto antes de reiniciar."
  exit 1
fi
expected='ticketbridge-sync-v6.4'
actual="$(curl --noproxy '*' --connect-timeout 2 -fsS http://127.0.0.1:3217/status 2>/dev/null | node -e "let s='';process.stdin.on('data',b=>s+=b).on('end',()=>{try{process.stdout.write(JSON.parse(s).version||'desconocida')}catch{process.stdout.write('desconocida')}})" || true)"
if [[ -n "$actual" ]]; then echo "Conector activo: $actual | versión requerida: $expected";fi
listeners="$(ss -H -ltnp '( sport = :3217 )' 2>/dev/null || true)"
if [[ -n "$listeners" ]]; then
  pids="$(printf '%s\n' "$listeners" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  if [[ -z "$pids" ]]; then
    echo "Puerto 3217 ocupado, pero no puedo identificar al dueño."
    echo "Consultá: sudo ss -ltnp '( sport = :3217 )'"
    echo "Cerrá manualmente el conector anterior y ejecutá npm run whatsapp."
    exit 1
  fi
  for pid in $pids; do
    cmd="$(ps -p "$pid" -o args= || true)"
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    echo "Puerto ocupado por PID=$pid ($cmd) | carpeta=$cwd"
    if [[ "$cmd" != *"whatsapp/connector.cjs"* || "$cwd" != "$(pwd -P)" ]]; then
      echo "No detendré un proceso que no sea el conector de ESTE proyecto."
      echo "Cerralo de manera manual y volvé a ejecutar este script."
      exit 1
    fi
  done
  printf '¿Detener el conector anterior para iniciar el actualizado? [s/N]: '
  read -r confirm
  if [[ "$confirm" != 's' && "$confirm" != 'S' ]]; then
    echo 'Sin cambios. Cerrá la instancia manualmente cuando quieras.'
    exit 0
  fi
  for pid in $pids; do kill -TERM "$pid"; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep .5
    if [[ -z "$(ss -H -ltnp '( sport = :3217 )' 2>/dev/null || true)" ]]; then break; fi
  done
  if [[ -n "$(ss -H -ltnp '( sport = :3217 )' 2>/dev/null || true)" ]]; then
    echo 'El conector anterior todavía escucha en 3217. Cerralo manualmente; no se forzará su salida.'
    exit 1
  fi
fi
echo 'Iniciando conector actualizado (v6.4)...'
echo 'Mantené esta terminal abierta. No se borra la sesión, configuración ni base de datos.'
exec npm run whatsapp
