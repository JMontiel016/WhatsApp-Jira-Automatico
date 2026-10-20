'use strict';

/**
 * Compatibilidad con versiones de WhatsApp Web donde un mensaje trae
 * id.$1 pero whatsapp-web.js v1.34.7 aún consulta id._serialized.
 * Este parche se aplica al modelo Node ANTES de construir Client.
 * No altera node_modules, sesiones, descargas ni almacenamiento.
 */
function normalizedId(id) {
  if (!id || typeof id !== 'object') return id;
  if (typeof id._serialized === 'string' && id._serialized) return id;
  let value = '';
  if (typeof id.$1 === 'string' && id.$1) {
    value = id.$1;
  } else if (
    typeof id.fromMe === 'boolean' &&
    typeof id.remote === 'string' &&
    typeof id.id === 'string' &&
    id.remote && id.id
  ) {
    value = `${id.fromMe}_${id.remote}_${id.id}`;
  }
  if (!value) return id;
  // Los IDs de grupos y mensajes propios pueden añadir un autor o sufijo
  // al triple base. Preservar el valor nativo $1 completo es esencial.
  if (typeof id.fromMe === 'boolean' && typeof id.remote === 'string' &&
      typeof id.id === 'string') {
    const base = `${id.fromMe}_${id.remote}_${id.id}`;
    const extra = value.startsWith(base + '_') ? value.slice(base.length + 1) : '';
    if (value !== base && !(extra.length > 0 && extra.length <= 150 && /^[\w.@-]+$/.test(extra))) return id;
  }
  return {...id, _serialized: value};
}

function normalizedWid(wid) {
  if (!wid || typeof wid !== 'object' ||
      (typeof wid._serialized === 'string' && wid._serialized)) return wid;
  if (typeof wid.$1 !== 'string' || !wid.$1) return wid;
  return {...wid, _serialized: wid.$1};
}

function patchMessageSerialization(MessageClass) {
  if (!MessageClass || typeof MessageClass.prototype?._patch !== 'function') {
    return {installed:false, reason:'La clase Message no tiene _patch'};
  }
  const proto = MessageClass.prototype;
  if (proto._ticketbridgeSerializationPatch === true) {
    return {installed:true, reason:'Ya estaba instalado'};
  }
  const original = proto._patch;
  proto._patch = function ticketbridgePatchMessageData(data) {
    if (!data || typeof data !== 'object') return original.call(this, data);
    const nextId = normalizedId(data.id);
    const nextFrom = normalizedWid(data.from);
    const nextTo = normalizedWid(data.to);
    const nextAuthor = normalizedWid(data.author);
    const changed = nextId !== data.id || nextFrom !== data.from ||
                    nextTo !== data.to || nextAuthor !== data.author;
    return original.call(this, changed ? {
      ...data,
      id: nextId,
      from: nextFrom,
      to: nextTo,
      author: nextAuthor
    } : data);
  };
  Object.defineProperty(proto, '_ticketbridgeSerializationPatch', {
    value:true, writable:false, configurable:false
  });
  return {installed:true, reason:'Normalización activa para nuevos mensajes y recargas'};
}

module.exports = { normalizedId, normalizedWid, patchMessageSerialization };
