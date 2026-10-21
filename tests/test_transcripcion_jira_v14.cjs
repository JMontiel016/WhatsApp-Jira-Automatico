const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Se evalúa la función pura del archivo real, sin llamar a Jira ni a SQLite.
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'lib/ticket-transcript.ts'), 'utf8');
const js = ts.transpileModule(src, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const moduleShim = {exports: {}};
vm.runInNewContext(js, {exports: moduleShim.exports, module: moduleShim}, {timeout: 1500});
const {formatTicketChatTranscript: format} = moduleShim.exports;
const sample = [
  {local_date:'2026-10-19',local_time:'14:30',direction:'in',message:'Hola, tengo un inconveniente'},
  {local_date:'2026-10-19',local_time:'14:31',direction:'in',message:'No puedo ingresar'},
  {local_date:'2026-10-19',local_time:'14:33',direction:'out',message:'Buenas tardes, te ayudamos desde Soporte TI'},
  {local_date:'2026-10-19',local_time:'14:35',direction:'out',message:'¿Aparece algún error?'},
  {local_date:'2026-10-20',local_time:'09:04',direction:'in',message:'Sí, aparece error 500'}
];
const actual = format(sample);
assert.equal(actual, [
  'Fecha: 2026-10-19 | Hora: 14:30', '',
  'Cliente:', 'Hola, tengo un inconveniente', 'No puedo ingresar', '',
  'Soporte TI:', 'Buenas tardes, te ayudamos desde Soporte TI', '¿Aparece algún error?', '',
  'Cliente:', 'Sí, aparece error 500'
].join('\n'));
assert.equal(actual.match(/Fecha:/g)?.length, 1);
assert.equal(actual.match(/Hora:/g)?.length, 1);
assert.equal(actual.match(/Soporte TI:/g)?.length, 1);
assert.equal(actual.match(/Cliente:/g)?.length, 2);
assert.equal(format([]), '');
assert.equal(format([{local_date:'2026-10-19',local_time:'15:00',message:'Línea 1\r\nLínea 2',direction:'in'}]), 'Fecha: 2026-10-19 | Hora: 15:00\n\nCliente:\nLínea 1\nLínea 2');
// Comprobar que la ruta de creación realmente utiliza este formato.
const route = fs.readFileSync(path.join(root,'app/api/jira/create/route.ts'),'utf8');
assert.match(route, /formatTicketChatTranscript\(chosen\)/);
assert.doesNotMatch(route, /\[\$\{m\.local_date\} \$\{m\.local_time\}\]/);
console.log('[OK] Fecha/hora una vez; Cliente/Soporte TI agrupados; contenido preservado; Jira integra formateador.');
