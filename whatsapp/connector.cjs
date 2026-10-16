
'use strict';

/*
 * TicketBridge - Conector WhatsApp
 * Compatible con Node.js 22 y whatsapp-web.js 1.34.7.
 *
 * Funciones:
 * - Recepción de mensajes entrantes y salientes.
 * - Identificación de conversaciones y mensajes.
 * - Descarga automática de multimedia.
 * - Recuperación individual y por lotes.
 * - Búsqueda de contactos.
 * - Envío manual de respuestas.
 * - Protección de sesiones y mensajes duplicados.
 *
 * No crea tickets automáticamente.
 */

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env.local')
});

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
// whatsapp-web.js v1.34.7: Message._patch recibe id.$1 en algunas
// versiones de WhatsApp Web, mientras downloadMedia() lee _serialized.
// Se corrige antes de crear el cliente, también para fetchMessages y reload.
const { patchMessageSerialization } = require('./compat-message.cjs');
let messagePrototypePatched = false;
try {
  const MessageModel = require('whatsapp-web.js/src/structures/Message');
  const result = patchMessageSerialization(MessageModel);
  messagePrototypePatched = result.installed;
  console.log('[MEDIA] Normalización de ID:', result.reason);
} catch (error) {
  console.warn('[MEDIA] No se pudo activar la normalización:',
    String(error?.message || error).slice(0,250));
}

const qrcode = require('qrcode-terminal');

const API_BASE = 'http://127.0.0.1:3000';
const PORT = 3217;
const SECRET = process.env.WHATSAPP_LOCAL_SECRET;

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SEEN_FILE = path.join(DATA_DIR, 'whatsapp-processed.json');

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const MAX_PROCESSED = 3000;
const HISTORY_LIMIT = 250;

// Estado comprobable del ajuste del paquete instalado. No basta con el
// parche de objetos Node: parte del código de WhatsApp corre en Chromium.
function installedMediaFix() {
  try {
    const file = require.resolve('whatsapp-web.js/src/util/Injected/Utils.js');
    const code = fs.readFileSync(file, 'utf8');
    return code.includes('chat.id._serialized || chat.id.$1') &&
      code.includes('msg.id.$1');
  } catch { return false; }
}
const packageMediaPatched = installedMediaFix();
if (!packageMediaPatched) console.warn(
  '[MEDIA] Falta verificar reparación de node_modules. Ejecutá node scripts/reparar-whatsapp.cjs y reiniciá el conector.'
);

if (!SECRET || SECRET.length < 24) {
  console.error(
    '[SEGURIDAD] WHATSAPP_LOCAL_SECRET inválido.'
  );
  process.exit(1);
}

if (process.env.WHATSAPP_AUTO_CREATE === 'true') {
  console.error(
    '[SEGURIDAD] Desactivá WHATSAPP_AUTO_CREATE.'
  );
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, {
  recursive: true,
  mode: 0o700
});

// ========================================
// ESTADO Y CONTROL DE DUPLICADOS
// ========================================

let ready = false;
let compatibility = 'pending';

let seen = new Set();

try {
  const saved = JSON.parse(
    fs.readFileSync(SEEN_FILE, 'utf8')
  );

  if (Array.isArray(saved)) {
    seen = new Set(saved);
  }
} catch {
  // Primera ejecución.
}

const inFlight = new Set();
const knownChatIds = new Map();
const recentMediaHistory = new Map();

function persistSeen() {
  const items = Array.from(seen).slice(-MAX_PROCESSED);

  seen = new Set(items);

  fs.writeFileSync(
    SEEN_FILE,
    JSON.stringify(items),
    { mode: 0o600 }
  );
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorText(error) {
  return String(
    error?.message || error || 'Error desconocido'
  ).slice(0, 400);
}

// ========================================
// IDENTIFICADORES DE WHATSAPP
// ========================================

function serializedId(id) {
  if (!id) return '';

  if (typeof id === 'string') return id;

  if (
    typeof id._serialized === 'string' &&
    id._serialized
  ) {
    return id._serialized;
  }

  if (
    typeof id.$1 === 'string' &&
    id.$1
  ) {
    return id.$1;
  }

  if (
    typeof id.fromMe === 'boolean' &&
    typeof id.remote === 'string' &&
    typeof id.id === 'string'
  ) {
    return `${id.fromMe}_${id.remote}_${id.id}`;
  }

  return '';
}

function normalizeId(id) {
  if (!id || typeof id !== 'object') return id;

  const original = serializedId(id);

  if (!original || id._serialized === original) {
    return id;
  }

  try {
    id._serialized = original;

    if (id._serialized === original) {
      return id;
    }
  } catch {
    // Algunos identificadores son de solo lectura.
  }

  return {
    ...id,
    _serialized: original
  };
}

function normalizeMessage(message) {
  if (!message) return message;

  if (message.id) {
    message.id = normalizeId(message.id);
  }

  return message;
}

function isMediaMessage(message) {
  const type = String(message?.type || '').toLowerCase();
  return Boolean(message?.hasMedia || ['image','video','audio','ptt','document','sticker','gif'].includes(type));
}

function messageId(message) {
  return serializedId(message?.id);
}

// whatsapp-web.js 1.34.7 lanza "Invalid serialized message id specified"
// cuando el identificador guardado no tiene tres o cuatro partes.
// En ese caso usar el historial REAL, nunca inventar una clave ni enviar
// el identificador inválido a getMessageById().
function validMessageLookupId(id) {
  if (typeof id !== 'string' || id.length < 12 || id.length > 300) return false;
  const parts = id.split('_');
  return (parts.length === 3 || parts.length === 4) &&
    /^(true|false)$/.test(parts[0]) &&
    /^[\w-]{5,100}@(c\.us|lid|g\.us)$/.test(parts[1]) &&
    /^[A-Za-z0-9-]{5,120}$/.test(parts[2]) &&
    (parts.length !== 4 || /^[\w.@-]{3,150}$/.test(parts[3]));
}

function chatId(chat) {
  return serializedId(chat?.id);
}

function validPrivateChatId(id) {
  return (
    typeof id === 'string' &&
    /^\d{5,40}@(c\.us|lid)$/.test(id)
  );
}

function validGroupChatId(id) {
  return typeof id === 'string' && /^[0-9-]{5,50}@g\.us$/.test(id);
}
function validConversationId(id) {return validPrivateChatId(id) || validGroupChatId(id);}

// WhatsApp Web puede entregar "from" como miembro del grupo en algunos
// eventos/compilaciones. id.remote es la conversación, author el participante.
// No inventar un grupo a partir del contenido o el número del autor.
function jid(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const serialized = serializedId(value);
  if (serialized) return serialized;
  const user = String(value.user || '');
  const server = String(value.server || '');
  return user && /^(g\.us|c\.us|lid)$/.test(server) ? `${user}@${server}` : '';
}

async function resolveMessageConversation(message, outbound) {
  const from = jid(message.from);
  const to = jid(message.to);
  const remote = jid(message.id?.remote) || jid(message._data?.id?.remote);
  // La clave del mensaje, cuando existe, define el chat de destino.
  if (validGroupChatId(remote)) return remote;
  if (validGroupChatId(from)) return from;
  if (validGroupChatId(to)) return to;
  // El autor suele existir en grupos, pero también en algunos mensajes
  // privados. Solo getChat().isGroup permite confirmarlo sin adivinar.
  if (message.author || message._data?.author || message._data?.isGroupMsg) {
    try {
      const chat = await message.getChat();
      const exact = jid(chat?.id);
      if (validGroupChatId(exact) && chat?.isGroup !== false) return exact;
    } catch (error) {
      console.warn('[GRUPOS] No se pudo consultar el chat:', errorText(error));
    }
  }
  return outbound ? to : from;
}

const NON_CHAT_TYPES = new Set([
  'notification_template', 'notification', 'gp2', 'e2e_notification',
  'protocol', 'ciphertext', 'call_log'
]);

function rememberChat(id) {
  if (!validConversationId(id)) return;
  knownChatIds.set(validGroupChatId(id) ? id : id.split('@')[0], id);
}

// ========================================
// CLIENTE WHATSAPP
// ========================================

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'ticketbridge-test',
    dataPath: path.join(DATA_DIR, '.wwebjs_auth')
  }),

  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  }
});

