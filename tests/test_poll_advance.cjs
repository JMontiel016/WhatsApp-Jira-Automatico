'use strict';
// Compatibilidad de la versión actual: no generar ni avanzar encuestas.
// El bot debe usar respuestas numéricas 1, 2, 3, 4; CANCELAR o 0.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.resolve(__dirname, '..', name),'utf8');
const connector = read('whatsapp/connector.cjs');
const route = read('app/api/whatsapp/polls/route.ts');
assert.doesNotMatch(connector,/new\s+Poll\s*\(/);
assert.match(route,/retired:\s*true/);
assert.match(route,/ignored:\s*true/);
assert.match(route,/pending:\s*\[\]/);
assert.match(route,/timingSafeEqual/);
assert.match(read('lib/automation.ts'),/command==='0'\|\|command==='CANCELAR'/);
console.log('[OK] Las encuestas antiguas no generan respuestas ni avanzan el bot. Menú 1–4, 0/CANCELAR.');
