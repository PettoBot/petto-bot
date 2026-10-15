// Lifting a sanction from the dashboard, searching cases, proof and the stats of the moderators.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const store = [
  { case_number: 1, user_id: '10', moderator_id: 'm1', type: 'ban', active: true, reason: 'spam' },
  { case_number: 2, user_id: '11', moderator_id: 'm1', type: 'tempmute', active: true, reason: 'insults' },
  { case_number: 3, user_id: '12', moderator_id: 'm2', type: 'hardban', active: true, reason: 'raid' },
  { case_number: 4, user_id: '13', moderator_id: 'm2', type: 'warn', active: true, reason: 'spam again' },
  { case_number: 5, user_id: '14', moderator_id: 'm1', type: 'ban', active: false, reason: 'old' },
  { case_number: 6, user_id: '15', moderator_id: 'm1', type: 'jail', active: true, reason: 'check' },
];
const created = [];
const deactivated = [];
let hard = new Set(['12']);
let jailed = true;
stub('../src/db/modActions', { getCase: async (g, n) => store.find((r) => r.case_number === n) ?? null, createCase: async (c) => { created.push(c); return { ...c, case_number: 100 + created.length }; }, deactivateCase: async (g, n) => deactivated.push(n) });
stub('../src/db/hardBans', { getHardBan: async (g, u) => (hard.has(u) ? { user_id: u } : null) });
stub('../src/db/guilds', { ensureGuild: async () => ({ mute_role_id: 'muterole' }) });
stub('../src/utils/jail', { unjailMember: async () => ({ ok: jailed }) });
stub('../src/utils/caseLog', { logSanction: async () => {} });
const { liftSanction, isLiftable } = require('../src/utils/sanctionLift');

const calls = [];
const guild = {
  id: 'g1', client: {},
  members: { unban: async (id) => calls.push(['unban', id]), fetch: async () => ({ isCommunicationDisabled: () => true, timeout: async (ms) => calls.push(['timeout', ms]), roles: { cache: { has: () => true }, remove: async (r) => calls.push(['role.remove', r]) } }) },
};
const actor = { id: 'mod', username: 'mod' };