// ========================================
// COMPATIBILIDAD DE IDENTIFICADORES
// ========================================

async function repairWebMessageKeys() {
  if (!client.pupPage || client.pupPage.isClosed()) {
    return false;
  }

  try {
    const result = await client.pupPage.evaluate(() => {
      const store = window.Store;

      const prototypes = [
        store?.MsgKey?.prototype,
        store?.WAWebMsgKey?.prototype
      ];

      let available = 0;
      let repaired = 0;

      for (const proto of prototypes) {
        if (!proto) continue;

        available++;

        if ('_serialized' in proto) continue;

        try {
          Object.defineProperty(proto, '_serialized', {
            configurable: true,

            get() {
              return this.$1;
            },

            set(value) {
              this.$1 = value;
            }
          });

          repaired++;
        } catch {
          // El prototipo no permite modificaciones.
        }
      }

      return { available, repaired };
    });

    compatibility = result.available
      ? (messagePrototypePatched ? 'browser-and-node-patched' : 'browser-patched')
      : (messagePrototypePatched ? 'node-patched' : 'unavailable');

    console.log(
      '[WHATSAPP] Compatibilidad:',
      compatibility,
      'prototipos:',
      result.available,
      'reparados:',
      result.repaired
    );

    return result.available > 0;

  } catch (error) {
    compatibility = messagePrototypePatched ? 'node-patched' : 'failed';

    console.warn(
      '[WHATSAPP] Compatibilidad:',
      errorText(error)
    );

    return false;
  }
}

// ========================================
// EVENTOS DE CONEXIÓN
// ========================================

client.on('qr', qr => {
  console.log(
    '[WHATSAPP] Escaneá el QR desde dispositivos vinculados.'
  );

  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('[WHATSAPP] Sesión autenticada.');
});

client.on('ready', async () => {
  ready = false;

  await repairWebMessageKeys();

  ready = true;

  console.log(
    '[WHATSAPP] Conectado. Escuchando mensajes.'
  );
});

client.on('auth_failure', error => {
  ready = false;

  console.error(
    '[WHATSAPP] Error de autenticación:',
    errorText(error)
  );
});

client.on('disconnected', reason => {
  ready = false;
  recentMediaHistory.clear();

  console.warn(
    '[WHATSAPP] Desconectado:',
    reason
  );
});

client.on('change_state', state => {
  console.log('[WHATSAPP] Estado:', state);
});

// ========================================
// DESCARGA DE ARCHIVOS
// ========================================

// Fallback para whatsapp-web.js 1.34.7: algunas versiones de WhatsApp Web
// requieren que el MIME original se transmita al gestor de descarga.
// Los enlaces directPath no son imágenes públicas: son archivos cifrados.
// Este método descarga y descifra SOLO en la sesión vinculada.
async function downloadBrowserMediaWithMime(message) {
  const id = messageId(message);
  if (!id || !client.pupPage || client.pupPage.isClosed()) return null;
  // El $1 del mensaje es la clave completa, no una URL pública de descarga.
  // La búsqueda anterior utilizaba únicamente WAWebCollections, que no está
  // disponible en todas las compilaciones de WhatsApp Web.
  const result = await client.pupPage.evaluate(async (msgId) => {
    try {
      const stores = [];
      if (window.Store?.Msg) stores.push(window.Store.Msg);
      try {
        const c = window.require?.('WAWebCollections');
        if (c?.Msg && !stores.includes(c.Msg)) stores.push(c.Msg);
      } catch { /* Módulo renombrado en algunas versiones. */ }
      let model = null;
      for (const collection of stores) {
        try { model = await collection.get(msgId); } catch { /* Otra vista. */ }
        if (model) break;
        try {
          const matches = await collection.getMessagesById?.([msgId]);
          model = matches?.messages?.[0] || (Array.isArray(matches) ? matches[0] : null);
        } catch { /* El índice de WhatsApp no está disponible. */ }
        if (model) break;
      }
      if (!model) return {error:'El identificador del mensaje no está en el índice de WhatsApp Web'};
      const media = model.mediaData || model;
      const originalMime = model.mimetype || media.mimetype || '';
      if (!originalMime) return {error:'WhatsApp no facilitó el tipo de archivo (MIME)'};
      if (media.mediaStage === 'REUPLOADING')
        return {error:'WhatsApp solicitó el archivo al remitente; todavía no está disponible'};
      if (media.mediaStage !== 'RESOLVED' && typeof model.downloadMedia === 'function') {
        try { await model.downloadMedia({downloadEvenIfExpensive:true,rmrReason:1}); }
        catch { /* La descarga con MIME a continuación puede funcionar. */ }
      }
      let manager = window.Store?.DownloadManager;
      if (!manager?.downloadAndMaybeDecrypt) {
        try { const m=window.require?.('WAWebDownloadManager');manager=m?.downloadManager || m; }
        catch { /* No disponible. */ }
      }
      if (typeof manager?.downloadAndMaybeDecrypt !== 'function')
        return {error:'WhatsApp Web no expone un gestor de descarga compatible'};
      const fields = model.mediaData || model;
      const options = {
        directPath:fields.directPath || model.directPath,
        encFilehash:fields.encFilehash || model.encFilehash,
        filehash:fields.filehash || model.filehash,
        mediaKey:fields.mediaKey || model.mediaKey,
        mediaKeyTimestamp:fields.mediaKeyTimestamp || model.mediaKeyTimestamp,
        type:model.type,
        mimetype:originalMime,
        signal:new AbortController().signal,
        downloadQpl:{addAnnotations(){return this;},addPoint(){return this;}}
      };
      if (!options.directPath || !options.mediaKey)
        return {error:'WhatsApp no facilitó la clave o ruta cifrada del archivo'};
      const buffer = await manager.downloadAndMaybeDecrypt(options);
      if (!buffer) return {error:'El gestor no entregó bytes del archivo'};
      if (typeof window.WWebJS?.arrayBufferToBase64Async !== 'function')
        return {error:'WhatsApp Web no tiene codificador multimedia compatible'};
      const data = await window.WWebJS.arrayBufferToBase64Async(buffer);
      return data ? {data,mimetype:originalMime,filename:model.filename || media.filename || ''}
                  : {error:'El archivo descifrado quedó vacío'};
    } catch (error) {
      return {error:String(error?.name || 'Error') + ': ' +
        String(error?.message || error || 'Fallo de descarga').slice(0,140)};
    }
  }, id);
  if (result?.data) {
    console.log('[MEDIA] Descarga alternativa desde la sesión, bytes base64:', result.data.length);
    return result;
  }
  if (result?.error) throw new Error('WhatsApp Web: '+result.error);
  return null;
}

