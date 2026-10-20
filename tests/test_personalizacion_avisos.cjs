
'use strict';
const assert=require('node:assert/strict');
const {messageForSupport,enabledQuestions,OPTIONAL_QUESTIONS}=require('../lib/support-personalization.cjs');
const url='https://jira.ejemplo/browse/CW-123';
assert.equal(messageForSupport('', 'CW-123', url, 'level1'), url, 'Sin plantilla: URL igual que antes');
assert.equal(messageForSupport('Atender {ticket}, nivel {nivel}: {link}', 'CW-123',url,'level1'),`Atender CW-123, nivel N1: ${url}`);
assert.equal(messageForSupport('Escalado a {nivel}', 'CW-123',url,'level2'),`Escalado a N2\n${url}`,'Siempre añade enlace');
assert.equal(messageForSupport('Aviso de supervisor', 'CW-123',url,'manager'),`Aviso de supervisor\n${url}`);
assert.throws(()=>messageForSupport('texto','INVALID',url,'level1'));
assert.equal(enabledQuestions({ruc:false}).ruc,false);
assert.equal(enabledQuestions({ruc:false}).talentName,true);
assert(!OPTIONAL_QUESTIONS.includes('menu')&&!OPTIONAL_QUESTIONS.includes('issue'),'Las preguntas mínimas no se omiten');
console.log('[OK] Plantillas N1/N2, enlace obligatorio, compatibilidad URL sola, preguntas opcionales');
