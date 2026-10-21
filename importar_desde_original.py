#!/usr/bin/env python3
"""Copia la información local de una instalación anterior a esta copia independiente.
No altera ningún archivo de origen. Debe ejecutarse con ambos servidores detenidos.
"""
import argparse
import os
import shutil
import socket
import sqlite3
import sys
from pathlib import Path


def port_is_used(port):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == 0


def ensure_nosymlinks(root: Path):
    for item in root.rglob('*'):
        if item.is_symlink():
            raise RuntimeError(f'Por seguridad no se copian enlaces simbólicos: {item}')


def main():
    parser = argparse.ArgumentParser(description='Clonar solo datos y configuraciones desde TicketWhatsapp antiguo')
    parser.add_argument('original', type=Path, help='Ruta del proyecto anterior')
    args = parser.parse_args()
    old = args.original.expanduser().resolve()
    new = Path(__file__).resolve().parent
    if old == new or old in new.parents or new in old.parents:
        raise RuntimeError('La carpeta nueva y la original deben ser independientes.')
    if not (old / 'package.json').is_file() or not (new / 'package.json').is_file():
        raise RuntimeError('No se encontraron ambos package.json; verificá las carpetas.')
    for port in (3000, 3217):
        if port_is_used(port):
            raise RuntimeError(f'Puerto {port} activo. Detené npm run dev y npm run whatsapp antes de copiar el perfil.')
    source = old / 'data'
    target = new / 'data'
    if target.exists():
        raise RuntimeError('Ya existe data/ en la nueva instalación. No se sobrescribe ni fusiona información.')
    if source.exists() and not source.is_dir():
        raise RuntimeError('La ruta data del proyecto anterior no es una carpeta.')
    if source.is_symlink() or (source.exists() and any(x.is_symlink() and x.name not in {'SingletonLock','SingletonSocket','SingletonCookie'} for x in source.rglob('*'))):
        raise RuntimeError('Por seguridad, no se importan sesiones ni datos con enlaces simbólicos.')
    if source.exists():
        ignore = shutil.ignore_patterns('app.sqlite', 'app.sqlite-wal', 'app.sqlite-shm', '*.sqlite-wal', '*.sqlite-shm', '*.sqlite-journal', 'SingletonLock', 'SingletonSocket', 'SingletonCookie')
        shutil.copytree(source, target, ignore=ignore)
        db_old = source / 'app.sqlite'
        if db_old.exists():
            with sqlite3.connect(f'file:{db_old}?mode=ro', uri=True, timeout=5) as connection:
                with sqlite3.connect(target / 'app.sqlite') as cloned:
                    connection.backup(cloned)
                    result = cloned.execute('PRAGMA integrity_check').fetchone()[0]
                    if result != 'ok':
                        raise RuntimeError('Falló verificación SQLite: ' + result)
                    print('[OK] Base SQLite copiada con backup() y verificada')
        print('[OK] Datos, multimedia y perfil WhatsApp copiados en la instalación nueva.')
    else:
        print('[AVISO] No existe data/ en la instalación anterior; la copia nueva comenzará sin historial.')
    env = old / '.env.local'
    envnew = new / '.env.local'
    if env.is_file() and not envnew.exists():
        if env.is_symlink():
            raise RuntimeError('No se copia un .env.local simbólico')
        shutil.copy2(env, envnew)
        os.chmod(envnew, 0o600)
        print('[OK] .env.local copiado solo a tu computadora.')
    print('[OK] El proyecto ORIGINAL permanece sin cambios.')
    print('Ahora ejecutá npm ci y luego iniciá los servicios desde la carpeta nueva.')

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        sys.exit('[DETENIDO] ' + str(exc))