async function downloadCandidate(message, attempts = 3) {
  normalizeMessage(message);

  if (!isMediaMessage(message)) {
    throw new Error('Este mensaje no corresponde a un archivo multimedia.');
  }

  let lastError = 'WhatsApp no entregó el archivo';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      normalizeMessage(message);

      if (attempt > 1 && typeof message.reload === 'function') {
        await message.reload().catch(() => {});
        normalizeMessage(message);
      }

      let attachment;
      try {
        attachment = await message.downloadMedia();
      } catch (primaryError) {
        // Si el ID funciona pero el gestor no recibe el MIME, probar ruta
        // alternativa del propio WhatsApp Web (no una URL pública).
        try { attachment = await downloadBrowserMediaWithMime(message); }
        catch (fallbackError) {
          console.warn('[MEDIA] Ruta principal:', errorText(primaryError));
          throw fallbackError;
        }
        if (!attachment) throw primaryError;
      }
      if (!attachment?.data) attachment = await downloadBrowserMediaWithMime(message);

      if (!attachment?.data) {
        throw new Error(
          'WhatsApp devolvió un adjunto sin contenido'
        );
      }

      const mime = String(
        attachment.mimetype || 'application/octet-stream'
      ).split(';')[0].trim().toLowerCase();

      const bytes = Buffer.from(
        attachment.data,
        'base64'
      );

      if (!bytes.length) {
        throw new Error('El archivo está vacío');
      }

      if (bytes.length > MAX_MEDIA_BYTES) {
        throw new Error(
          'El archivo supera el límite de 12 MB'
        );
      }

      console.log(
        '[MEDIA] Archivo obtenido:',
        bytes.length,
        'bytes;',
        mime
      );

      return {
        mime,
        filename: String(
          attachment.filename || `archivo-${Date.now()}`
        ).slice(0, 180),
        data: attachment.data
      };

    } catch (error) {
      lastError = errorText(error);
      // Los errores de Puppeteer pueden estar minimizados a una letra.
      // Informar la clase y presencia de las propiedades, nunca números ni JIDs.
      const id = message?.id;
      const diagnostic = {
        type: String(message?.type || 'unknown').slice(0,24),
        hasMedia: Boolean(message?.hasMedia),
        idSerialized: Boolean(id?._serialized),
        idAlternative: Boolean(id?.$1),
        errorName: String(error?.name || typeof error).slice(0,50)
      };
      console.warn(
        `[MEDIA] Intento ${attempt}/${attempts}:`,
        lastError, diagnostic
      );

      // Reconsultar el mismo mensaje por ID permite recuperar un adjunto que
      // WhatsApp Web todavía no había hidratado al llegar el evento.
      if (attempt < attempts) {
        const id = messageId(message);
        if (validMessageLookupId(id)) {
          try {
            const fresh = await client.getMessageById(id);
            if (fresh && isMediaMessage(fresh) && messageId(fresh) === id) message = normalizeMessage(fresh);
          } catch (lookupError) {
            console.warn('[MEDIA] Consulta individual no disponible:', errorText(lookupError));
          }
        }
        // Las sesiones con @lid y mensajes antiguos pueden tener una clave
        // incompatible con getMessageById. Recuperar desde el chat, pero
        // únicamente si la coincidencia es única y comprobable.
        if (attempt === attempts - 1) {
          try {
            const cid = await resolveMessageConversation(message, Boolean(message.fromMe));
            if (validConversationId(cid)) {
              const chat = await client.getChatById(cid);
              const recent = (await chat.fetchMessages({ limit: 120 })).map(normalizeMessage);
              let matches = validMessageLookupId(id)
                ? recent.filter(m => isMediaMessage(m) && messageId(m) === id)
                : [];
              if (!matches.length) {
                const timestamp = Number(message.timestamp);
                const caption = String(message.body || '').trim();
                const kind = String(message.type || '').toLowerCase();
                matches = recent.filter(m =>
                  isMediaMessage(m) && Boolean(m.fromMe) === Boolean(message.fromMe) &&
                  Number.isFinite(timestamp) && Math.abs(Number(m.timestamp) - timestamp) <= 3 &&
                  String(m.type || '').toLowerCase() === kind &&
                  String(m.body || '').trim() === caption
                );
              }
              if (matches.length === 1) message = matches[0];
            }
          } catch (historyError) {
            console.warn('[MEDIA] Historial alternativo no disponible:', errorText(historyError));
          }
        }
        await wait(900 * attempt);
      }
    }
  }

  throw new Error(
    `No se pudo recuperar el archivo: ${lastError}`
  );
}

// ========================================
// ENVÍO AL BACKEND LOCAL
// ========================================

async function ingest(payload) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    30000
  );

  try {
    const response = await fetch(
      `${API_BASE}/api/whatsapp/ingest`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-local-connector-secret': SECRET
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );

    const raw = await response.text();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch {
      // Respuesta no JSON.
    }

    if (!response.ok) {
      throw new Error(
        `Backend HTTP ${response.status}: ${raw.slice(0, 350)}`
      );
    }

    return data;

  } finally {
    clearTimeout(timeout);
  }
}

// ========================================
// CONTACTOS
// ========================================

async function contactDetails(message, sender) {
  let name = '';
  let avatarUrl = '';

  try {
    const contact = await message.getContact();

    name = String(
      contact?.name ||
      contact?.pushname ||
      ''
    ).trim().slice(0, 120);

    try {
      avatarUrl = String(
        await contact?.getProfilePicUrl?.() || ''
      ).slice(0, 1500);
    } catch {
      // La foto de perfil es opcional.
    }

  } catch (error) {
    console.warn(
      '[CONTACTO] No se pudo consultar contacto:',
      errorText(error)
    );
  }

  if (!name) {
    try {
      const chat = await message.getChat();

      name = String(chat?.name || '')
        .trim()
        .slice(0, 120);

    } catch {
      // El identificador del chat sigue disponible.
    }
  }

  if (!name) {
    name = String(
      message?._data?.notifyName ||
      `WhatsApp ${sender.split('@')[0]}`
    ).slice(0, 120);
  }

  if (!/^https:\/\/\S+$/.test(avatarUrl)) {
    avatarUrl = '';
  }

  return { name, avatarUrl };
}

// La descarga no debe impedir que el texto se registre inmediatamente.
// Máximo dos transferencias concurrentes para no saturar la sesión vinculada.
const mediaQueue = [];
const mediaQueued = new Set();
let activeMediaDownloads = 0;
const MAX_MEDIA_PARALLEL = 2;

function enqueueMediaDownload(eventId, message, payload, retry = 0) {
  if (!ready || mediaQueued.has(eventId)) return;
  mediaQueued.add(eventId);
  mediaQueue.push({ eventId, message, payload, retry });
  drainMediaQueue();
}

function drainMediaQueue() {
  while (ready && activeMediaDownloads < MAX_MEDIA_PARALLEL && mediaQueue.length) {
    const job = mediaQueue.shift();
    activeMediaDownloads++;
    void (async () => {
      try {
        const media = await downloadCandidate(job.message, job.retry ? 2 : 3);
        const result = await ingest({ ...job.payload, media, mediaError: '' });
        if (result.mediaSaved !== true) {
          throw new Error('El backend no confirmó el guardado del adjunto');
        }
        console.log('[MEDIA] Sincronizado con mensaje existente:',
          'caso:', result.caseId || '-', 'mensaje:', job.eventId.slice(-40),
          'intento:', job.retry + 1);
      } catch (error) {
        const reason = errorText(error);
        console.warn('[MEDIA] Imagen pendiente:', reason, 'intento:', job.retry + 1);
        // El placeholder permanece visible mientras no se dispone de bytes reales.
        try {
          await ingest({ ...job.payload, mediaError: reason });
        } catch (ingestError) {
          console.warn('[MEDIA] Estado pendiente de registro:', errorText(ingestError));
        }
        if (job.retry < 2) {
          const delay = job.retry === 0 ? 15000 : 60000;
          const timer = setTimeout(() => {
            enqueueMediaDownload(job.eventId, job.message, job.payload, job.retry + 1);
          }, delay);
          timer.unref?.();
        }
      } finally {
        activeMediaDownloads--;
        mediaQueued.delete(job.eventId);
        drainMediaQueue();
      }
    })();
  }
}

// ========================================
// PROCESAMIENTO DE MENSAJES
// ========================================

