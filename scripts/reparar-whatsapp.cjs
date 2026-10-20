
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(
  process.cwd(),
  'node_modules/whatsapp-web.js'
);

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

if (pkg.version !== '1.34.7') {
  throw new Error(
    'Este ajuste requiere whatsapp-web.js 1.34.7. ' +
    'Versión instalada: ' + pkg.version
  );
}

const normalizar =
  "data.id && !data.id._serialized && " +
  "typeof data.id.$1 === 'string' " +
  "? Object.assign({}, data.id, " +
  "{ _serialized: data.id.$1 }) : data.id";

const reglas = {
  'src/structures/Message.js': [
    [
      'this.id = data.id;',
      'this.id = ' + normalizar + ';'
    ],
    [
      'data.from._serialized',
      '(data.from._serialized || data.from.$1)'
    ],
    [
      'data.to._serialized',
      '(data.to._serialized || data.to.$1)'
    ],
    [
      'data.author._serialized',
      '(data.author._serialized || data.author.$1)'
    ]
  ],

  'src/structures/Chat.js': [
    [
      'this.id = data.id;',
      'this.id = ' + normalizar + ';'
    ]
  ],

  'src/util/Injected/Utils.js': [
    [
      'msg.id.remote._serialized',
      '(msg.id.remote._serialized || msg.id.remote.$1)'
    ],
    [
      'newMsgKey._serialized',
      '(newMsgKey._serialized || newMsgKey.$1)'
    ],
    [
      'chat.lastReceivedKey._serialized',
      '(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1)'
    ],
    [
      '.createWid(chat.id._serialized);',
      '.createWid(chat.id._serialized || chat.id.$1);'
    ],
    [
      'delete msg.pendingAckUpdate;',
      `if (
            msg.id &&
            typeof msg.id === 'object' &&
            !msg.id._serialized &&
            typeof msg.id.$1 === 'string'
        ) {
            msg.id = Object.assign({}, msg.id, {
                _serialized: msg.id.$1
            });
        }

        delete msg.pendingAckUpdate;`
    ],
    [
      `const alt = window
                .require('WAWebApiContact')
                .getAlternateUserWid(wid);`,
      `let alt = null;
            try {
                alt = window
                    .require('WAWebApiContact')
                    .getAlternateUserWid(wid);
            } catch (error) {
                // Algunos contactos @lid no tienen ID alternativo.
            }`
    ]
  ]
};

// Preparar cambios sin escribir todavía.
const pendientes = [];

for (const [archivo, cambios] of Object.entries(reglas)) {
  const destino = path.join(root, archivo);
  const original = fs.readFileSync(destino, 'utf8');
  let contenido = original;

  for (const [anterior, nuevo] of cambios) {
    if (contenido.includes(anterior)) {
      contenido = contenido.split(anterior).join(nuevo);
    } else if (!contenido.includes(nuevo)) {
      throw new Error(
        'Estructura inesperada en ' + archivo +
        '. No se aplicó la reparación.'
      );
    }
  }

  pendientes.push({ destino, original, contenido });
}

// Guardar copias y aplicar.
const modificados = [];

try {
  for (const item of pendientes) {
    if (item.contenido === item.original) continue;

    const copia = item.destino + '.ticketbridge.bak';

    if (!fs.existsSync(copia)) {
      fs.copyFileSync(item.destino, copia);
    }

    modificados.push(item);
    fs.writeFileSync(item.destino, item.contenido, 'utf8');

    execFileSync(process.execPath, [
      '--check',
      item.destino
    ]);
  }

  console.log(
    '[OK] Compatibilidad WhatsApp aplicada.'
  );
  console.log(
    '[OK] Sintaxis de los archivos modificados.'
  );
  console.log(
    '[INFO] Archivos modificados: ' + modificados.length
  );

} catch (error) {
  for (const item of modificados.reverse()) {
    fs.writeFileSync(
      item.destino,
      item.original,
      'utf8'
    );
  }

  console.error(
    '[ERROR] Cambios revertidos:', error.message
  );
  process.exitCode = 1;
}
