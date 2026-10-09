// Checks the Vanity and Server Tag rules: how a rule matches, the rules for who owns a role (the bot never takes away a role
// a person gave), the checks on a new rule, the variables of the messages and the import of the old Vanity bot's data.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// An in-memory ledger with the same behavior as the SQL one (see db/identity.js).
const grants = new Map();
const states = new Map();
const audits = [];
const key = (...parts) => parts.join(':');
const ledger = {
  async invalidateStaleGrants(guildId, userId, source, scopes) {
    for (const [id, grant] of grants) {
      if (grant.guildId !== guildId || grant.userId !== userId || grant.source !== source || !grant.matched) continue;
      if (!scopes.some((scope) => scope.ruleId === grant.ruleId && scope.roleId === grant.roleId && scope.action === grant.action)) grants.set(id, { ...grant, matched: false });
    }
  },
  async managedRolesOfMember(guildId, userId) {
    const roles = new Set();
    for (const state of states.values()) if (state.guildId === guildId && state.userId === userId && state.botAddedRole) roles.add(state.roleId);
    for (const grant of grants.values()) if (grant.guildId === guildId && grant.userId === userId && (grant.matched || grant.botAddedRole)) roles.add(grant.roleId);
    return [...roles];
  },
  async recordGrant(grant) {
    const id = key(grant.guildId, grant.userId, grant.roleId, grant.ruleId);
    const previous = grants.get(id);
    grants.set(id, { ...grant, botAddedRole: previous?.botAddedRole ?? false });
    return { hadPrevious: Boolean(previous), previousMatched: previous?.matched ?? false };
  },
  async activeCount(guildId, userId, roleId, action) {
    return [...grants.values()].filter((g) => g.guildId === guildId && g.userId === userId && g.roleId === roleId && g.matched && g.action === action).length;
  },
  async getRoleState(guildId, userId, roleId) {
    const state = states.get(key(guildId, userId, roleId));
    return { botAddedRole: state?.botAddedRole ?? false, manualMarked: state?.manualMarked ?? false, lastKnownPresent: state?.lastKnownPresent ?? false };
  },
  async observeRolePresence(guildId, userId, roleId, present) {
    const id = key(guildId, userId, roleId);
    const state = states.get(id);
    const owned = [...grants.values()].some((g) => g.guildId === guildId && g.userId === userId && g.roleId === roleId && g.botAddedRole);
    if (!state) states.set(id, { guildId, userId, roleId, botAddedRole: owned, manualMarked: present && !owned, lastKnownPresent: present });
    else {
      const next = { ...state };
      if (present && state.botAddedRole && !state.lastKnownPresent) { next.manualMarked = true; next.botAddedRole = false; }
      else if (present && !state.botAddedRole) next.manualMarked = true;
      next.lastKnownPresent = present;
      states.set(id, next);
    }
  },
  async markBotAdded(guildId, userId, roleId) {
    states.set(key(guildId, userId, roleId), { guildId, userId, roleId, botAddedRole: true, manualMarked: false, lastKnownPresent: true });
    for (const [id, grant] of grants) if (grant.guildId === guildId && grant.userId === userId && grant.roleId === roleId && grant.action === 'add_role' && grant.matched) grants.set(id, { ...grant, botAddedRole: true });
  },
  async markBotRemoved(guildId, userId, roleId) {
    states.set(key(guildId, userId, roleId), { guildId, userId, roleId, botAddedRole: false, manualMarked: false, lastKnownPresent: false });
    for (const [id, grant] of grants) if (grant.guildId === guildId && grant.userId === userId && grant.roleId === roleId) grants.set(id, { ...grant, botAddedRole: false });
  },
  async recordAudit(audit) { audits.push(audit); },
};
const savedRules = { vanity: [], guildtag: [] };
stub('src/db/identity.js', {
  ...ledger,
  listVanityRules: async () => savedRules.vanity,
  listGuildTagRules: async () => savedRules.guildtag,
  createRule: async (source, guildId, rule) => { savedRules[source].push({ id: `id${savedRules[source].length}`, ...rule }); },
  updateRule: async (source, guildId, name, fields) => { Object.assign(savedRules[source].find((rule) => rule.name === name), fields); return true; },
  deleteRule: async (source, guildId, name) => { const before = savedRules[source].length; savedRules[source] = savedRules[source].filter((rule) => rule.name !== name); return savedRules[source].length < before; },
});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { evaluate } = require('../src/utils/identity/engine');
const compare = require('../src/utils/identity/compare');
const { toPettoTemplate, renameTokens, freeName } = require('../src/utils/identity/importVanity');
const { identityContext, eventKey } = require('../src/utils/identity/emit');
const { VARIABLE_GROUPS } = require('../src/utils/embedVariableRegistry');