async function processMessage(message, outbound = false) {
  normalizeMessage(message);

  // Los cambios de integrantes, mensajes de seguridad y notificaciones
  // internas NO son chats ni archivos; antes aparecían como contactos nuevos.
  if (NON_CHAT_TYPES.has(String(message.type || '').toLowerCase())) return;
  if ((!outbound && message.fromMe) || message.from === 'status@broadcast') return;

  const sender = await resolveMessageConversation(message, outbound);
  const isGroup = validGroupChatId(sender);

  if (!validConversationId(sender)) {
    console.warn(
      '[WHATSAPP] Mensaje con identificador no compatible.'
    );
    return;
  }

  rememberChat(sender);

  const timestamp = Number(message.timestamp);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return;
  }

  const originalId = messageId(message);

  const eventId = originalId || (
    'fallback-' +
    createHash('sha256')
      .update(JSON.stringify([
        sender,
        timestamp,
        message.body,
        message.type,
        outbound
      ]))
      .digest('hex')
  );

  if (seen.has(eventId) || inFlight.has(eventId)) {
    return;
  }

  inFlight.add(eventId);

  try {
    const phone = isGroup ? sender : sender.split('@')[0];

    const receivedAt = new Date(
      timestamp * 1000
    ).toISOString();

    const text = (
      typeof message.body === 'string' &&
      message.body.trim()
    )
      ? message.body.slice(0, 3000)
      : `[Adjunto WhatsApp: ${message.type || 'archivo'}]`;

    const contact = isGroup ? {name:'', avatarUrl:''} : await contactDetails(message, sender);
    let groupName = '';
    let senderName = '';
    if (isGroup) {
      try {
        const chat = await message.getChat();
        if (jid(chat?.id) === sender) groupName = String(chat.name || '').slice(0,120);
      } catch (error) { console.warn('[GRUPOS] Nombre no disponible:', errorText(error)); }
      const author = jid(message.author) || jid(message._data?.author) ||
                     jid(message.id?.participant) || jid(message._data?.id?.participant);
      if (validPrivateChatId(author)) {
        try {
          const participant = await client.getContactById(author);
          senderName = String(participant?.name || participant?.pushname || '').trim().slice(0,120);
        } catch { /* El nombre guardado es opcional. */ }
        if (!senderName) senderName = author.split('@')[0];
      } else {
        senderName = 'Integrante';
      }
      try {const pic=await client.getProfilePicUrl(sender);if(/^https:\/\/\S+$/.test(pic||''))contact.avatarUrl=pic.slice(0,1500);}catch{}
    }
    const payload = {
      eventId,
      waMessageId: originalId || '',
      chatId: sender,
      phone,
      customer: isGroup ? (groupName || 'Grupo '+phone.split('@')[0]) : contact.name,
      avatarUrl: contact.avatarUrl,
      isGroup,
      senderName: isGroup ? senderName : '',
      ack: outbound && Number.isInteger(message.ack) ? message.ack : undefined,
      message: text,
      receivedAt,
      outbound: Boolean(outbound),
      hasMedia: isMediaMessage(message)
    };

    // Registrar el mensaje primero: si la imagen tarda o la biblioteca falla,
    // el chat y los tickets siguen funcionando sin quedar bloqueados.
    const result = await ingest(payload);

    seen.add(eventId);
    persistSeen();

    console.log('[TICKETBRIDGE] Mensaje registrado:',
      result.status || 'ok', 'caso:', result.caseId || '-');

    // Enviar el archivo con el MISMO eventId: la API actualiza esa fila.
    if (isMediaMessage(message)) {
      enqueueMediaDownload(eventId, message, payload);
    }

  } catch (error) {
    console.error(
      '[TICKETBRIDGE] Error procesando mensaje:',
      errorText(error)
    );

  } finally {
    inFlight.delete(eventId);
  }
}

client.on('message', message => {
  recentMediaHistory.clear();
  processMessage(message, false).catch(error => {
    console.error(
      '[WHATSAPP] Recepción:',
      errorText(error)
    );
  });
});

client.on('message_ack',(message,ack)=>{
  if(!message?.fromMe || !Number.isInteger(ack))return;
  const id=messageId(normalizeMessage(message));
  if(!id)return;
  fetch(`${API_BASE}/api/whatsapp/ack`,{
    method:'POST',headers:{'Content-Type':'application/json','x-local-connector-secret':SECRET},
    body:JSON.stringify({id,ack}),signal:AbortSignal.timeout(10000)
  }).catch(e=>console.warn('[WHATSAPP] Confirmación pendiente:',errorText(e)));
});

client.on('message_create', message => {
  if (!message.fromMe) return;
  recentMediaHistory.clear();

  processMessage(message, true).catch(error => {
    console.error(
      '[WHATSAPP] Mensaje saliente:',
      errorText(error)
    );
  });
});

// ========================================
// HISTORIAL MULTIMEDIA
// ========================================

async function getCachedMediaHistory(chat) {
  const id = chatId(chat);

  const previous = recentMediaHistory.get(id);

  if (
    previous &&
    Date.now() - previous.time < 45000
  ) {
    return previous.messages;
  }

  const messages = (
    await chat.fetchMessages({
      limit: HISTORY_LIMIT
    })
  ).map(normalizeMessage);

  if (recentMediaHistory.size > 10) {
    recentMediaHistory.clear();
  }

  recentMediaHistory.set(id, {
    time: Date.now(),
    messages
  });

  return messages;
}

function recoverCandidate(item, recent) {
  const timestamp = Math.floor(
    new Date(item.receivedAt).getTime() / 1000
  );

  if (!Number.isFinite(timestamp)) {
    return { error: 'Fecha inválida' };
  }

  const outgoing = item.direction === 'out';

  const valid = recent.filter(message =>
    isMediaMessage(message) &&
    Boolean(message.fromMe) === outgoing
  );

  const wantedId = String(item.waMessageId || '');

  if (wantedId) {
    const exact = valid.find(
      message => messageId(message) === wantedId
    );

    if (exact) {
      return { message: exact };
    }
  }

  const caption = String(item.message || '').trim();

  const placeholder = /^\[Adjunto WhatsApp:\s*([^\]]+)\]/i
    .exec(caption);

  const matches = valid.filter(message => {
    if (
      Math.abs(Number(message.timestamp) - timestamp) > 3
    ) {
      return false;
    }

    if (placeholder) {
      return (
        String(message.type).toLowerCase() ===
          placeholder[1].trim().toLowerCase() &&
        !String(message.body || '').trim()
      );
    }

    return (
      Boolean(caption) &&
      String(message.body || '').trim() === caption
    );
  });

  if (matches.length === 0) {
    return {
      error: 'No se encontró el adjunto correspondiente'
    };
  }

  if (matches.length > 1) {
    return {
      error: 'Existen varios archivos coincidentes'
    };
  }

  return { message: matches[0] };
}

async function exactMediaFromId(item, chat) {
  const id = String(item.waMessageId || '');

  if (!validMessageLookupId(id)) {
    return null;
  }

  try {
    const message = normalizeMessage(
      await client.getMessageById(id)
    );

    if (!isMediaMessage(message)) return null;

    if (
      Boolean(message.fromMe) !==
      (item.direction === 'out')
    ) {
      return null;
    }

    const target = chatId(chat);

    if (
      target &&
      ![message.from, message.to, jid(message.id?.remote), jid(message._data?.id?.remote)].includes(target)
    ) {
      return null;
    }

    return message;

  } catch (error) {
    console.warn(
      '[MEDIA] Consulta por ID:',
      errorText(error)
    );

    return null;
  }
}

async function locateMedia(item, chat) {
  const exact = await exactMediaFromId(item, chat);

  if (exact) {
    return { message: exact };
  }

  const recent = await getCachedMediaHistory(chat);

  return recoverCandidate(item, recent);
}

// ========================================
// RESOLUCIÓN DE CONVERSACIONES
// ========================================

async function findExistingChat(phone) {
  if (validGroupChatId(phone)) {
    try {const group=await client.getChatById(phone);return group?.isGroup?group:null;}
    catch {return null;}
  }
  const candidates = [
    knownChatIds.get(phone),
    `${phone}@lid`,
    `${phone}@c.us`
  ];

  const checked = new Set();

  for (const id of candidates) {
    if (!id || checked.has(id)) continue;

    checked.add(id);

    try {
      const chat = await client.getChatById(id);

      if (
        chat &&
        !chat.isGroup &&
        String(chat.id?.user || '') === phone
      ) {
        normalizeId(chat.id);
        rememberChat(chatId(chat) || id);
        return chat;
      }

    } catch {
      // Probar el siguiente identificador.
    }
  }

  try {
    const chats = await client.getChats();

    const found = chats.find(chat =>
      !chat.isGroup &&
      String(chat.id?.user || '') === phone
    );

    if (found) {
      rememberChat(chatId(found));
    }

    return found || null;

  } catch (error) {
    console.warn(
      '[WHATSAPP] Búsqueda de conversación:',
      errorText(error)
    );

    return null;
  }
}

