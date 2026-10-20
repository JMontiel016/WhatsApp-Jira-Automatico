# TicketWhatsapp — proyecto completo y liviano

Esta carpeta contiene **todo el código fuente** de la aplicación Next.js, con conector de WhatsApp y gestión de tickets Jira. No incluye `node_modules`, `.next`, datos de clientes, contraseñas, multimedia histórica ni sesiones personales. Así el ZIP es pequeño y podés reinstalar dependencias mediante `npm ci`.

## Requisitos

Ubuntu, Node.js 22, npm y conexión a internet para instalar dependencias. El conector utiliza `whatsapp-web.js` y Chromium/Puppeteer. Es una integración **no oficial**, por lo que puede dejar de funcionar si WhatsApp cambia su plataforma.

## Instalar una copia nueva

```bash
cd "$HOME/Escritorio/Ticket/TicketWhatsapp"
bash preparar.sh
npm ci
npm run build
```

**Si ya tenés datos de `~/Escritorio/whatsapp-jira`:** antes de `bash preparar.sh`, detené ambos procesos del proyecto viejo y usá:

```bash
bash migrar-datos.sh "$HOME/Escritorio/whatsapp-jira"
```

Esto copia `.env.local`, la base SQLite, archivos adjuntos y la sesión de WhatsApp al proyecto nuevo **sin borrar el anterior**. Solo copia si el destino está vacío, para no mezclar datos. Ejecutalo con el proyecto viejo detenido. Después: `bash preparar.sh`, `npm ci` y `npm run build`.

## Ejecutar

Terminal 1:

```bash
cd "$HOME/Escritorio/Ticket/TicketWhatsapp"
npm run dev
```

Terminal 2:

```bash
cd "$HOME/Escritorio/Ticket/TicketWhatsapp"
npm run whatsapp
```

Abrí http://127.0.0.1:3000.

## Verificar

```bash
npm run build
npm run verificar
curl -s http://127.0.0.1:3000/api/whatsapp/status
curl -s http://127.0.0.1:3217/status
```

`npm run verificar` comprueba archivos y conexiones; si los procesos no están levantados, muestra `SIN INICIAR`, algo esperable antes de arrancar.

## Configuración y automatización

- **Configuración → Herramientas → Asistente automático**: el bot está apagado por defecto. Atiende mensajes privados nuevos fuera de horario, fines de semana y feriados cargados.
- Menú: Futura100 (empresa, RUC, inconveniente), Talento100 (nombre, cédula, correo, inconveniente), Consulta TI (inconveniente), Otro sistema (nombre del sistema, correo, inconveniente).
- Imagen/documento opcional; `LISTO` crea el ticket una vez que se completan los datos. Al confirmar Jira, devuelve el ticket real (ej. `CW-123`). No inventa números.
- Permite configurar un Account ID de responsable de guardia. Reglas específicas para nivel 2 y encargada **aún no implementadas**.
- **Configuración → Herramientas → Vinculación WhatsApp**: QR visible solo al desvincularse. En el chat se muestra aviso y enlace hacia esa configuración.
- Para crear tickets reales, cargá las variables `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` y el tipo de solicitud, y activá `ENABLE_REAL_JIRA=true` después de pruebas.

## Limpieza segura

```bash
bash limpiar-caches-seguro.sh              # solo vista previa
npm run limpiar                             # borra cachés y logs temporales
```

No se borran bases, medios, sesiones ni `.env.local`. No ejecutés `npm audit fix --force` sin revisar las incompatibilidades.

## Limitaciones y seguridad

La sincronización de WhatsApp, imágenes y Jira requiere que los servicios estén disponibles. Si el equipo se apaga, no puede enviar mensajes en ese período. La descarga multimedia depende de WhatsApp Web. La interfaz consulta periódicamente el estado y se reintenta la descarga; una confirmación incierta de Jira se deja para revisión en lugar de crear posibles duplicados. No se puede garantizar sincronización ininterrumpida. Probá con un número secundario antes de habilitar el bot y tené respaldos de `data/` y `.env.local`.
