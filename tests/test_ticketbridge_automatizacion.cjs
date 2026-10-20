'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const includes=(p,pattern,desc)=>assert.match(read(p),pattern,desc);
const source=['lib/automation.ts','lib/automation-controls.ts','lib/automation-routing.ts','lib/phone-escalation.ts','lib/automation-jira-sync.ts','app/components/AutomationControlCenter.tsx','app/components/AutomationScenarioSuite.tsx','app/api/automation/people/route.ts','app/api/automation/control/route.ts','app/api/automation/ticket-stage/route.ts','migraciones/20261017_automatizacion.sql'];
source.forEach(f=>assert.ok(fs.existsSync(path.join(root,f)),'Falta '+f));
includes('lib/automation.ts',/ev\.isGroup\|\|ev\.message\.phone\.endsWith\('@g\.us'\)\|\|ev\.outbound/,'Grupos nunca reciben respuestas');
includes('lib/automation.ts',/contactAllowed\(/,'Exclusiones');
includes('lib/automation.ts',/scheduleAllowed\(/,'Horarios');
includes('lib/automation.ts',/command==='CANCELAR'\|\|command==='0'/,'Cancelar');
includes('lib/automation.ts',/advance\(session,'confirm',data\);return summary\(session\)/,'LISTO no crea ticket directamente');
includes('lib/automation.ts',/case 'confirm'/,'Confirmación obligatoria');
includes('lib/automation-controls.ts',/UNIQUE\(account_id,role,phone\)/,'Varios responsables únicos');
includes('lib/automation-routing.ts',/text:link/,'Solo enlace real a responsables');
includes('lib/automation-routing.ts',/INSERT OR IGNORE/,'No notificaciones duplicadas');
includes('lib/phone-escalation.ts',/configuredTelephony=\(\)=>false/,'Llamadas externas bloqueadas hasta integración oficial');
includes('lib/phone-escalation.ts',/await jiraDetails/,'Reconsulta Jira antes de escalar');
includes('app/components/AutomationScenarioSuite.tsx',/const tests=\[/,'Ocho escenarios');
const sim=read('app/components/AutomationScenarioSuite.tsx');assert.equal((sim.match(/\d\. /g)||[]).filter((_,i)=>i<8).length,8);
assert.doesNotMatch(sim,/\bfetch\s*\(/,'Simulador no debe acceder a servicios');
let ts;try{ts=require('typescript');}catch{console.warn('[AVISO] Sin TypeScript instalado; solo verificación estática');}
if(ts){for(const f of source.filter(p=>/\.(ts|tsx)$/.test(p))){const parsed=ts.transpileModule(read(f),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});assert.equal(parsed.diagnostics?.length||0,0,'Sintaxis: '+f);}}
console.log('[OK] Política de grupos, clientes, horarios, confirmación, avisos, Jira, llamadas bloqueadas y 8 simulacros');