async function resolveSendChatId(phone, provided) {
  if(validGroupChatId(phone)) {
    const group=await findExistingChat(phone);
    if(!group)throw Object.assign(new Error('El grupo no está disponible en la sesión vinculada.'),{statusCode:409});
    return phone;
  }
  // Priorizar el chat seleccionado: consultar TODA la agenda con getContacts()
  // puede quedar colgado en algunas versiones de WhatsApp Web, y bloquea /send.
  // Verificar el ID exacto con getChatById sin inventar un @c.us alternativo.
  if (validPrivateChatId(provided) && provided.split('@')[0] === phone) {
    try {
      const chosen = await client.getChatById(provided);
      const exact = chatId(chosen);
      if (chosen && !chosen.isGroup && exact === provided) {
        rememberChat(exact);
        return exact;
      }
    } catch (error) {
      console.warn('[WHATSAPP] Chat seleccionado no disponible:', errorText(error));
    }
    // Un contacto nuevo puede estar en la agenda pero aún no tener chat.
    // Consultar ese contacto individualmente, no cargar todos los contactos.
    try {
      const contact = await client.getContactById(provided);
      if (serializedId(contact?.id) === provided) {
        rememberChat(provided);
        return provided;
      }
    } catch (error) {
      console.warn('[WHATSAPP] Contacto seleccionado no disponible:', errorText(error));
    }
  }

  const remembered = knownChatIds.get(phone);
  if (validPrivateChatId(remembered)) return remembered;

  const chat = await findExistingChat(phone);

  if (!chat) {
    // Un contacto guardado puede no tener mensajes previos; WhatsApp debe validar el número.
    let registered = null;
    try {registered = await client.getNumberId(phone);}catch(e){
      throw Object.assign(new Error('No se pudo verificar el número: '+errorText(e)),{statusCode:409});
    }
    const id=serializedId(registered)||registered?._serialized||'';
    if(validPrivateChatId(id)){rememberChat(id);return id;}
    throw Object.assign(new Error('El número no tiene una cuenta WhatsApp verificable.'),{statusCode:409});
  }

  const id = chatId(chat);

  if (!validPrivateChatId(id)) {
    throw Object.assign(
      new Error('Identificador de chat inválido'),
      { statusCode: 409 }
    );
  }

  return id;
}

// ========================================
// REACCIONES BIDIRECCIONALES
// ========================================

async function reactionSnapshot(phone, ids) {
  const chat = await findExistingChat(phone);
  if (!chat) throw Object.assign(new Error('Conversación no disponible'), { statusCode: 404 });
  const recent = await getCachedMediaHistory(chat).catch(() => []);
  const output = [];
  for (const waMessageId of ids) {
    if (typeof waMessageId !== 'string' || !waMessageId || waMessageId.length > 300) continue;
    let message = recent.find(m => messageId(m) === waMessageId);
    if (!message) {
      if (validMessageLookupId(waMessageId)) {
      try { message = normalizeMessage(await client.getMessageById(waMessageId)); } catch {}
    }
    }
    if (!message || messageId(message) !== waMessageId) continue;
    const target = chatId(chat);
    if (target && ![message.from,message.to,jid(message.id?.remote),jid(message._data?.id?.remote)].includes(target)) continue;
    try {
      // La caché de WhatsApp Web puede tener hasReaction=false durante varios
      // segundos tras reaccionar. No borrar reacciones locales por un dato viejo.
      if (!message.hasReaction && typeof message.reload === 'function') {
        await message.reload().catch(() => {});
        normalizeMessage(message);
      }
      if (!message.hasReaction) continue;
      const lists = await message.getReactions();
      if (!Array.isArray(lists)) continue;
      const reactions=[];
      for (const list of lists) {
        const emoji=String(list.id || list.aggregateEmoji || '');
        if (!emoji || emoji.length > 24) continue;
        const senders=Array.isArray(list.senders)?list.senders:[];
        let own=false;
        for (let i=0;i<senders.length;i++) {
          const sender=senders[i];
          const mine=Boolean(sender?.id?.fromMe);
          if (mine) own=true;
          const actorId=mine ? 'self' : (String(sender?.senderId || serializedId(sender?.id) || '') || `unknown:${emoji}:${i}`);
          reactions.push({emoji,actorId:actorId.slice(0,120)});
        }
        if (list.hasReactionByMe && !own) reactions.push({emoji,actorId:'self'});
      }
      output.push({waMessageId,reactions});
    } catch(e) { console.warn('[REACCIONES] Consulta individual:',errorText(e)); }
  }
  return output;
}

client.on('message_reaction', reaction => {
  const waMessageId=serializedId(reaction?.msgId);
  if (!waMessageId || !ready) return;
  const emoji=String(reaction?.reaction||'').slice(0,24);
  const actorId = reaction?.id?.fromMe || reaction?.senderId === serializedId(client.info?.wid) ? 'self' : String(reaction?.senderId || serializedId(reaction?.id) || '');
  if (!actorId) return;
  fetch(`${API_BASE}/api/whatsapp/reactions/ingest`,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-local-connector-secret':SECRET},
    body:JSON.stringify({waMessageId,emoji,actorId:actorId.slice(0,120)}),
    signal:AbortSignal.timeout(10000)
  }).then(res=>{if(!res.ok)console.warn('[REACCIONES] No se pudo registrar HTTP',res.status);})
    .catch(e=>console.warn('[REACCIONES] Sincronización pendiente:',errorText(e)));
});

// ========================================
// SERVIDOR LOCAL
// ========================================

function authorized(request) {
  const supplied = String(
    request.headers['x-local-connector-secret'] || ''
  );

  return (
    supplied.length === SECRET.length &&
    timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(SECRET)
    )
  );
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  response.end(JSON.stringify(data));
}

async function readBody(request, maximum = 350000) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;

    if (total > maximum) {
      const error = new Error('Solicitud demasiado grande');
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  return JSON.parse(
    Buffer.concat(chunks).toString('utf8')
  );
}


