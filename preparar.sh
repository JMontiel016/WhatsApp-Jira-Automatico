#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f .env.local ]]; then
  echo '[OK] Configuración local existente, no se reemplazó.'
  exit 0
fi
cp .env.example .env.local
secret="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
# Valor literal conocido del template; nunca imprimimos el nuevo secreto.
export TB_SECRET="$secret"
python3 - <<'PYIN'
import os,pathlib
p=pathlib.Path('.env.local')
s=p.read_text()
s=s.replace('REEMPLAZAR_CON_UN_SECRET_ALEATORIO_DE_32_CARACTERES',os.environ['TB_SECRET'])
p.write_text(s)
PYIN
chmod 600 .env.local
mkdir -p data
chmod 700 data
printf '[OK] .env.local creado con secreto único (no se muestra).\n'
printf 'Editá .env.local para cargar Jira; ENABLE_REAL_JIRA está desactivado por defecto.\n'
