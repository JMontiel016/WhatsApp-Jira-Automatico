#!/usr/bin/env bash
set -u
printf '\n[1] Verificando archivos de la web\n'
for route in app/api/whatsapp/{history,chat-state,contacts,read-sync}/route.ts;do
  [[ -f "$route" ]] && echo "OK: $route" || echo "FALTA: $route"
done
printf '\n[2] Verificando version de archivo de conector\n'
grep -n "ticketbridge-sync-v5" whatsapp/connector.cjs || echo "ERROR: conector sin versión v5"
printf '\n[3] Procesos que escuchan en el puerto 3217\n'
ss -ltnp '( sport = :3217 )' 2>/dev/null || true
printf '\n[4] Version REAL del conector ACTIVO\n'
curl --max-time 5 -sS 'http://127.0.0.1:3217/status' || echo "Conector no iniciado"
printf '\n\n[5] Version que Next.js detecta\n'
curl --max-time 8 -sS 'http://127.0.0.1:3000/api/whatsapp/status' || echo "Next.js no iniciado"
printf '\n\n[6] Rutas web (GET debe dar 405, 404 significa que Next no las reconoce)\n'
for route in history chat-state read-sync;do
 printf '%s: ' "$route"
 curl --max-time 5 -s -o /dev/null -w 'HTTP %{http_code}\n' "http://127.0.0.1:3000/api/whatsapp/$route"
done