// ========================================
// CONSULTAS COMPARTIDAS Y ACOTADAS
// Una API de WhatsApp Web puede quedar pendiente mientras /status sigue OK.
// No iniciar nuevas consultas idénticas con cada solicitud del navegador.
// ========================================
function createBoundedWhatsAppReader(label, load, ttlMs, timeoutMs) {
  let cached = null;
  let cachedAt = 0;
  let pending = null;
  let pendingAt = 0;
  let lastDiagnosticAt = 0;

  return async function read() {
    const now = Date.now();
    if (cached !== null && now - cachedAt < ttlMs) {
      return { data: cached, source: 'cache' };
    }

    if (!pending) {
      pendingAt = now;
      pending = Promise.resolve()
        .then(load)
        .then(data => {
          if (!Array.isArray(data)) throw new Error('WhatsApp devolvió datos inválidos');
          cached = data;
          cachedAt = Date.now();
          return data;
        })
        .finally(() => { pending = null; pendingAt = 0; });
    }

    let timer;
    try {
      const data = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            `${label}: tiempo de espera agotado (${timeoutMs} ms)`
          )), timeoutMs);
        })
      ]);
      return { data, source: 'whatsapp' };
    } catch (error) {
      // El trabajo de Puppeteer no se puede cancelar con Promise.race.
      // Mantener SOLO una consulta subyacente hasta que finalice evita saturarlo.
      if (Date.now() - lastDiagnosticAt > 30000) {
        console.warn(`[CONTACTOS] ${label}:`, errorText(error),
          pendingAt ? `consulta pendiente ${Date.now() - pendingAt} ms` : 'consulta fallida');
        lastDiagnosticAt = Date.now();
      }
      if (cached !== null) return {
        data: cached, source: 'stale', warning: errorText(error)
      };
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

const readWhatsAppChats = createBoundedWhatsAppReader(
  'Chats', () => client.getChats(), 8000, 4000
);
const readWhatsAppContacts = createBoundedWhatsAppReader(
  'Agenda', () => client.getContacts(), 30000, 4500
);

const server = http.createServer(async (request, response) => {
  const route = request.url?.split('?')[0];

  try {
    if (request.method === 'GET' && route === '/status') {
      return sendJson(response, 200, {
        connected: ready &&
          Boolean(client.info) &&
          !client.pupPage?.isClosed?.(),
        ready,
        service: 'whatsapp-connector',
        version: 'ticketbridge-sync-v6.4',
        capabilities: ['history', 'chat-state', 'contacts', 'recover-batch', 'discover', 'read-snapshot', 'reactions', 'reactions-snapshot', 'send-media', 'media-mimetype-fallback'],
        compatibility,
        packageMediaPatched
      });
    }

    if (!authorized(request)) {
      return sendJson(response, 401, {
        error: 'No autorizado'
      });
    }

    if (!ready) {
      return sendJson(response, 503, {
        error: 'WhatsApp todavía no está conectado'
      });
    }

    // Lectura real en otros dispositivos vinculados (incluido el teléfono).
    // El estado siempre se obtiene de WhatsApp, no se inventa un visto.
    if (request.method === 'GET' && route === '/read-snapshot') {
      const snapshot = await readWhatsAppChats();
      const chats = snapshot.data;
      const items = [];
      for (const chat of chats) {
        const id = chatId(chat);
        if (!validConversationId(id)) continue;
        rememberChat(id);
        const count = Number(chat.unreadCount);
        if (!Number.isFinite(count) || count < -1) continue;
        const last=chat.lastMessage;
        const outgoingAt=last?.fromMe&&Number.isFinite(Number(last.timestamp))?Number(last.timestamp):null;
        items.push({ phone: validGroupChatId(id) ? id : id.split('@')[0], unreadCount: Math.min(Math.floor(count), 100000),lastOutgoingAt:outgoingAt });
      }
      return sendJson(response, 200, { chats: items });
    }

    // ====================================
    // BUSCADOR DE CONTACTOS
    // ====================================

    if (
      request.method === 'GET' &&
      route === '/contacts'
    ) {
      const params = new URL(
        request.url,
        'http://127.0.0.1'
      ).searchParams;

      const query = String(
        params.get('q') || ''
      ).trim().toLowerCase();

      if (query.length > 100) return sendJson(response, 400, {error:'Búsqueda inválida'});
      // Cargar ambas fuentes por separado. Si la agenda falla por una versión
      // de WhatsApp Web no bloqueamos los chats que ya existen.
      const [chatsResult, contactsResult] = await Promise.allSettled([
        readWhatsAppChats(), readWhatsAppContacts()
      ]);
      if (chatsResult.status === 'rejected' && contactsResult.status === 'rejected') {
        return sendJson(response, 504, {
          error: 'WhatsApp está conectado, pero las consultas de agenda y chats no responden dentro del tiempo esperado.',
          detail: [errorText(chatsResult.reason),errorText(contactsResult.reason)].join(' | ')
        });
      }
      const chats = chatsResult.status === 'fulfilled' ? chatsResult.value.data : [];
      const addressBook = contactsResult.status === 'fulfilled' ? contactsResult.value.data : [];
      const partial = chatsResult.status === 'rejected' || contactsResult.status === 'rejected' ||
        (chatsResult.status === 'fulfilled' && chatsResult.value.source === 'stale') ||
        (contactsResult.status === 'fulfilled' && contactsResult.value.source === 'stale');
      if (partial) console.warn('[CONTACTOS] Resultado parcial:',
        chatsResult.status === 'rejected' ? errorText(chatsResult.reason) : '',
        contactsResult.status === 'rejected' ? errorText(contactsResult.reason) : '');
      response.setHeader('X-TicketBridge-Contacts-Mode', partial ? 'partial' : 'whatsapp');
      const found = new Map();
      for(const chat of chats){
        const id=chatId(chat);
        if(!validConversationId(id))continue;
        rememberChat(id);
        const phone=validGroupChatId(id)?id:id.split('@')[0];
        found.set(phone,{phone,chatId:id,name:String(chat.name||phone).slice(0,120),isGroup:Boolean(chat.isGroup),unreadCount:Number(chat.unreadCount)||0});
      }
      for(const contact of addressBook){
        const id=serializedId(contact?.id) || (contact?.id?.user && contact?.id?.server ? `${contact.id.user}@${contact.id.server}` : '');
        if(!validPrivateChatId(id))continue;
        const phone=id.split('@')[0];
        if(found.has(phone))continue;
        const name=String(contact.name||contact.pushname||phone).slice(0,120);
        const displayPhone=String(contact.number||'').replace(/\D/g,'');
        found.set(phone,{phone,chatId:id,name,isGroup:false,unreadCount:0,displayPhone:displayPhone.length>=5&&displayPhone.length<=40?displayPhone:undefined});
      }
      const contacts=[...found.values()].filter(c=>
        !query || `${c.name} ${c.phone} ${c.displayPhone||''}`.toLowerCase().includes(query)
      ).sort((a,b)=>a.name.localeCompare(b.name,'es')).slice(0,500);
      return sendJson(response, 200, contacts);
    }

    if (request.method !== 'POST') {
      return sendJson(response, 404, {
        error: 'Ruta no encontrada'
      });
    }

    if (
      ![
        '/send',
        '/send-media',
        '/forward',
        '/chat-state',
        '/history',
        '/recover',
        '/recover-batch',
        '/discover',
        '/react',
        '/reactions-snapshot'
      ].includes(route)
    ) {
      return sendJson(response, 404, {
        error: 'Ruta no encontrada'
      });
    }

    // Las imágenes base64 requieren un límite mayor que el JSON de texto.
    // La validación exacta de bytes y formato se realiza debajo.
    const input = await readBody(request, route === '/send-media' ? 18_000_000 : 350000);

    if (route === '/react') {
      const {phone,waMessageId,emoji}=input||{};
      if (!(typeof phone==='string'&&(/^\d{5,40}$/.test(phone)||validGroupChatId(phone))) ||
          typeof waMessageId!=='string'||waMessageId.length<12||waMessageId.length>300||
          typeof emoji!=='string'||emoji.length>24 || (emoji && !/\p{Extended_Pictographic}/u.test(emoji)))
        return sendJson(response,400,{error:'Reacción inválida'});
      const chat=await findExistingChat(phone);
      if(!chat)return sendJson(response,404,{error:'No existe el chat de esta reacción'});
      const target=chatId(chat);
      let msg=null;
      if(validMessageLookupId(waMessageId)){
        try{msg=normalizeMessage(await client.getMessageById(waMessageId));}catch{}
      }
      if(!msg){
        const recent=await getCachedMediaHistory(chat).catch(()=>[]);
        msg=recent.find(m=>messageId(m)===waMessageId);
      }
      if(!msg||messageId(msg)!==waMessageId||![msg.from,msg.to,msg.id?.remote].includes(target))
        return sendJson(response,404,{error:'Mensaje no disponible en la sesión WhatsApp; no se envió la reacción'});
      normalizeMessage(msg);
      if(typeof msg.react!=='function')return sendJson(response,501,{error:'Esta versión no admite reacciones'});
      await msg.react(emoji);
      // No inventamos confirmaciones de los demás participantes.
      return sendJson(response,200,{ok:true,emoji,waMessageId});
    }

    if (route === '/reactions-snapshot') {
      const {phone,ids}=input||{};
      if (!(typeof phone==='string'&&(/^\d{5,40}$/.test(phone)||validGroupChatId(phone))) ||
          !Array.isArray(ids)||ids.length>30||ids.some(id=>typeof id!=='string'||id.length>300))
        return sendJson(response,400,{error:'Consulta de reacciones inválida'});
      const items=await reactionSnapshot(phone,ids);
      return sendJson(response,200,{items});
    }

    // ====================================
    // RECUPERACIÓN INDIVIDUAL
    // ====================================

    if (route === '/recover') {
      const {
        phone,
        receivedAt,
        message,
        direction,
        waMessageId
      } = input;

      if (
        !(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone)) ||
        !['in', 'out'].includes(direction) ||
        typeof receivedAt !== 'string' ||
        typeof message !== 'string'
      ) {
        return sendJson(response, 400, {
          error: 'Datos inválidos'
        });
      }

      const chat = await findExistingChat(phone);

      if (!chat) {
        return sendJson(response, 404, {
          error: 'Conversación no encontrada'
        });
      }

      const found = await locateMedia({
        receivedAt,
        message,
        direction,
        waMessageId
      }, chat);

      if (found.error) {
        return sendJson(response, 404, {
          error: found.error
        });
      }

      const media = await downloadCandidate(
        found.message
      );

      return sendJson(response, 200, { media });
    }

    // ====================================
    // RECUPERACIÓN POR LOTES
    // ====================================

    if (route === '/recover-batch') {
      const { phone, items } = input;

      if (
        !(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone)) ||
        !Array.isArray(items) ||
        items.length < 1 ||
        items.length > 4
      ) {
        return sendJson(response, 400, {
          error: 'Lote inválido'
        });
      }

      const chat = await findExistingChat(phone);

      if (!chat) {
        return sendJson(response, 404, {
          error: 'Conversación no encontrada'
        });
      }

      const results = [];

      for (const item of items) {
        if (
          !Number.isSafeInteger(item?.id) ||
          item.id <= 0 ||
          !['in', 'out'].includes(item.direction) ||
          typeof item.receivedAt !== 'string' ||
          typeof item.message !== 'string'
        ) {
          results.push({
            id: item?.id,
            error: 'Datos inválidos'
          });
          continue;
        }

        try {
          const found = await locateMedia(item, chat);

          if (found.error) {
            results.push({
              id: item.id,
              error: found.error
            });
            continue;
          }

          const media = await downloadCandidate(
            found.message
          );

          results.push({
            id: item.id,
            media,
            waMessageId: messageId(found.message)
          });

        } catch (error) {
          results.push({
            id: item.id,
            error: errorText(error)
          });
        }
      }

      return sendJson(response, 200, {
        items: results
      });
    }

    // ====================================
    // DESCUBRIMIENTO DE MULTIMEDIA
    // ====================================

    if (route === '/discover') {
      const { phone, items } = input;

      if (
        !(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone)) ||
        !Array.isArray(items) ||
        !items.length ||
        items.length > 80
      ) {
        return sendJson(response, 400, {
          error: 'Datos inválidos'
        });
      }

      const chat = await findExistingChat(phone);

      if (!chat) {
        return sendJson(response, 404, {
          error: 'Conversación no encontrada'
        });
      }

      const recent = await getCachedMediaHistory(chat);

      const results = [];
      const claimed = new Set();

      let downloaded = 0;

      for (const item of items) {
        if (
          !Number.isSafeInteger(item?.id) ||
          item.id <= 0 ||
          !['in', 'out'].includes(item.direction) ||
          typeof item.receivedAt !== 'string' ||
          typeof item.message !== 'string'
        ) {
          continue;
        }

        try {
          let found = recoverCandidate(
            item,
            recent
          );

          if (found.error && item.waMessageId) {
            const exact = await exactMediaFromId(
              item,
              chat
            );

            if (exact) {
              found = { message: exact };
            }
          }

          if (found.error) continue;

          const id = messageId(found.message);

          if (id && claimed.has(id)) continue;

          if (id) claimed.add(id);

          if (downloaded >= 4) {
            results.push({
              id: item.id,
              found: true,
              waMessageId: id,
              error: 'Adjunto pendiente de sincronización'
            });

            continue;
          }

          downloaded++;

          try {
            const media = await downloadCandidate(
              found.message
            );

            results.push({
              id: item.id,
              found: true,
              waMessageId: id,
              media
            });

          } catch (error) {
            results.push({
              id: item.id,
              found: true,
              waMessageId: id,
              error: errorText(error)
            });
          }

        } catch (error) {
          console.warn(
            '[MEDIA] Descubrimiento:',
            errorText(error)
          );
        }
      }

      return sendJson(response, 200, {
        items: results
      });
    }

    if(route==='/history'){
      const {phone}=input;
      if(typeof phone!=='string'||!(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone)))
        return sendJson(response,400,{error:'Conversación inválida'});
      const chat=await findExistingChat(phone);
      if(!chat)return sendJson(response,404,{error:'La conversación no está disponible en WhatsApp'});
      let history=[];
      try{history=await chat.fetchMessages({limit:25});}
      catch(e){return sendJson(response,502,{error:'No se pudo consultar el historial: '+errorText(e)});}
      let processed=0;
      for(let i=0;i<history.length;i+=3){
        const batch=await Promise.allSettled(history.slice(i,i+3).map(async m=>{
          await processMessage(m,Boolean(m.fromMe));
        }));
        processed+=batch.filter(r=>r.status==='fulfilled').length;
      }
      return sendJson(response,200,{ok:true,processed});
    }

    // El estado se transmite al dispositivo vinculado. No se inventan confirmaciones.
    if (route === '/chat-state') {
      const {phone,action} = input;
      if(typeof phone!=='string'||!(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone))||!['read','unread','pin','unpin'].includes(action))
        return sendJson(response,400,{error:'Estado inválido'});
      const chat=await findExistingChat(phone);
      if(!chat)return sendJson(response,404,{error:'Chat no encontrado en WhatsApp'});
      if(action==='read'){
        const confirmed=await chat.sendSeen();
        if(confirmed===false)return sendJson(response,502,{error:'WhatsApp no confirmó la lectura'});
      }else if(action==='unread'){
        if(typeof chat.markUnread!=='function')return sendJson(response,501,{error:'La sesión no admite marcar no leído'});
        await chat.markUnread();
      }else if(action==='pin'){
        if(typeof chat.pin!=='function')return sendJson(response,501,{error:'La sesión no admite fijar chats'});
        const pinned=await chat.pin();
        if(pinned===false)return sendJson(response,409,{error:'WhatsApp no permitió fijar el chat (puede existir un límite)'});
      }else{
        if(typeof chat.unpin!=='function')return sendJson(response,501,{error:'La sesión no admite quitar fijados'});
        await chat.unpin();
      }
      return sendJson(response,200,{ok:true});
    }

    // Reutilizar un mensaje citado solamente si pertenece a la conversación de origen.
    async function verifiedQuotedId(quotedMessageId, phone) {
      if (quotedMessageId === undefined || quotedMessageId === null) return undefined;
      if (typeof quotedMessageId !== 'string' || quotedMessageId.length < 12 || quotedMessageId.length > 300 || quotedMessageId.startsWith('fallback-'))
        throw Object.assign(new Error('Mensaje citado inválido'),{statusCode:400});
      const origin=await findExistingChat(phone);
      if (!origin) throw Object.assign(new Error('El chat de origen no está disponible'),{statusCode:404});
      let quote=null;
      try {quote=normalizeMessage(await client.getMessageById(quotedMessageId));}catch{}
      if (!quote || messageId(quote)!==quotedMessageId) {
        const history=await getCachedMediaHistory(origin).catch(()=>[]);
        quote=history.find(m=>messageId(m)===quotedMessageId);
      }
      const originId=chatId(origin);
      if (!quote || messageId(quote)!==quotedMessageId || ![quote.from,quote.to,quote.id?.remote].includes(originId))
        throw Object.assign(new Error('El mensaje citado no pertenece a este chat o no está en WhatsApp'),{statusCode:409});
      return quotedMessageId;
    }

    // ====================================
    // ENVÍO MANUAL
    // ====================================

      if (route === '/forward') {
        const {phone,waMessageId,targetPhone}=input;
        if (!(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone)) ||
            !(/^[0-9]{5,40}$/.test(targetPhone)||validGroupChatId(targetPhone)) ||
            phone===targetPhone)
          return sendJson(response,400,{error:'Origen o destino inválido'});
        const verified=await verifiedQuotedId(waMessageId,phone);
        let original=null;
        try {original=normalizeMessage(await client.getMessageById(verified));}catch{}
        if(!original || messageId(original)!==verified){
          const origin=await findExistingChat(phone);
          if(origin)original=(await getCachedMediaHistory(origin).catch(()=>[])).find(m=>messageId(m)===verified)||null;
        }
        if (!original || messageId(original)!==verified || typeof original.forward!=='function')return sendJson(response,409,{error:'WhatsApp no permite reenviar este mensaje'});
        const target=await resolveSendChatId(targetPhone,undefined);
        const sent=await original.forward(target);
        if (!sent)return sendJson(response,502,{error:'WhatsApp no confirmó el reenvío'});
        return sendJson(response,200,{sent:true});
      }

      if (route === '/send-media') {
       // Se conserva image como compatibilidad con la versión anterior.
       const {phone,chatId:provided,caption='',attachment:uploaded,image,quotedMessageId}=input||{};
       const file=uploaded||image;
       const allowed=new Set(['image/jpeg','image/png','image/webp','image/gif','video/mp4','application/pdf','text/plain','text/csv','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
       if(!(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone))||typeof caption!=='string'||caption.length>3000||
          (provided!==undefined&&(!validConversationId(provided)||(validGroupChatId(phone)?provided!==phone:provided.split('@')[0]!==phone)))||
          !file||typeof file.data!=='string'||typeof file.mime!=='string'||typeof file.filename!=='string'||file.filename.length>160||
          !allowed.has(file.mime)||file.data.length>17_000_000||file.data.length<8||!/^[A-Za-z0-9+/]+={0,2}$/.test(file.data))
         return sendJson(response,400,{error:'Archivo o destinatario inválido'});
       const bytes=Buffer.from(file.data,'base64');
       if(!bytes.length||bytes.length>MAX_MEDIA_BYTES)return sendJson(response,413,{error:'El archivo supera el límite de 12 MB'});
       const head=bytes.subarray(0,12);
       const mime=file.mime;
       const jpeg=head.subarray(0,3).equals(Buffer.from([255,216,255]));
       const png=head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
       const gif=['GIF87a','GIF89a'].includes(head.subarray(0,6).toString());
       const webp=head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WEBP';
       const zip=head.subarray(0,4).toString()==='PK\x03\x04';
       const ole=head.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
       let valid=true;
       if(mime==='image/jpeg')valid=jpeg;
       else if(mime==='image/png')valid=png;
       else if(mime==='image/gif')valid=gif;
       else if(mime==='image/webp')valid=webp;
       else if(mime==='application/pdf')valid=bytes.subarray(0,5).toString()==='%PDF-';
       else if(mime==='video/mp4')valid=head.subarray(4,8).toString()==='ftyp';
       else if(mime==='application/zip'||mime.includes('openxmlformats-officedocument'))valid=zip;
       else if(['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(mime))valid=ole;
       else if(mime==='text/plain'||mime==='text/csv')valid=!bytes.includes(0)&&!bytes.subarray(0,256).toString('utf8').trimStart().startsWith('<');
       if(!valid)return sendJson(response,400,{error:'Los bytes no corresponden al formato declarado'});
       const target=await resolveSendChatId(phone,provided);
       await repairWebMessageKeys();
       const filename=path.basename(file.filename).replace(/[^\w. -]/g,'_').slice(0,120)||'archivo';
       // Solo imagen y video usan vista incrustada. Otros archivos se envían como documentos.
       const sendAsDocument=!mime.startsWith('image/')&&!mime.startsWith('video/');
       const media=new MessageMedia(mime,file.data,filename);
       const quote=await verifiedQuotedId(quotedMessageId,phone);
       const sent=normalizeMessage(await client.sendMessage(target,media,{caption:caption.trim(),sendSeen:false,sendMediaAsDocument:sendAsDocument,...(quote?{quotedMessageId:quote}:{})}));
       const id=messageId(sent);
       if(!id)return sendJson(response,502,{error:'WhatsApp no confirmó el mensaje. Revisá el chat antes de reenviar'});
       let mediaSaved=false;let warning='';
       try{
         const result=await ingest({
           eventId:id,waMessageId:id,phone,chatId:target,customer:'WhatsApp '+phone,
           isGroup:validGroupChatId(target),message:caption.trim()||'[Adjunto WhatsApp: '+(mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':'document')+']',
           receivedAt:new Date((Number(sent.timestamp)>0?Number(sent.timestamp)*1000:Date.now())).toISOString(),
           outbound:true,hasMedia:true,ack:Number.isInteger(sent.ack)?sent.ack:undefined,
           media:{mime,filename,data:file.data}
         });
         mediaSaved=result.mediaSaved===true;
         if(!mediaSaved)warning='Archivo enviado, pero la API no confirmó su almacenamiento local.';
       }catch(error){warning='Archivo enviado, pero falló el guardado local: '+errorText(error);console.warn('[MEDIA] Archivo saliente:',errorText(error));}
       return sendJson(response,200,{sent:true,id,mediaSaved,warning});
      }

    if (route === '/send') {
      const { phone, chatId: provided, text, quotedMessageId } = input;

      if (
        !(/^[0-9]{5,40}$/.test(phone)||validGroupChatId(phone)) ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 3000 ||
        (
          provided !== undefined &&
          (
            !validConversationId(provided) ||
            (validGroupChatId(phone) ? provided!==phone : provided.split('@')[0] !== phone)
          )
        )
      ) {
        return sendJson(response, 400, {
          error: 'Datos de envío inválidos'
        });
      }

      const target = await resolveSendChatId(
        phone,
        provided
      );

      await repairWebMessageKeys();

      const quote=await verifiedQuotedId(quotedMessageId,phone);
      // No reintentar automáticamente los envíos.
      const sent = normalizeMessage(
        await client.sendMessage(
          target,
          text.trim(),
          { sendSeen: false, ...(quote ? {quotedMessageId:quote} : {}) }
        )
      );

      const id = messageId(sent);

      if (!id) {
        return sendJson(response, 502, {
          error: 'WhatsApp no confirmó el identificador del mensaje. Revisá el chat antes de volver a enviar.'
        });
      }

      processMessage(sent, true).catch(error => {
        console.warn(
          '[WHATSAPP] Registro saliente:',
          errorText(error)
        );
      });

      return sendJson(response, 200, {
        sent: true,
        id
      });
    }

  } catch (error) {
    const code = [
      400, 404, 409, 413, 503
    ].includes(error?.statusCode)
      ? error.statusCode
      : 502;

    console.error(
      '[WHATSAPP] Error en',
      route,
      errorText(error)
    );

    if (error?.stack) {
      console.error(
        String(error.stack).slice(0, 1800)
      );
    }

    return sendJson(response, code, {
      error: errorText(error)
    });
  }
});

// ========================================
// INICIO Y CIERRE
// ========================================

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      '[WHATSAPP] Puerto 3217 ocupado. Cerrá la instancia anterior.'
    );
  } else {
    console.error(
      '[WHATSAPP] Error de servidor:',
      errorText(error)
    );
  }

  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[WHATSAPP] Conector local disponible en 127.0.0.1:${PORT}`
  );
});

client.initialize().catch(error => {
  console.error(
    '[WHATSAPP] Error inicializando:',
    errorText(error)
  );
});

let closing = false;

async function shutdown() {
  if (closing) return;

  closing = true;
  ready = false;

  console.log('[WHATSAPP] Cerrando conector...');

  try {
    await client.destroy();
  } catch (error) {
    console.warn(errorText(error));
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
