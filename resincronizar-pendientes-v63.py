#!/usr/bin/env python3
"""Reintenta en lotes pequeños adjuntos ya registrados, sin crear mensajes.
No imprime números ni contactos. Requiere Next.js y conector activos.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

parser = argparse.ArgumentParser(description='Resincronización local de imágenes TicketBridge v6.3')
parser.add_argument('project', help='Ruta de la carpeta principal de TicketBridge')
parser.add_argument('--limit', type=int, default=12, help='Máximo de mensajes por ejecución (1-50)')
args = parser.parse_args()
if not 1 <= args.limit <= 50:
    parser.error('--limit debe estar entre 1 y 50')
project = os.path.realpath(args.project)
dbfile = os.path.join(project, 'data', 'app.sqlite')
if not os.path.isfile(dbfile):
    sys.exit('ERROR: no se encontró data/app.sqlite (no se creó ni modificó ninguna base de datos).')

def load(url):
    with urllib.request.urlopen(url, timeout=6) as response:
        return json.load(response)

try:
    status = load('http://127.0.0.1:3217/status')
    if status.get('version') != 'ticketbridge-sync-v6.3' or not status.get('connected'):
        sys.exit('ERROR: el conector activo no es la v6.3 conectada. Reiniciá npm run whatsapp.')
    load('http://127.0.0.1:3000/api/health')
except (OSError, ValueError, TimeoutError) as exc:
    sys.exit('ERROR: Next.js y el conector deben estar iniciados. ' + str(exc)[:140])

con = sqlite3.connect(f'file:{dbfile}?mode=ro', uri=True)
rows = con.execute("""
  SELECT id, phone FROM cases
  WHERE source='whatsapp' AND has_media=1
    AND (media_path IS NULL OR media_path='')
  ORDER BY received_at DESC, id DESC
  LIMIT ?
""", (args.limit,)).fetchall()
con.close()
if not rows:
    print('No hay adjuntos pendientes entre los registros disponibles.');sys.exit(0)

by_contact = defaultdict(list)
for message_id, phone in rows:
    by_contact[phone].append(int(message_id))
print(f'Pendientes seleccionados: {len(rows)} | conversaciones: {len(by_contact)}')
print('No se muestran números, nombres ni contenido de mensajes.')
confirmed = 0
failed = 0
batch_count = 0
for phone, ids in by_contact.items():
    for offset in range(0, len(ids), 4):
        batch = ids[offset:offset+4]
        batch_count += 1
        body = json.dumps({'phone':phone,'ids':batch}).encode()
        request = urllib.request.Request('http://127.0.0.1:3000/api/whatsapp/media/sync',
            data=body, headers={'Content-Type':'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=125) as response:
                result = json.load(response)
            confirmed += int(result.get('saved', 0))
            failed += int(result.get('failed', 0))
            print(f'Lote {batch_count}: guardados={result.get("saved",0)}, pendientes={result.get("failed",0)}')
        except urllib.error.HTTPError as exc:
            failed += len(batch)
            print(f'Lote {batch_count}: HTTP {exc.code}; revisar terminal WhatsApp')
        except (OSError, ValueError) as exc:
            failed += len(batch)
            print(f'Lote {batch_count}: sin respuesta válida ({type(exc).__name__})')
        time.sleep(1.0)
print(f'Resultado de recuperación: guardados={confirmed} | aún pendientes={failed}')
print('Los archivos que WhatsApp ya no tenga disponibles permanecerán pendientes.')
