
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

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const API_BASE = 'http://127.0.0.1:3000';
const PORT = 3217;
const SECRET = process.env.WHATSAPP_LOCAL_SECRET;

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SEEN_FILE = path.join(DATA_DIR, 'whatsapp-processed.json');

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const MAX_PROCESSED = 3000;
const HISTORY_LIMIT = 250;

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

function messageId(message) {
  return serializedId(message?.id);
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

function rememberChat(id) {
  if (!validPrivateChatId(id)) return;

  knownChatIds.set(id.split('@')[0], id);
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
      ? 'patched'
      : 'unavailable';

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
    compatibility = 'failed';

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

async function downloadCandidate(message, attempts = 3) {
  normalizeMessage(message);

  if (!message?.hasMedia) {
    throw new Error(
      'El mensaje no contiene multimedia.'
    );
  }

  let lastError = 'WhatsApp no entregó el archivo';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      normalizeMessage(message);

      if (
        attempt > 1 &&
        typeof message.reload === 'function'
      ) {
        await message.reload().catch(() => {});
        normalizeMessage(message);
      }

      const attachment = await message.downloadMedia();

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

      console.warn(
        `[MEDIA] Intento ${attempt}/${attempts}:`,
        lastError
      );

      if (attempt < attempts) {
        await wait(800 * attempt);
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

// ========================================
// PROCESAMIENTO DE MENSAJES
// ========================================

async function processMessage(message, outbound = false) {
  normalizeMessage(message);

  const sender = String(
    outbound ? message.to : message.from
  );

  const isGroup = (
    message.from?.endsWith('@g.us') ||
    message.to?.endsWith('@g.us')
  );

  if (
    (!outbound && message.fromMe) ||
    message.from === 'status@broadcast' ||
    isGroup
  ) {
    return;
  }

  if (!validPrivateChatId(sender)) {
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
    const phone = sender.split('@')[0];

    const receivedAt = new Date(
      timestamp * 1000
    ).toISOString();

    const text = (
      typeof message.body === 'string' &&
      message.body.trim()
    )
      ? message.body.slice(0, 3000)
      : `[Adjunto WhatsApp: ${message.type || 'archivo'}]`;

    const contact = await contactDetails(
      message,
      sender
    );

    const payload = {
      eventId,
      waMessageId: originalId || '',
      chatId: sender,
      phone,
      customer: contact.name,
      avatarUrl: contact.avatarUrl,
      message: text,
      receivedAt,
      outbound: Boolean(outbound),
      hasMedia: Boolean(message.hasMedia)
    };

    let mediaFailed = false;

    if (message.hasMedia) {
      try {
        payload.media = await downloadCandidate(message);
      } catch (error) {
        mediaFailed = true;
        payload.mediaError = errorText(error);
      }
    }

    const result = await ingest(payload);

    seen.add(eventId);
    persistSeen();

    console.log(
      '[TICKETBRIDGE] Mensaje registrado:',
      result.status || 'ok',
      'caso:',
      result.caseId || '-'
    );

    // Un reintento diferido para archivos nuevos
    // cuando WhatsApp todavía no los ha entregado.
    if (mediaFailed && ready) {
      const timer = setTimeout(async () => {
        if (!ready) return;

        try {
          const media = await downloadCandidate(
            message,
            2
          );

          const recovered = await ingest({
            ...payload,
            media,
            mediaError: ''
          });

          console.log(
            '[MEDIA] Reintento sincronizado:',
            recovered.caseId || '-'
          );

        } catch (error) {
          console.warn(
            '[MEDIA] Reintento pendiente:',
            errorText(error)
          );
        }
      }, 12000);

      timer.unref?.();
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
  processMessage(message, false).catch(error => {
    console.error(
      '[WHATSAPP] Recepción:',
      errorText(error)
    );
  });
});

client.on('message_create', message => {
  if (!message.fromMe) return;

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
    message.hasMedia &&
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

  if (!id || id.startsWith('fallback-')) {
    return null;
  }

  try {
    const message = normalizeMessage(
      await client.getMessageById(id)
    );

    if (!message?.hasMedia) return null;

    if (
      Boolean(message.fromMe) !==
      (item.direction === 'out')
    ) {
      return null;
    }

    const target = chatId(chat);

    if (
      target &&
      ![message.from, message.to].includes(target)
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
  const remembered = knownChatIds.get(phone);

  if (validPrivateChatId(remembered)) {
    return remembered;
  }

  if (
    validPrivateChatId(provided) &&
    provided.split('@')[0] === phone
  ) {
    rememberChat(provided);
    return provided;
  }

  const chat = await findExistingChat(phone);

  if (!chat) {
    throw Object.assign(
      new Error(
        'No se encontró el chat del destinatario.'
      ),
      { statusCode: 409 }
    );
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
        version: 'ticketbridge-sync-v4',
        compatibility
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

      if (!query || query.length > 100) {
        return sendJson(response, 400, {
          error: 'Búsqueda inválida'
        });
      }

      const chats = await client.getChats();

      const contacts = chats
        .filter(chat =>
          !chat.isGroup &&
          /^\d{5,40}$/.test(chat.id?.user || '')
        )
        .map(chat => ({
          phone: chat.id.user,
          name: String(
            chat.name || chat.id.user
          ).slice(0, 120)
        }))
        .filter(contact =>
          `${contact.name} ${contact.phone}`
            .toLowerCase()
            .includes(query)
        )
        .slice(0, 50);

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
        '/recover',
        '/recover-batch',
        '/discover'
      ].includes(route)
    ) {
      return sendJson(response, 404, {
        error: 'Ruta no encontrada'
      });
    }

    const input = await readBody(request);

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
        !/^\d{5,40}$/.test(phone) ||
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
        !/^\d{5,40}$/.test(phone) ||
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
        !/^\d{5,40}$/.test(phone) ||
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

    // ====================================
    // ENVÍO MANUAL
    // ====================================

    if (route === '/send') {
      const { phone, chatId: provided, text } = input;

      if (
        !/^\d{5,40}$/.test(phone) ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 3000 ||
        (
          provided !== undefined &&
          (
            !validPrivateChatId(provided) ||
            provided.split('@')[0] !== phone
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

      // No reintentar automáticamente los envíos.
      const sent = normalizeMessage(
        await client.sendMessage(
          target,
          text.trim(),
          { sendSeen: false }
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
      400, 409, 413, 503
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
