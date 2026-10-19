# Asistente fuera de horario y vinculación QR (propuesta)

## Alcance
Esta rama no modifica la rama principal. El bot comienza **desactivado**. Se activa en Configuración > Herramientas > Asistente automático y requiere `ENABLE_REAL_JIRA=true` para crear tickets.

- Horarios: utiliza `America/Asuncion`, horarios guardados, fines de semana y feriados configurados.
- Respuestas: menú numérico 1 Futura100, 2 Talento100, 3 Consulta TI, 4 Otro sistema.
- Futura100: RUC y descripción.
- Talento100: nombre, cédula, correo y descripción.
- TI: descripción y derivación a equipo.
- Otros: sistema, correo y descripción.
- Luego solicita imagen o archivo opcional. `LISTO` termina el registro sin adjuntos.
- Solo un ticket por sesión completa; se almacena estado de la conversación en SQLite.
- En Jira se usa título `CLIENTE - TEMA`, campos CLIENTE y SISTEMA cuando existen, y descripción detallada.
- Adjuntos: se sincronizan por `lib/jira-evidence.ts`. Si falla la descarga, se deja advertencia y revisión.
- Encargado de guardia: ID de cuenta Jira configurable opcionalmente. Una versión posterior puede asignar soporte nivel 1, nivel 2 y coordinadora, rotaciones y escalamiento.
- QR: Configuración > Herramientas > Vinculación WhatsApp. El conector solo expone el QR temporal detrás del secreto local; cuando está conectado, el QR desaparece.
- En panel aparece aviso y acceso a Configuración si WhatsApp no está conectado.

## Riesgos conocidos y pendientes
- Se usa `whatsapp-web.js` no oficial: WhatsApp puede cambiar la compatibilidad, incluyendo descargas, envíos y QR. Para botones nativos interactivos se recomienda evaluar API oficial de WhatsApp Business.
- Se debe validar el flujo completo en ambiente local antes de habilitar en producción: `npm ci`, `npm run build`, `npm run whatsapp`, menú, cada formulario, imágenes, conexión/desconexión y Jira CW.
- No se reintentan automáticamente llamadas de creación a Jira con resultado incierto (se marca revisión), evitando tickets duplicados.
- Las respuestas se envían solo si la API local recibió el mensaje. Si el proceso se cae entre enviar y confirmar, verificar el historial antes de reintentar.
- Cédula, RUC y correo son datos sensibles: la base y las evidencias deben mantenerse locales, con acceso restringido y retención controlada.
- WhatsApp desconectado no puede entregar mensajes salientes ni solicitar el formulario hasta reconectarse.
- No se envían claves de tickets inventadas; se utiliza la clave real que devuelve Jira.
- Crear tickets y respuestas desde dispositivos de prueba, no desde datos productivos.

## Instalación (solo cuando la rama haya pasado pruebas)
```bash
git fetch origin
git switch feature/asistente-fuera-horario-qr
npm ci
npm run build
npm run dev
# segunda terminal:
npm run whatsapp
```
La base se migra sin borrar mensajes, tickets ni sesiones existentes. Guardar copia privada de `data/` y `.env.local` antes de instalar.