const rules = require('../src/utils/identity/rules');
const reset = () => { grants.clear(); states.clear(); audits.length = 0; };
const person = (over = {}) => ({ guildId: 'g', userId: 'u', isBot: false, username: 'liam', globalName: 'Liam', guildNickname: '', displayName: 'Liam', avatarUrl: '', customStatus: '', unknownSources: new Set(), primaryGuild: null, roleIds: new Set(), ...over });
const vrule = (over = {}) => ({ id: 'r1', name: 'rep', word: 'cinnamochi', source: 'custom_status', comparison: 'contains', role_id: 'role1', action: 'add_role', enabled: true, ...over });
const frule = (over = {}) => ({ id: 't1', name: 'partner', condition: 'is_guild_id', value: '777', role_id: 'role2', action: 'add_role', enabled: true, ...over });

function roleClient(log) {
  return { add: async (g, u, r) => { log.push(`add:${r}`); }, remove: async (g, u, r) => { log.push(`remove:${r}`); } };
}

(async () => {
  // ---- How rules match
  assert.equal(compare.matchVanity(vrule(), person({ customStatus: '  ♡ CinnaMochi  ' })), true, 'case and spaces do not matter');
  assert.equal(compare.matchVanity(vrule({ comparison: 'equals' }), person({ customStatus: 'cinnamochi ♡' })), false);
  assert.equal(compare.matchVanity(vrule({ comparison: 'starts_with', word: 'cinna' }), person({ customStatus: 'Cinnamochi' })), true);
  assert.equal(compare.matchVanity(vrule({ comparison: 'ends_with', word: 'mochi' }), person({ customStatus: 'Cinnamochi' })), true);
  assert.equal(compare.matchVanity(vrule({ comparison: 'regex', word: '^cinna.+$' }), person({ customStatus: 'Cinnamochi' })), true);
  assert.throws(() => compare.matchVanity(vrule({ comparison: 'regex', word: '(' }), person()), /not valid/, 'a pattern that does not compile is an error');
  assert.throws(() => compare.matchVanity(vrule({ comparison: 'regex', word: 'a'.repeat(300) }), person()), /longer than/);
  assert.equal(compare.matchVanity(vrule({ source: 'display_name', word: 'liam', comparison: 'equals' }), person({ guildNickname: 'Liam' })), true, 'display name starts from the nickname');
  assert.equal(compare.matchGuildTag(frule(), null), false, 'no data from Discord means no match');
  assert.equal(compare.matchGuildTag(frule({ condition: 'is_not_guild_id' }), null), false, 'a negative condition never matches missing data');
  assert.equal(compare.matchGuildTag(frule(), { identityGuildId: '777', identityEnabled: true, tag: 'PET', badge: '' }), true);
  assert.equal(compare.matchGuildTag(frule({ condition: 'is_not_guild_id' }), { identityGuildId: '777', tag: 'PET' }), false);
  assert.equal(compare.matchGuildTag(frule({ condition: 'identity_disabled' }), { identityGuildId: '1', identityEnabled: null }), false, 'unknown is not disabled');
  assert.equal(compare.matchGuildTag(frule({ condition: 'tag_equals', value: 'pet' }), { tag: 'PET' }), true, 'tag text ignores case');

  // ---- Checks on a rule
  assert.match(compare.validateVanityRule({ ...vrule(), name: '' }), /name/);
  assert.match(compare.validateVanityRule({ ...vrule(), comparison: 'regex', word: '(' }), /not valid/);
  assert.equal(compare.validateVanityRule(vrule()), null);
  assert.match(compare.validateGuildTagRule({ ...frule(), value: '' }), /needs/);
  assert.equal(compare.validateGuildTagRule({ ...frule(), condition: 'identity_enabled', value: '' }), null);

  // ---- The engine: add, keep, remove
  reset();
  let calls = [];
  const options = (log) => ({ roles: roleClient(log), onAction: (a) => log.push(`action:${a.action}:${a.result}`), onNotify: (a) => log.push(`notify:${a.source}`) });
  let results = await evaluate(person({ customStatus: 'cinnamochi' }), { vanity: [vrule()], guildtag: null }, options(calls));
  assert.deepEqual(calls, ['add:role1', 'action:add_role:completed', 'notify:vanity'], 'a matching member gets the role, it is logged and they are thanked');
  assert.equal(results[0].changed, true);
  assert.equal((await ledger.getRoleState('g', 'u', 'role1')).botAddedRole, true, 'the bot remembers it put the role there');

  calls = [];
  await evaluate(person({ customStatus: 'cinnamochi', roleIds: new Set(['role1']) }), { vanity: [vrule()], guildtag: null }, options(calls));
  assert.deepEqual(calls, [], 'a member who already has it is not changed or thanked twice');

  calls = [];
  await evaluate(person({ customStatus: 'something else', roleIds: new Set(['role1']) }), { vanity: [vrule()], guildtag: null }, options(calls));
  assert.deepEqual(calls, ['remove:role1', 'action:remove_role:completed'], 'a role the bot gave is taken away when the member stops matching');

  // ---- A role a person gave is never taken away
  reset(); calls = [];
  await evaluate(person({ customStatus: 'nothing', roleIds: new Set(['role1']) }), { vanity: [vrule()], guildtag: null }, options(calls));
  assert.deepEqual(calls, [], 'the member had the role before the bot saw it: it was given by hand');
  await evaluate(person({ customStatus: 'cinnamochi', roleIds: new Set(['role1']) }), { vanity: [vrule()], guildtag: null }, options(calls));
  await evaluate(person({ customStatus: 'nothing', roleIds: new Set(['role1']) }), { vanity: [vrule()], guildtag: null }, options(calls));
  assert.deepEqual(calls.filter((c) => c.startsWith('remove')), [], 'still never removed');

  // ---- A remove rule wins, and an add rule that goes away is not enough to remove by itself
  reset(); calls = [];
  const both = [vrule(), vrule({ id: 'r2', name: 'ban', word: 'bad', action: 'remove_role' })];
  await evaluate(person({ customStatus: 'cinnamochi bad' }), { vanity: both, guildtag: null }, options(calls));
  assert.deepEqual(calls.filter((c) => c.startsWith('add')), [], 'the remove rule wins over the add rule');

  // ---- Two sources for one role: the role stays while one of them matches
  reset(); calls = [];
  const shared = [vrule(), vrule({ id: 'r3', name: 'other', word: 'mochi' })];
  await evaluate(person({ customStatus: 'cinnamochi' }), { vanity: shared, guildtag: null }, options(calls));
  calls = [];
  await evaluate(person({ customStatus: 'mochi', roleIds: new Set(['role1']) }), { vanity: shared, guildtag: null }, options(calls));
  assert.deepEqual(calls, [], 'one rule still matches, the role stays');

  // ---- Deleting or turning off a rule stops its grants
  reset(); calls = [];
  await evaluate(person({ customStatus: 'cinnamochi' }), { vanity: [vrule()], guildtag: null }, options(calls));
  calls = [];
  await evaluate(person({ customStatus: 'cinnamochi', roleIds: new Set(['role1']) }), { vanity: [], guildtag: null }, options(calls));
  assert.deepEqual(calls, ['remove:role1', 'action:remove_role:completed'], 'with the rule gone the bot takes its own role away');

  // ---- An unknown Custom Status leaves the grant alone
  reset(); calls = [];
  await evaluate(person({ customStatus: 'cinnamochi' }), { vanity: [vrule()], guildtag: null }, options(calls));
  calls = [];
  await evaluate(person({ customStatus: '', unknownSources: new Set(['custom_status']), roleIds: new Set(['role1']) }), { vanity: [vrule()], guildtag: null }, options(calls));
  assert.deepEqual(calls, [], 'no presence is not an empty status');

  // ---- Server Tag rules, and a source that was not evaluated
  reset(); calls = [];
  await evaluate(person({ primaryGuild: { identityGuildId: '777', identityEnabled: true, tag: 'PET', badge: 'b' } }), { vanity: null, guildtag: [frule()] }, options(calls));
  assert.deepEqual(calls, ['add:role2', 'action:add_role:completed', 'notify:guildtag']);
  calls = [];
  await evaluate(person({ roleIds: new Set(['role2']), primaryGuild: null }), { vanity: [], guildtag: null }, options(calls));
  assert.deepEqual(calls, [], 'a source that was not evaluated keeps its grants');
  await evaluate(person({ roleIds: new Set(['role2']), primaryGuild: null }), { vanity: null, guildtag: [frule()] }, options(calls));
  assert.deepEqual(calls, ['remove:role2', 'action:remove_role:completed'], 'no Server Tag any more: the role goes');

  // ---- Bots are never touched; a failing role change is reported
  reset(); calls = [];
  assert.deepEqual(await evaluate(person({ isBot: true, customStatus: 'cinnamochi' }), { vanity: [vrule()], guildtag: null }, options(calls)), []);
  const broken = { add: async () => { throw new Error('Missing Permissions'); }, remove: async () => {} };
  const errors = [];
  results = await evaluate(person({ customStatus: 'cinnamochi' }), { vanity: [vrule()], guildtag: null }, { roles: broken, onAction: (a) => errors.push(a) });
  assert.equal(errors[0].result, 'error');
  assert.equal(eventKey(errors[0]), 'error');
  assert.equal(results[0].error.message, 'Missing Permissions');
  assert.equal((await ledger.getRoleState('g', 'u', 'role1')).botAddedRole, false, 'a failed change is not remembered as done');

  // ---- Messages: the variables of a rule
  const context = identityContext({ source: 'vanity', action: 'add_role', roleId: 'role1', ruleName: 'rep', value: 'cinnamochi', matchField: 'custom_status', matchedValue: 'cinnamochi ♡', result: 'completed' });
  assert.equal(context.vanity.word, 'cinnamochi');
  assert.equal(context.rule.role, '<@&role1>');
  assert.equal(context.tag, null);
  assert.equal(identityContext({ source: 'guildtag', action: 'add_role', tag: 'PET', value: '777' }).tag.text, 'PET');
  const listed = VARIABLE_GROUPS.find((group) => group.id === 'identity').vars.map((variable) => variable.tok);
  assert.ok(listed.includes('{vanity.value}') && listed.includes('{tag}') && listed.includes('{rule.role}'));

  // ---- Import of the old Vanity bot's data
  assert.equal(renameTokens('hi {user.mention}, {role} {action.text} {event.title} {vanity.word}'), 'hi {user.mention}, {rule.role} {rule.action_text} {rule.event_title} {vanity.word}');
  const imported = toPettoTemplate({ content: 'hey {role}', title: 'Thanks', description: 'for {identity.value}', color: 15774404, footer: 'Petto', author: { name: 'Bot' }, fields: [{ name: 'a', value: 'b', inline: true }], buttons: [[{ label: 'Open', url: 'https://petto.sbs' }]] });
  assert.equal(imported.content, 'hey {rule.role}');
  assert.equal(imported.embeds[0].description, 'for {vanity.value}');
  assert.deepEqual(imported.embeds[0].footer, { text: 'Petto', icon: '' }, 'a flat footer becomes the nested one');
  assert.equal(imported.embeds[0].author.name, 'Bot');
  assert.equal(imported.buttons[0][0].url, 'https://petto.sbs');
  assert.deepEqual(toPettoTemplate({ content: 'only text' }).embeds, [], 'a message with only text has no embed');
  assert.equal(freeName('Thanks!', new Set()), 'thanks_');
  assert.equal(freeName('thanks', new Set(['thanks'])), 'vanity-thanks', 'a name Petto already has is not overwritten');
  assert.equal(freeName('thanks', new Set(['thanks', 'vanity-thanks'])), 'vanity-thanks-2');

  // ---- Creating rules from a command or the dashboard
  const role = (id, position, managed = false) => ({ id, position, managed });
  const guild = {
    id: 'g', ownerId: 'owner',
    roles: { cache: new Map([['g', role('g', 0)], ['low', role('low', 1)], ['mid', role('mid', 5)], ['up', role('up', 7)], ['high', role('high', 9)], ['bot', role('bot', 7, true)]]) },
    members: { me: { roles: { highest: { position: 8 } } } },
  };
  const admin = { id: 'admin', roles: { highest: { position: 6 } } };
  assert.equal(rules.roleProblem(guild, 'low'), null, 'a role below the bot can be handed out');
  assert.equal(rules.roleProblem(guild, 'high').code, 'role_above_bot');
  assert.equal(rules.roleProblem(guild, 'bot').code, 'role_managed');
  assert.equal(rules.roleProblem(guild, 'nope').code, 'role_not_found');
  assert.equal(rules.roleProblem(guild, 'g').code, 'role_not_found', '@everyone is not a role to hand out');
  assert.equal(rules.roleProblem(guild, 'up', admin).code, 'role_above_you', 'a role above the person setting it up is refused');
  assert.equal(rules.roleProblem(guild, 'up', { ...admin, id: 'owner' }), null, 'the owner can use any role the bot can give');

  let made = await rules.createRule(guild, 'vanity', { name: 'Rep!', word: 'x', source: 'custom_status', comparison: 'contains', role_id: 'low', action: 'add_role' }, admin, 'admin');
  assert.equal(made.code, 'invalid_name');
  made = await rules.createRule(guild, 'vanity', { name: 'rep', word: 'x', source: 'custom_status', comparison: 'contains', role_id: 'low', action: 'add_role' }, admin, 'admin');
  assert.equal(made.ok, true);
  made = await rules.createRule(guild, 'vanity', { name: 'REP', word: 'y', source: 'custom_status', comparison: 'contains', role_id: 'low', action: 'add_role' }, admin, 'admin');
  assert.equal(made.code, 'duplicate_name', 'names ignore case');
  made = await rules.createRule(guild, 'vanity', { name: 'bad', word: '(', source: 'custom_status', comparison: 'regex', role_id: 'low', action: 'add_role' }, admin, 'admin');
  assert.equal(made.code, 'invalid_rule');
  let changed = await rules.updateRule(guild, 'vanity', 'rep', { comparison: 'regex', word: '(' }, admin);
  assert.equal(changed.code, 'invalid_rule', 'an edit is checked as a whole rule');
  changed = await rules.updateRule(guild, 'vanity', 'rep', { word: 'x' }, admin);
  assert.equal(changed.unchanged, true);
  changed = await rules.updateRule(guild, 'vanity', 'missing', { word: 'z' }, admin);
  assert.equal(changed.code, 'rule_not_found');
  guild.roles.cache.set('low', role('low', 9));
  changed = await rules.updateRule(guild, 'vanity', 'rep', { enabled: false }, admin);
  assert.equal(changed.ok, true, 'a rule can always be turned off, even when its role became unassignable');
  assert.equal((await rules.removeRule(guild, 'vanity', 'rep')).ok, true);
  assert.equal((await rules.removeRule(guild, 'vanity', 'rep')).code, 'rule_not_found');

  console.log('Checked the Vanity and Server Tag rules.');
})().catch((error) => { console.error(error); process.exit(1); });