(async () => {
  assert.ok(isLiftable(store[0]) && isLiftable(store[1]) && isLiftable(store[5]));
  assert.ok(!isLiftable(store[3]), 'a warn is not lifted');
  assert.ok(!isLiftable(store[4]), 'an inactive ban is not lifted');
  assert.ok(!isLiftable(null));

  let r = await liftSanction(guild, 1, actor);
  assert.deepEqual(calls.pop(), ['unban', '10']);
  assert.deepEqual([r.reverse, deactivated.pop()], ['unban', 1]);
  assert.deepEqual([created.at(-1).type, created.at(-1).source, created.at(-1).moderatorId], ['unban', 'dashboard', 'mod'], 'the lifting is a case of its own, by the one who did it');

  r = await liftSanction(guild, 2, actor, 'sorry');
  assert.deepEqual(calls.splice(0), [['timeout', null], ['role.remove', 'muterole']], 'the timeout and the mute role both go');
  assert.equal(created.at(-1).reason, 'sorry');

  r = await liftSanction(guild, 6, actor);
  assert.equal(r.reverse, 'unjail');

  await assert.rejects(liftSanction(guild, 3, actor), /hardban/, 'a hardban is never lifted from here');
  await assert.rejects(liftSanction(guild, 4, actor), /not on anymore/);
  await assert.rejects(liftSanction(guild, 5, actor), /not on anymore/);
  await assert.rejects(liftSanction(guild, 99, actor), /does not exist/);

  // search and stats against a fake query
  const rowsDb = [
    { case_number: 4, user_id: '13', moderator_id: 'm2', type: 'warn', reason: 'Spam again', source: 'moderator' },
    { case_number: 3, user_id: '12', moderator_id: 'bot', type: 'ban', reason: 'raid', source: 'antiscam' },
    { case_number: 2, user_id: '11', moderator_id: 'm1', type: 'tempmute', reason: 'insults', source: 'moderator' },
    { case_number: 1, user_id: '10', moderator_id: 'm1', type: 'ban', reason: 'SPAM', source: 'moderator' },
  ];
  const query = (filters = []) => {
    let result = rowsDb;
    const q = {
      select: () => q, order: () => q, limit: () => q, gte: () => q,
      eq(col, val) { filters.push([col, val]); result = result.filter((r) => col === 'guild_id' || r[col] === val); return q; },
      then: (resolve) => resolve({ data: result, error: null }),
    };
    return q;
  };
  stub('../src/db/database', { from: () => query(), rpc: async () => ({}) });
  delete require.cache[require.resolve('../src/db/modActions')];
  const mod = require('../src/db/modActions');
  assert.equal((await mod.searchCases('g1', { text: 'spam' })).length, 2, 'a word of the reason, in any case');
  assert.equal((await mod.searchCases('g1', { type: 'ban' })).length, 2);
  assert.deepEqual((await mod.searchCases('g1', { moderatorId: 'm1', text: 'spam' })).map((r) => r.case_number), [1]);
  const stats = await mod.moderatorStats('g1', 30, 'bot');
  assert.equal(stats.total, 4);
  assert.equal(stats.automatic, 1, 'what the bot did by itself is counted apart');
  assert.deepEqual(stats.moderators, [{ id: 'm1', count: 2 }, { id: 'm2', count: 1 }]);
  assert.equal(stats.byType.ban, 2);

  // the proof appears in the case
  const { formatCaseDetail } = require('../src/utils/caseFormat');
  assert.match(formatCaseDetail({ case_number: 1, type: 'ban', user_id: '1', moderator_id: '2', created_at: new Date().toISOString(), active: true, reason: 'x', evidence: ['https://a.png', 'https://b.png'] }), /\*\*Evidence:\*\* \[1\]\(https:\/\/a\.png\) · \[2\]/);
  assert.doesNotMatch(formatCaseDetail({ case_number: 1, type: 'ban', user_id: '1', moderator_id: '2', created_at: new Date().toISOString(), active: true, reason: 'x', evidence: [] }), /Evidence/);

  // Spanish and Portuguese: the case, the automatic reasons (saved in English, translated when shown), the card and the DM.
  const { runWithLanguage } = require('../src/i18n');
  const { displayReason, reasonText } = require('../src/utils/caseFormat');
  const row = { case_number: 7, type: 'ban', user_id: '1', moderator_id: '2', created_at: new Date().toISOString(), active: true, reason: 'Automatic expiry' };
  assert.match(formatCaseDetail(row, 'es'), /^### .*Caso #7 · Baneo\n\*\*Usuario:\*\* <@1>[\s\S]*\*\*Activo:\*\* Sí\n\*\*Razón:\*\* Vencimiento automático$/);
  assert.match(formatCaseDetail({ ...row, reason: null }, 'pt-BR'), /\*\*Motivo:\*\* Nenhum motivo informado\.$/);
  assert.equal(formatCaseDetail(row), formatCaseDetail(row, 'en'), 'outside a server the case is in English');
  assert.equal(displayReason('Automatic escalation: reached 3 warning(s).', 'es'), 'Escalado automático: llegó a 3 advertencias.');
  assert.equal(displayReason('Automatic escalation: reached 1 warning(s).', 'pt-BR'), 'Escalonamento automático: chegou a 1 advertência.');
  assert.equal(displayReason('spam in #general', 'es'), 'spam in #general', 'a reason someone wrote is never translated');
  assert.equal(displayReason('Automatic expiry', 'en'), 'Automatic expiry');
  assert.equal(reasonText('', 'es'), 'No se indicó una razón.');
  await assert.rejects(runWithLanguage('es', () => liftSanction(guild, 99, actor)), /no existe/, 'the errors follow the language of the command');
  const { buildCaseCard } = require('../src/utils/caseCard');
  const target = { id: '5', username: 'rule_breaker' };
  assert.match(buildCaseCard({ caseNumber: 3, type: 'tempban', target, reason: 'spam', duration: '2 días', lang: 'es' }).toJSON().content, /Se baneó a \*\*rule_breaker\*\* \(<@5>\) del servidor temporalmente por \*\*2 días\*\*\. Razón: \*\*spam\*\*\.\n-# caso · #3$/);
  assert.match(buildCaseCard({ caseNumber: 3, type: 'ban', target, reason: '' }).toJSON().content, /\*\*rule_breaker\*\* \(<@5>\) was banned from the server\. Reason: \*\*No reason provided\*\*\.\n-# case · #3$/);
  const { buildSanctionDM } = require('../src/utils/sanctionMessage');
  const dm = buildSanctionDM({ type: 'warn', guild: { id: '9', name: 'Servidor', memberCount: 1 }, client: { user: { username: 'Petto' } }, reason: 'flood', appealUrl: 'https://appeal.test', lang: 'pt-BR' });
  assert.match(dm, /Você recebeu uma advertência em \*\*Servidor\*\* \| Motivo: `flood`\n\nAcha que foi um engano\? Apele aqui: https:\/\/appeal\.test\n\n-# Enviado por 'Petto' \(`9`\) com 1 membro$/);

  console.log('moderation tools ok');
})().catch((err) => { console.error(err); process.exit(1); });
