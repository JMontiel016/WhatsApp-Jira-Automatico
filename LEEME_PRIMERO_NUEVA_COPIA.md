# TicketBridge — copia nueva, sin reemplazar la instalación actual

Este ZIP se construyó desde `TicketWhatsapp(4).zip`. El ZIP recibido carecía de la carpeta `whatsapp/`; se incorporó el conector de la entrega v6.7 previamente compartida. La vinculación real y la compatibilidad con la base local deben probarse en Ubuntu.

## Paso 1 — Preparar otra carpeta (SIN sobrescribir nada)

1. Detenés `npm run whatsapp` y `npm run dev` de la instalación anterior usando Ctrl+C.
2. Descomprimís el ZIP en `~/Escritorio/Ticket/`. Tendrás una carpeta **nueva** `~/Escritorio/Ticket/TicketBridge_Nuevo/`.
3. Ejecutás:

```bash
cd "$HOME/Escritorio/Ticket/TicketBridge_Nuevo"
python3 importar_desde_original.py "$HOME/Escritorio/Ticket/TicketWhatsapp"
```

El importador no toca el proyecto antiguo. Comprueba que los puertos 3000 y 3217 estén libres, copia `.env.local` a la carpeta nueva, clona SQLite con backup consistente y copia multimedia y perfil WhatsApp. **Nunca borres ni muevas los datos originales.** Si el proyecto nuevo ya tiene `data/`, el importador se detiene para evitar sobrescribirlo. No ejecutes el importador dos veces.

## Paso 2 — Dependencias y QA

```bash
cd "$HOME/Escritorio/Ticket/TicketBridge_Nuevo"
npm ci
npm run test:qa
npx tsc --noEmit && npm run build
```

No uses `npm audit fix --force` sin evaluar actualizaciones incompatibles. Si cualquiera de los comandos falla, enviá el error antes de iniciar automatizaciones o migraciones.

## Paso 3 — Iniciar nueva aplicación

Terminal 1:
```bash
cd "$HOME/Escritorio/Ticket/TicketBridge_Nuevo"
npm run dev
```

Terminal 2:
```bash
cd "$HOME/Escritorio/Ticket/TicketBridge_Nuevo"
npm run whatsapp
```

Terminal 3: (sin datos privados)
```bash
curl -fsS http://127.0.0.1:3000/api/whatsapp/status | python3 -m json.tool
curl -fsS http://127.0.0.1:3000/api/diagnostics/visibility | python3 -m json.tool
```

Abrir http://127.0.0.1:3000, y consultar Chats, Contactos y Tickets.

## Si aún ves chats vacíos

La API de diagnóstico distingue 4 situaciones sin mostrar números: `visibleMessages` (mensajes pertenecientes a esta cuenta), `unassignedMessages` (historial antiguo no asociado), `otherAccountMessages` (otra identidad registrada), `totalMessages`. **No se reasignan mensajes de otra cuenta automáticamente**. Si hay solo mensajes sin asociar, en la pantalla de chats aparece «Asociar a esta cuenta», con confirmación manual. Si hay mensajes de otra identidad, verificá primero el origen; no cambies account_id por SQL.

## Alcance y límites

- La aplicación y el conector siguen usando puertos 3000 y 3217: **no pueden ejecutar simultáneamente la instalación antigua y la nueva**. La instalación antigua permanece intacta en disco.
- El endpoint de lectura remota, cuando WhatsApp no entrega datos, responde indicando `ok:false,skipped:true` en lugar de crear un bucle de 503. Esto no significa que se haya sincronizado el visto; los chats locales deben seguir visibles.
- La búsqueda de contactos prioriza la agenda real; si no responde, busca solamente contactos locales *de la cuenta verificada*, señalando origen `local`. Esto no equivale a toda la agenda de WhatsApp.
- El menú oficial de lista/botones de Cloud API continúa en fase de preparación/simulación: el conector `whatsapp-web.js` usa el menú de texto 1–4. No se pretende que el ZIP envíe botones oficiales sin habilitar Meta.
- Tickets Jira con error HTTP 404 requieren revisar existencia y permisos en Jira. Este ZIP no «repara» tickets en la plataforma.
- Los chats, imágenes y tickets reales requieren la importación de `data/` y pruebas en el equipo del usuario. La copia descargada **no incluye datos privados**.

## Qué fue modificado o añadido

- Carpeta completa `whatsapp/` incluida para que `npm run whatsapp` no falle por archivos ausentes.
- `app/api/whatsapp/read-sync/route.ts`: error remoto recuperable sin 503 repetitivo.
- `app/api/whatsapp/contacts/route.ts`: recuperación parcial desde datos de la cuenta cuando la agenda externa no retorna resultados.
- `app/api/diagnostics/visibility/route.ts`: conteos de chats/mensajes sin datos sensibles.
- `app/page.tsx` y `app/globals.css`: explicación visible cuando la bandeja está vacía.
- `importar_desde_original.py`: clonar datos y sesión de forma independiente, sin sobrescribir.
- `tests/test_instalacion_nueva.cjs`, scripts `test:qa` y `diagnostico:visibilidad`.
- Se conservan los componentes de equipo unificado ya presentes en el ZIP recibido.
