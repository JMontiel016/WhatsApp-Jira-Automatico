#!/usr/bin/env bash
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
printf '\n[1/5] Versiones configuradas\n'
grep -n "ticketbridge-sync-v6" whatsapp/connector.cjs lib/whatsapp-version.ts || true
printf '\n[2/5] Sintaxis conector\n'
node --check whatsapp/connector.cjs && echo 'OK'
printf '\n[3/5] Puerto WhatsApp local\n'
ss -ltnp '( sport = :3217 )' 2>/dev/null || true
printf '\n[4/5] Conector ACTIVO\n'
curl --max-time 5 -sS 'http://127.0.0.1:3217/status' || echo 'ERROR: el conector no está disponible'
printf '\n\n[5/5] API Next.js y contactos\n'
curl --max-time 7 -sS 'http://127.0.0.1:3000/api/whatsapp/status' || echo 'ERROR: Next.js no está disponible'
printf '\nContactos: '
curl --max-time 15 -sS -o /tmp/ticketbridge-v6-contactos-check.json -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/api/whatsapp/contacts?q=' || true
node -e 'try{const fs=require("fs");const d=JSON.parse(fs.readFileSync("/tmp/ticketbridge-v6-contactos-check.json","utf8"));console.log(Array.isArray(d)?`Contactos: ${d.length}`:`Error: ${d.error||"respuesta inesperada"}`)}catch{console.log("Sin respuesta JSON de contactos")}'
