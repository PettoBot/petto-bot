// The rules made in Discord's own AutoMod from the templates: what is sent, the slot limits and what can be touched.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { AutoModerationActionType, AutoModerationRuleTriggerType, PermissionFlagsBits } = require('discord.js');
const native = require('../src/utils/nativeAutomod');

function makeGuild({ rules = [], manage = true } = {}) {
  const store = new Map(rules.map((r) => [r.id, r]));
  const created = [];
  const guild = {
    id: 'g1',
    client: { user: { id: 'petto' } },
    members: { me: { permissions: { has: (p) => manage && p === PermissionFlagsBits.ManageGuild } } },
    roles: { cache: { has: (id) => id !== 'gone' } },
    channels: { cache: { has: () => true } },
    autoModerationRules: {
      fetch: async (opts) => (opts?.autoModerationRule ? store.get(opts.autoModerationRule) ?? null : store),
      create: async (payload) => { const rule = { id: String(100 + created.length), creatorId: 'petto', ...payload, edit: async function (d) { Object.assign(this, d); }, delete: async function () { store.delete(this.id); } }; created.push(payload); store.set(rule.id, rule); return rule; },
    },
  };
  return { guild, created, store };
}
const keyword = (i, name = `Petto • Official ${i}`, creatorId = 'petto') => ({ id: `k${i}`, name, creatorId, enabled: true, triggerType: AutoModerationRuleTriggerType.Keyword, triggerMetadata: { regexPatterns: [] }, actions: [] });

(async () => {
  // a template becomes one keyword rule with its patterns, blocking by default
  let { guild, created } = makeGuild();
  const made = await native.createNative(guild, { template: 'invites', options: { thirdParty: true }, alertChannelId: '555', timeoutMinutes: 10, customMessage: 'No invites here' });
  assert.equal(made.name, 'Petto ◆ Invite links');
  const payload = created[0];
  assert.equal(payload.triggerType, AutoModerationRuleTriggerType.Keyword);
  assert.equal(payload.triggerMetadata.regexPatterns.length, 2);
  assert.ok(payload.triggerMetadata.regexPatterns.every((p) => p.startsWith('(?i)') && p.length <= 260));
  assert.deepEqual(payload.actions.map((a) => a.type), [AutoModerationActionType.BlockMessage, AutoModerationActionType.SendAlertMessage, AutoModerationActionType.Timeout]);
  assert.equal(payload.actions[0].metadata.customMessage, 'No invites here');
  assert.equal(payload.actions[2].metadata.durationSeconds, 600);

  // a pack is one rule with all its patterns; no action given still blocks
  ({ guild, created } = makeGuild());
  await native.createNative(guild, { pack: 'basic', block: false });
  assert.ok(created[0].triggerMetadata.regexPatterns.length >= 4 && created[0].triggerMetadata.regexPatterns.length <= 10);
  assert.deepEqual(created[0].actions.map((a) => a.type), [AutoModerationActionType.BlockMessage], 'a rule always has an action');

  // the kinds Discord has by itself
  ({ guild, created } = makeGuild());
  await native.createNative(guild, { kind: 'mentions', mentionLimit: 99 });
  assert.equal(created[0].triggerMetadata.mentionTotalLimit, 50, 'the limit is clamped');
  await native.createNative(guild, { kind: 'spam' });
  await assert.rejects(native.createNative(guild, { kind: 'spam' }), /already exists/);
  await assert.rejects(native.createNative(guild, { kind: 'presets', presets: [] }), /at least one/);

  // six keyword rules are all Discord gives: a clear answer, nothing sent
  ({ guild, created } = makeGuild({ rules: [1, 2, 3, 4, 5, 6].map((i) => keyword(i)) }));
  await assert.rejects(native.createNative(guild, { template: 'links' }), /Discord allows 6 keyword rules/);
  assert.equal(created.length, 0);

  // exemptions only keep what exists
  ({ guild, created } = makeGuild());
  await native.createNative(guild, { template: 'zalgo', exemptRoleIds: ['r1', 'gone'], exemptChannelIds: ['c1'] });
  assert.deepEqual(created[0].exemptRoles, ['r1']);

  // no permission, unknown things
  await assert.rejects(native.createNative(makeGuild({ manage: false }).guild, { template: 'links' }), /Manage Server/);
  await assert.rejects(native.createNative(makeGuild().guild, { template: 'nope' }), /does not exist/);
  await assert.rejects(native.createNative(makeGuild().guild, { pack: 'nope' }), /does not exist/);

  // listing marks Petto Official and the own rules; only own rules can be changed
  const own = { ...keyword(7, 'Petto ◆ Emoji spam'), edit: async function (d) { Object.assign(this, d); }, delete: async function () { this.deleted = true; } };
  const official = keyword(8, 'Petto • Scam Links');
  const foreign = keyword(9, 'Mi regla', 'someone-else');
  ({ guild } = makeGuild({ rules: [own, official, foreign] }));
  const listed = await native.listNative(guild);
  assert.deepEqual(listed.rules.map((r) => [r.mine, r.official]), [[true, false], [false, true], [false, false]]);
  assert.equal(listed.used.keyword, 3);
  await native.setNativeEnabled(guild, 'k7', false);
  assert.equal(own.enabled, false);
  await assert.rejects(native.setNativeEnabled(guild, 'k8', false), /Only the rules made from these templates/);
  await assert.rejects(native.deleteNative(guild, 'k9'), /Only the rules made from these templates/);
  await native.deleteNative(guild, 'k7');
  assert.equal(own.deleted, true);

  console.log('native automod ok');
})().catch((err) => { console.error(err); process.exit(1); });
