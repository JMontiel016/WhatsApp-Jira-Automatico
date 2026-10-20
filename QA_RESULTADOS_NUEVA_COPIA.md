# Revisión QA — Entrega de copia independiente

## Hallazgos sustentados en el código del ZIP original

1. **Bloqueador de arranque**: `TicketWhatsapp(4).zip` no contiene la carpeta `whatsapp` aunque package.json ejecuta `node whatsapp/connector.cjs`. Se incluyeron los archivos de conector tomados de la entrega v6.7 previa.
2. **Bandeja vacía**: `/api/conversations` y `/api/tickets` filtran exclusivamente por `cases.account_id` de la sesión WhatsApp actual. Si los mensajes tienen cuenta vacía o corresponden a otra identidad, devuelven [] intencionalmente. El conteo `/api/diagnostics/visibility` permite demostrar el motivo sin mezclar cuentas.
3. **Sincronización de vistos**: `/api/whatsapp/read-sync` puede fallar aunque la sesión reciba mensajes e imágenes. Los fallos no deben causar peticiones 503 continuas ni vaciar la bandeja; se recuperan con estado `skipped`.
4. **Búsqueda de agenda**: la biblioteca puede no cargar toda la agenda en vivo. La vista ofrece una lista parcial de contactos locales de la cuenta, **no la agenda completa**.
5. **Diseño duplicado**: el ZIP v4 YA incluye `twSupportTeamSection` y el Centro de automatización unificado; las capturas anteriores de una interfaz con muchas pestañas son indicio de archivos antiguos en ejecución o reemplazos incompletos, no de que esta versión carezca del nuevo componente.
6. **Jira**: los errores 404 de CW-xxx pueden deberse a incidencias inexistentes o a permisos; requieren revisar la cuenta en Jira por separado.
7. **Cloud API**: la lista y botones oficiales no están listos para producción hasta comprobar la elegibilidad de coexistencia y configurar webhooks y credenciales de Meta.

## Validaciones ejecutadas en el entorno de preparación

- **OK:** estructura del proyecto y existencia de conector (`tests/test_instalacion_nueva.cjs`).
- **OK:** guardias y control de tickets (`tests/test_guardias.cjs`).
- **OK:** automatización y simulacros (`tests/test_ticketbridge_automatizacion.cjs`).
- **OK:** motor de menú interactivo/simulador (`tests/test_cloud_menu.cjs`).
- **OK:** pruebas del panel unificado (`tests/test_guardias_ui.cjs`).
- **OK:** compatibilidad de cuenta (`tests/test_cuenta_unificada.cjs`).
- **OK:** recuperación de sesión y QR (pruebas simuladas).
- **OK:** 92 archivos TS/TSX sin errores de análisis sintáctico usando el parser TypeScript.
- **OK:** clonador de datos probado con SQLite y multimedia ficticios, sin modificar la fuente y con bloqueo de segunda importación.
- **NO COMPLETADO AQUÍ:** `npm ci` por falta de acceso funcional a dependencias en este entorno; por ello no se pudo validar build completo ni ejecutar test que requiere `better-sqlite3`.
- **NO COMPROBADO:** mensajes, agenda y Jira en cuentas reales; dependencias, autenticación, red y permisos del equipo Ubuntu.

## Seguridad

- ZIP sin `.env.local`, SQLite, perfiles, datos de contactos, tokens ni archivos multimedia.
- Copia local de la base usando `sqlite3.backup()` con puertos detenidos.
- No se reasignan datos de otras cuentas ni se envían mensajes de prueba automáticamente.
- Las vulnerabilidades `npm audit` reportadas previamente requieren revisión; no se ejecutó `npm audit fix --force`.
