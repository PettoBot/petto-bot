// The filters of Petto's own AutoMod made from templates, through the real message event.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let rules = [];
const applied = [];
const hitsCounted = [];
const { buildPatterns, toRegExp } = require('../src/utils/automodTemplates');
const compiled = (row) => ({ ...row, regexes: buildPatterns(row.template, row.options).map(toRegExp) });
stub('../src/db/automod', { getConfig: async () => null, listSilentChannelsCached: async () => [] });
stub('../src/db/automodRules', { listCompiled: async () => rules.filter((r) => r.enabled).map(compiled), countHit: (g, r) => hitsCounted.push(r.id) });
stub('../src/utils/automodAction', { applyAutomodAction: async (m, o) => applied.push(o) });
stub('../src/utils/honeypot', { handleHoneypotMessage: async () => false });
stub('../src/db/maliciousLinks', { findKnownMalicious: async () => [] });
stub('../src/utils/senderIdentity', { sendAs: async () => null });
const event = require('../src/events/messageCreateAutomod');

const msg = (content, { roles = [], channelId = 'c1', staff = false } = {}) => ({
  guild: { id: 'g1' }, author: { id: 'u1', bot: false }, content, channel: { id: channelId, parentId: null },
  member: { permissions: { has: () => staff }, roles: { cache: { has: (id) => roles.includes(id) } } },
});

(async () => {
  rules = [
    { id: 1, name: 'Invite links', template: 'invites', options: {}, action: 'mute', mute_minutes: 30, enabled: true, exempt_role_ids: ['vip'], exempt_channel_ids: ['promo'], hits: 0 },
    { id: 2, name: 'Emoji spam', template: 'emojis', options: { max: 3 }, action: 'warn', mute_minutes: 10, enabled: true, exempt_role_ids: [], exempt_channel_ids: [], hits: 0 },
    { id: 3, name: 'Off', template: 'links', options: {}, action: 'kick', mute_minutes: 10, enabled: false, exempt_role_ids: [], exempt_channel_ids: [], hits: 0 },
  ];

  await event.execute(msg('hola, que tal'));
  assert.equal(applied.length, 0, 'a normal message passes');

  await event.execute(msg('entra a discord.gg/abc123'));
  assert.equal(applied.length, 1);
  assert.deepEqual([applied[0].action, applied[0].durationMs, applied[0].violationType], ['tempmute', 30 * 60_000, 'filter-invites'], 'a mute uses the minutes of the filter');
  assert.deepEqual(hitsCounted, [1]);

  applied.length = 0;
  await event.execute(msg('😀😀😀😀'));
  assert.equal(applied[0].action, 'warn');
  assert.equal(applied[0].durationMs, undefined);

  applied.length = 0;
  await event.execute(msg('discord.gg/abc123', { roles: ['vip'] }));
  await event.execute(msg('discord.gg/abc123', { channelId: 'promo' }));
  await event.execute(msg('discord.gg/abc123', { staff: true }));
  assert.equal(applied.length, 0, 'exempt roles, exempt channels and staff are not checked');

  await event.execute(msg('mira https://example.com'));
  assert.equal(applied.length, 0, 'a filter that is off does nothing');

  console.log('automod filters ok');
})().catch((err) => { console.error(err); process.exit(1); });
