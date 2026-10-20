'use strict';
/** Jira estado SopN2 = orden de derivación. El resto NO reabre ni rebaja un caso. */
const canonical = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')
  .replace(/\s+/g, '');
function supportRoleForJiraStatus(status, configured = 'SopN2') {
  const expected = canonical(configured) || 'sopn2';
  return canonical(status) === expected ? 'level2' : null;
}
function supportTierLabel(status) {
  if (canonical(status) === 'sopn2') return 'N2';
  if (canonical(status) === 'sopn1') return 'N1';
  return null;
}
module.exports = { supportRoleForJiraStatus, supportTierLabel };
