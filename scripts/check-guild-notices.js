// Checks the notice a server gets when a member passed the verification and Discord refused to change their roles: it is its own notice (the role of Petto has to be above
// the roles it gives), not the generic one about permissions, in the three languages; and a Missing Permissions of anything else is still the generic one.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { classifyDiagnostic, renderNotice, TEMPLATES } = require('../src/utils/guildOpsAlerts');
const { t } = require('../src/i18n');

const web = 'Failed to apply verification roles: Missing Permissions · code=50013 · status=403 · method=PUT · route=/guilds/:id/members/:id/roles/:id';
const letters = 'Failed to apply verification roles (letters in Discord): DiscordAPIError[50013]: Missing Permissions';

for (const text of [web, letters]) {
  const found = classifyDiagnostic(text);
  assert.equal(found.kind, 'verifyRoles', 'the failed roles of a verification are their own notice');
  assert.equal(found.teamAlert, false);
}
assert.equal(classifyDiagnostic('DiscordAPIError: Missing Permissions').kind, 'permissions', 'any other Missing Permissions is the generic notice');
assert.equal(classifyDiagnostic('Failed to apply verification roles: connection reset'), null, 'a failure that is not about permissions is not classified');
assert.ok(TEMPLATES.verifyRoles, 'the kind exists for the team review button too');

const details = classifyDiagnostic(web).details;
const english = renderNotice({ kind: 'verifyRoles', details, lang: 'en' });
assert.ok(english.includes('Petto could not give the verification role') && english.includes('drag the **Petto** role above') && english.includes('Manage Roles'));
const spanish = renderNotice({ kind: 'verifyRoles', details, lang: 'es' });
assert.ok(spanish.includes('Petto no pudo dar el rol de verificación') && spanish.includes('por encima') && spanish.includes('Gestionar roles') && !spanish.includes('drag the'), 'the details Petto wrote are shown in the language of the server');
const portuguese = renderNotice({ kind: 'verifyRoles', details, lang: 'pt-BR' });
assert.ok(portuguese.includes('não conseguiu dar o cargo') && portuguese.includes('Gerenciar cargos'));
assert.notEqual(t('es', 'notices.details.verifyRoles'), t('en', 'notices.details.verifyRoles'));
assert.ok(english.length <= 1990 && spanish.length <= 1990 && portuguese.length <= 1990, 'the notice fits in a message');
console.log('Guild notice checks passed (the verification roles notice, in the three languages).');
