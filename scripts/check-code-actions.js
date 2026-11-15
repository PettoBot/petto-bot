// Checks the functions of Petto Code that reach beyond the message: the ones that read the server and the web, the ones that change it
// (messages, channels, threads, roles, nicknames, moderation, scheduling) and the ones that only work on values. A command acts as the member
// who used it, so every action is checked with a member who may and one who may not.
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits: P, Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const log = { warn: [], error: [] };
stub('src/utils/logger.js', { info() {}, warn: (text) => log.warn.push(String(text)), error: (text) => log.error.push(String(text)) });
const cases = [];
const warnings = [];
const dms = [];
const logged = [];
const hardBans = new Set();
stub('src/db/modActions.js', {
  createCase: async (values) => { cases.push(values); return { case_number: cases.length, ...values }; },
  getActiveSanction: async () => null,
  deactivateCase: async () => {},
});
stub('src/db/guilds.js', { ensureGuild: async () => ({ mute_role_id: null }) });
stub('src/db/warns.js', { addWarn: async (values) => { warnings.push(values); return { modCase: { case_number: 100 + warnings.length }, warnCount: warnings.length }; } });
stub('src/utils/escalation.js', { checkAndApplyEscalation: async () => {} });
stub('src/db/hardBans.js', { getHardBan: async (guildId, userId) => (hardBans.has(userId) ? { userId } : null), removeHardBan: async (guildId, userId) => { hardBans.delete(userId); }, canLiftHardBan: async () => false });
stub('src/utils/sanctionTemplates.js', { sanctionDM: async (options) => ({ dm: options.type }), updateSanctionDm: async () => {} });
stub('src/utils/dmOrigin.js', { sendDm: async (target, payload) => { dms.push({ to: target.id, payload }); return { id: 'dm' }; } });
stub('src/utils/caseLog.js', { logSanction: async (client, guild, options) => { logged.push(options); } });

const { run, functionNames, DEFAULT_LIMITS } = require('../src/scripting');
const actions = require('../src/utils/codeActions');
const scriptingActions = require('../src/scripting/actions');
const http = require('../src/utils/codeHttp');

const ID = (n) => String(100000000000000000n + BigInt(n));
const BOT = ID(1);
const OWNER = ID(2);
const MEMBER = ID(10); // the member who uses the commands
const TARGET = ID(11);
const GUILD = ID(99);

// ── The new functions exist, none is defined twice, and the old ones are still there ──
const NEW_FUNCTIONS = [
  'getMessage', 'getMessages', 'userInfo', 'guildInfo', 'hasPermission', 'isBanned', 'listRoles', 'listChannels', 'httpGet', 'httpPost',
  'editMessage', 'deleteMessage', 'pinMessage', 'unpinMessage', 'purgeMessages', 'reactToMessage',
  'createChannel', 'editChannel', 'deleteChannel', 'setSlowmode', 'lockChannel', 'unlockChannel', 'createThread', 'lockThread', 'archiveThread',
  'ban', 'tempban', 'unban', 'kick', 'mute', 'unmute', 'warn',
  'createRole', 'editRole', 'deleteRole', 'addRoleTo', 'removeRoleFrom', 'setNickname', 'scheduleUniqueCC', 'cancelScheduledCC',
  'wordCount', 'lines', 'slug', 'initials', 'bar', 'randomString', 'uuid', 'sha256', 'base64Encode', 'base64Decode',
  'avg', 'median', 'percent', 'between', 'sign', 'trunc', 'lerp', 'chunk', 'flatten', 'pluck', 'take', 'drop', 'without', 'zip', 'upTo', 'countOf', 'minOf', 'maxOf',
  'coalesce', 'ternary', 'startOfDay', 'daysBetween', 'isWeekend', 'addDays',
];
const names = functionNames();
for (const name of NEW_FUNCTIONS) assert.ok(names.includes(name), `${name} exists`);
for (const name of ['sendMessage', 'addRole', 'execCC', 'getMember', 'dbSet', 'cembed']) assert.ok(names.includes(name), `${name} is still there`);
assert.equal(new Set(names).size, names.length, 'no name twice');
assert.ok(names.length >= 220, `there are ${names.length} functions`);

// Everything a function needs is in the limits.
for (const type of ['editMessage', 'deleteMessage', 'ban', 'warn', 'createChannel', 'createRole', 'addRoleTo', 'setNickname', 'schedule', 'cancelSchedule']) {
  assert.ok(DEFAULT_LIMITS.effects[type] > 0, `${type} has a limit`);
}
assert.equal(DEFAULT_LIMITS.maxHttp, 3);

const data = { Channel: { ID: ID(500) }, Cmd: 'test', User: { ID: MEMBER } };
const effects = async (code, extra = {}, options = {}) => (await run(code, { ...data, ...extra }, options)).effects;
const failsWith = async (code, includes, options = {}) => {
  try { await run(code, data, options); } catch (error) {
    assert.ok(error.message.includes(includes), `"${error.message}" should say "${includes}" for ${code}`);
    return error;
  }
  return assert.fail(`${code} should have failed`);
};
const out = async (code, options) => (await run(code, data, options)).output;

(async () => {
  // ── Values only ──────────────────────────────────────────────────────────
  assert.equal(await out('{{ wordCount "one two  three" }} {{ len (lines "a\nb\nc") }} {{ slug "Héllo Wörld! 2026" }} {{ initials "liam santi petto" }} {{ initials "liam santi petto" 3 }}'), '3 3 hello-world-2026 LS LSP');
  assert.equal(await out('{{ bar 7 10 }} {{ bar 0 10 4 }} {{ bar 5 0 4 }} {{ bar 99 10 5 }}'), '███████░░░ ░░░░ ░░░░ █████');
  assert.equal(await out('{{ len (randomString 12) }} {{ len (randomString 5 "ab") }} {{ len (uuid) }} {{ len (sha256 "x") }}'), '12 5 36 64');
  assert.match(await out('{{ randomString 8 "x" }}'), /^x{8}$/);
  assert.equal(await out('{{ base64Encode "Petto ✨" }} {{ base64Decode (base64Encode "Petto ✨") }}'), 'UGV0dG8g4pyo Petto ✨');
  await failsWith('{{ base64Decode "%%%" }}', 'base64');
  assert.equal(await out('{{ avg 1 2 3 }} {{ avg (cslice 2 4) }} {{ median 5 1 3 }} {{ median 1 2 3 4 }} {{ percent 1 3 1 }} {{ percent 1 0 }} {{ percent 1 4 }}'), '2 3 3 2.5 33.3 0 25');
  assert.equal(await out('{{ between 5 1 10 }} {{ between 11 10 1 }} {{ sign -4 }} {{ trunc 2.9 }} {{ lerp 0 10 0.25 }} {{ lerp 0 10 3 }}'), 'true false -1 2 2.5 10');
  assert.equal(await out('{{ chunk (seq 0 5) 2 }} {{ flatten (cslice (cslice 1 2) 3) }} {{ take (seq 0 5) 2 }} {{ drop (seq 0 5) 3 }} {{ without (seq 0 5) 1 3 }}'), '[[0 1] [2 3] [4]] [1 2 3] [0 1] [3 4] [0 2 4]');
  assert.equal(await out('{{ pluck (cslice (dict "ID" 1) (dict "ID" 2) 5) "ID" }} {{ zip (cslice 1 2 3) (cslice "a" "b") }} {{ upTo 1 4 }} {{ upTo 10 0 -5 }} {{ upTo 5 1 -2 }}'), '[1 2 <nil>] [[1 a] [2 b]] [1 2 3 4] [10 5 0] [5 3 1]'.replace('<nil>', ''));
  assert.equal(await out('{{ countOf (cslice 1 2 1) 1 }} {{ minOf (cslice 4 2 9) }} {{ maxOf (cslice 4 2 9) }} {{ minOf (cslice) }}|'), '2 2 9 |');
  assert.equal(await out('{{ coalesce nil "" "x" "y" }} {{ coalesce nil (cslice) }}| {{ ternary true "yes" "no" }} {{ ternary 0 "yes" "no" }}'), 'x | yes no');
  // 2026-11-15 18:00:00 UTC is a Sunday; a day is 86400 seconds.
  const sunday = Math.floor(Date.UTC(2026, 10, 15, 18, 0, 0) / 1000);
  assert.equal(await out(`{{ startOfDay ${sunday} }} {{ daysBetween ${sunday} ${sunday + 3 * 86400 + 5} }} {{ isWeekend ${sunday} }} {{ isWeekend ${sunday + 86400} }} {{ addDays ${sunday} 2 }}`), `${Math.floor(Date.UTC(2026, 10, 15) / 1000)} 3 true false ${sunday + 2 * 86400}`);
  assert.equal(await out(`{{ startOfDay ${sunday} -5 }}`), String(Math.floor(Date.UTC(2026, 10, 15, 5) / 1000)), 'the start of the day in another time zone');
  await failsWith('{{ chunk (seq 0 3) 0 }}', 'chunk');
  await failsWith('{{ initials "a b" 99 }}', 'initials');

  // ── The functions that read: they ask the lookup, with the arguments checked ──
  const calls = [];
  const lookup = { async message(...args) { calls.push(['message', ...args]); return { ID: args[1] }; }, async messages(...args) { calls.push(['messages', ...args]); return []; }, async user(id) { calls.push(['user', id]); return { ID: id }; }, async guild() { calls.push(['guild']); return { Name: 'HQ' }; }, async permission(...args) { calls.push(['permission', ...args]); return true; }, async banned(id) { calls.push(['banned', id]); return false; }, async roles() { calls.push(['roles']); return []; }, async channels(kind) { calls.push(['channels', kind]); return []; }, async http(spec) { calls.push(['http', spec]); return { Status: 200, OK: true, Body: '{"a":1}', JSON: JSON.parse('{"a":1,"__proto__":{"x":1},"n":{"__proto__":2}}'), ContentType: 'application/json', Location: null, Truncated: false, Error: null }; } };
  const viaLookup = { lookup };
  await run(`{{ getMessage nil "${ID(700)}" }}{{ getMessages "<#${ID(501)}>" 3 }}{{ getMessages }}{{ userInfo "<@${TARGET}>" }}{{ guildInfo }}`, data, viaLookup);
  assert.deepEqual(calls.slice(0, 5), [['message', ID(500), ID(700)], ['messages', ID(501), 3], ['messages', ID(500), 5], ['user', TARGET], ['guild']], 'a channel that is nil is the one of the command; a mention is read as its ID');
  calls.length = 0;
  await run(`{{ hasPermission "${TARGET}" "manage messages" }}{{ hasPermission "${TARGET}" "BanMembers" "${ID(501)}" }}{{ isBanned "${TARGET}" }}{{ listRoles }}{{ listChannels }}{{ listChannels "voice" }}`, data, viaLookup);
  assert.deepEqual(calls, [['permission', TARGET, 'ManageMessages', null], ['permission', TARGET, 'BanMembers', ID(501)], ['banned', TARGET], ['roles'], ['channels', null], ['channels', 'voice']], 'a permission is written as people write it and read as discord.js spells it');
  await failsWith(`{{ hasPermission "${TARGET}" "fly" }}`, 'not a permission', viaLookup);
  await failsWith('{{ listChannels "cave" }}', 'does not know "cave"', viaLookup);
  await failsWith('{{ getMessage nil 5 }}', 'Discord ID', viaLookup);
  await failsWith('{{ getMessages nil 99 }}', 'from 1 to 10', viaLookup);
  await failsWith('{{ guildInfo }}', 'cannot be read here');
  assert.equal(DEFAULT_LIMITS.maxLookups, 10);
  await failsWith(`{{ range seq 0 12 }}{{ getMessage nil "${ID(700)}" }}{{ end }}`, 'at most 10', viaLookup);

  // The answer of a web page: its JSON never carries a key that could change what every map is.
  calls.length = 0;
  const result = await run('{{ $r := httpGet "https://example.com/data" (dict "X-Key" "k") }}{{ $r.Status }} {{ $r.JSON.a }} {{ kindOf $r.JSON }}', data, viaLookup);
  assert.equal(result.output, '200 1 map');
  assert.deepEqual(calls[0], ['http', { method: 'GET', url: 'https://example.com/data', headers: { 'X-Key': 'k' } }]);
  calls.length = 0;
  await run('{{ httpPost "https://example.com/p" (dict "a" 1) }}{{ httpPost "https://example.com/p" "raw" (dict "Content-Type" "text/plain") }}', data, viaLookup);
  assert.equal(calls[0][1].body, '{"a":1}');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json', 'a map goes as JSON');
  assert.equal(calls[1][1].headers['Content-Type'], 'text/plain');
  await failsWith('{{ httpGet "https://example.com" 5 }}', 'a map', viaLookup);
  await failsWith(`{{ httpPost "https://example.com" "${'x'.repeat(5001)}" }}`, '5000', viaLookup);
  await failsWith(`{{ range seq 0 4 }}{{ httpGet "https://example.com" }}{{ end }}`, 'at most 3', viaLookup);

  // ── What copies a command of Petto only works when a button, a menu, a form or a reaction started the code ──
  const COPIES = ['ban', 'tempban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'lockChannel', 'unlockChannel', 'purgeMessages', 'setSlowmode', 'createChannel', 'editChannel', 'deleteChannel', 'createThread', 'lockThread', 'archiveThread', 'createRole', 'editRole', 'deleteRole', 'addRoleTo', 'removeRoleFrom', 'setNickname'];
  assert.deepEqual(Object.keys(scriptingActions.EVENT_ONLY).sort(), [...COPIES].sort(), 'the list of what copies a command');
  const sample = {
    ban: `{{ ban "${TARGET}" }}`, tempban: `{{ tempban "${TARGET}" 120 }}`, unban: `{{ unban "${TARGET}" }}`, kick: `{{ kick "${TARGET}" }}`, mute: `{{ mute "${TARGET}" 60 }}`, unmute: `{{ unmute "${TARGET}" }}`, warn: `{{ warn "${TARGET}" "x" }}`,
    lockChannel: '{{ lockChannel }}', unlockChannel: '{{ unlockChannel }}', purgeMessages: '{{ purgeMessages 5 }}', setSlowmode: '{{ setSlowmode 5 }}', createChannel: '{{ createChannel "x" "text" }}',
    editChannel: `{{ editChannel "${ID(501)}" (dict "name" "x") }}`, deleteChannel: `{{ deleteChannel "${ID(501)}" }}`, createThread: '{{ createThread nil "x" }}', lockThread: `{{ lockThread "${ID(520)}" }}`, archiveThread: `{{ archiveThread "${ID(520)}" }}`,
    createRole: '{{ createRole "x" }}', editRole: `{{ editRole "${ID(40)}" (dict "name" "x") }}`, deleteRole: `{{ deleteRole "${ID(40)}" }}`, addRoleTo: `{{ addRoleTo "${TARGET}" "${ID(40)}" }}`, removeRoleFrom: `{{ removeRoleFrom "${TARGET}" "${ID(40)}" }}`, setNickname: `{{ setNickname "${TARGET}" "x" }}`,
  };
  for (const name of COPIES) {
    for (const origin of ['command', 'exec']) {
      try { await run(sample[name], { ...data, Origin: origin }); assert.fail(`${name} must not work in a typed command (${origin})`); } catch (error) {
        assert.match(error.message, new RegExp(`${name} only works in a button, a menu, a form or a reaction, not in a typed command: Petto already has !`), `${name} says what to use instead`);
      }
    }
    for (const origin of ['reaction', 'button', 'select', 'modal']) assert.equal((await run(sample[name], { ...data, Origin: origin })).effects.length, 1, `${name} works when a ${origin} started the code`);
    assert.equal((await run(sample[name], data)).effects.length, 1, `${name} in a preview (no origin) only notes the action`);
  }
  // The others have no command of Petto that does the same, so they work everywhere.
  for (const code of [`{{ editMessage nil "${ID(700)}" "x" }}`, `{{ deleteMessage nil "${ID(700)}" }}`, `{{ pinMessage nil "${ID(700)}" }}`, `{{ reactToMessage nil "${ID(700)}" "👍" }}`, '{{ scheduleUniqueCC "remind" "a" 60 }}']) {
    assert.equal((await run(code, { ...data, Origin: 'command' })).effects.length, 1, `${code} works in a typed command`);
  }
  assert.equal((await run('{{ scheduleUniqueCC "remind" "a" 60 }}', { ...data, Origin: 'button' })).effects[0].origin, 'button', 'what is scheduled remembers what started it');
  assert.equal((await run('{{ scheduleUniqueCC "remind" "a" 60 }}', data)).effects[0].origin, 'command');

  // ── The functions that act: what they note, and their mistakes ───────────
  assert.deepEqual(await effects(`{{ editMessage nil "${ID(700)}" "new" }}{{ deleteMessage "${ID(501)}" "${ID(701)}" 30 }}{{ pinMessage nil "${ID(700)}" }}{{ unpinMessage nil "${ID(700)}" }}{{ purgeMessages 20 }}{{ purgeMessages "${ID(501)}" 5 }}{{ reactToMessage nil "${ID(700)}" "🔥" }}`), [
    { type: 'editMessage', channelId: ID(500), messageId: ID(700), content: 'new' },
    { type: 'deleteMessage', channelId: ID(501), messageId: ID(701), delay: 30 },
    { type: 'pinMessage', channelId: ID(500), messageId: ID(700) },
    { type: 'unpinMessage', channelId: ID(500), messageId: ID(700) },
    { type: 'purgeMessages', channelId: ID(500), count: 20 },
    { type: 'purgeMessages', channelId: ID(501), count: 5 },
    { type: 'reactToMessage', channelId: ID(500), messageId: ID(700), emoji: '🔥' },
  ]);
  await failsWith('{{ purgeMessages 101 }}', 'from 1 to 100');
  await failsWith(`{{ deleteMessage nil "${ID(700)}" 999 }}`, 'from 0 to 300');
  await failsWith(`{{ editMessage nil "${ID(700)}" "" }}`, 'message');
  await failsWith(`{{ reactToMessage nil "${ID(700)}" "" }}`, 'emoji');
  assert.deepEqual(await effects(`{{ createChannel "new-chat" "text" }}{{ createChannel "Voice" "voice" "${ID(510)}" }}{{ editChannel "${ID(501)}" (dict "name" "renamed" "slowmode" 10 "nsfw" true "parent" nil "topic" "") }}{{ deleteChannel "${ID(501)}" }}{{ setSlowmode 5 }}{{ lockChannel }}{{ unlockChannel "${ID(501)}" "done" }}{{ createThread nil "talk" }}{{ createThread nil "about it" "${ID(700)}" }}{{ lockThread "${ID(520)}" }}{{ archiveThread "${ID(520)}" }}`), [
    { type: 'createChannel', name: 'new-chat', kind: 'text', parentId: null },
    { type: 'createChannel', name: 'Voice', kind: 'voice', parentId: ID(510) },
    { type: 'editChannel', channelId: ID(501), changes: { name: 'renamed', slowmode: 10, nsfw: true, parentId: null, topic: '' } },
    { type: 'deleteChannel', channelId: ID(501) },
    { type: 'editChannel', channelId: ID(500), changes: { slowmode: 5 } },
    { type: 'lockChannel', channelId: ID(500), reason: null },
    { type: 'unlockChannel', channelId: ID(501), reason: 'done' },
    { type: 'createThread', channelId: ID(500), name: 'talk', messageId: null },
    { type: 'createThread', channelId: ID(500), name: 'about it', messageId: ID(700) },
    { type: 'lockThread', channelId: ID(520) },
    { type: 'archiveThread', channelId: ID(520) },
  ]);
  await failsWith('{{ createChannel "x" "cave" }}', 'does not know "cave"');
  await failsWith('{{ createChannel "" "text" }}', 'cannot be empty');
  await failsWith(`{{ createChannel "${'x'.repeat(101)}" "text" }}`, 'longer than 100');
  await failsWith(`{{ editChannel "${ID(501)}" (dict "color" 1) }}`, 'does not know "color"');
  await failsWith(`{{ editChannel "${ID(501)}" (dict) }}`, 'at least one change');
  await failsWith(`{{ editChannel "${ID(501)}" (dict "slowmode" 99999) }}`, 'from 0 to 21600');
  await failsWith(`{{ editChannel "${ID(501)}" "name" }}`, 'a map');
  await failsWith('{{ range seq 0 4 }}{{ createChannel "x" "text" }}{{ end }}', 'at most 3');

  assert.deepEqual(await effects(`{{ ban "<@${TARGET}>" 2 "spam" }}{{ ban "${TARGET}" }}{{ tempban "${TARGET}" (toDuration "1d") "cool off" }}{{ unban "${TARGET}" "sorry" }}{{ kick "${TARGET}" }}{{ mute "${TARGET}" (toDuration "10m") "quiet" }}{{ unmute "${TARGET}" }}{{ warn "${TARGET}" "rule 2" }}`), [
    { type: 'ban', userId: TARGET, days: 2, reason: 'spam' },
    { type: 'ban', userId: TARGET, days: 0, reason: null },
    { type: 'tempban', userId: TARGET, seconds: 86400, reason: 'cool off' },
    { type: 'unban', userId: TARGET, reason: 'sorry' },
    { type: 'kick', userId: TARGET, reason: null },
    { type: 'mute', userId: TARGET, seconds: 600, reason: 'quiet' },
    { type: 'unmute', userId: TARGET, reason: null },
    { type: 'warn', userId: TARGET, reason: 'rule 2' },
  ]);
  await failsWith(`{{ ban "${TARGET}" 8 }}`, 'from 0 to 7');
  await failsWith(`{{ mute "${TARGET}" 99999999 }}`, 'from 1 to 2419200');
  await failsWith(`{{ tempban "${TARGET}" 5 }}`, 'from 60');
  await failsWith(`{{ warn "${TARGET}" "" }}`, 'cannot be empty');
  await failsWith(`{{ kick "${TARGET}" "${'x'.repeat(401)}" }}`, 'longer than 400');
  await failsWith('{{ ban "someone" }}', 'Discord ID');
  await failsWith(`{{ range seq 0 4 }}{{ ban "${TARGET}" }}{{ end }}`, 'at most 3');

  assert.deepEqual(await effects(`{{ createRole "Fans" "#ff91c2" }}{{ createRole "Plain" }}{{ editRole "${ID(40)}" (dict "name" "VIP" "color" 255 "hoist" true "mentionable" false) }}{{ deleteRole "${ID(40)}" }}{{ addRoleTo "${TARGET}" "${ID(40)}" }}{{ removeRoleFrom "${TARGET}" "${ID(40)}" }}{{ setNickname "${TARGET}" "Pet" }}{{ setNickname "${TARGET}" nil }}{{ setNickname "${TARGET}" "  " }}`), [
    { type: 'createRole', name: 'Fans', color: 0xff91c2 },
    { type: 'createRole', name: 'Plain', color: null },
    { type: 'editRole', roleId: ID(40), changes: { name: 'VIP', color: 255, hoist: true, mentionable: false } },
    { type: 'deleteRole', roleId: ID(40) },
    { type: 'addRoleTo', userId: TARGET, roleId: ID(40) },
    { type: 'removeRoleFrom', userId: TARGET, roleId: ID(40) },
    { type: 'setNickname', userId: TARGET, nick: 'Pet' },
    { type: 'setNickname', userId: TARGET, nick: null },
    { type: 'setNickname', userId: TARGET, nick: null },
  ]);
  await failsWith('{{ createRole "x" "red" }}', 'color');
  await failsWith(`{{ editRole "${ID(40)}" (dict "permissions" 8) }}`, 'does not know "permissions"');
  await failsWith(`{{ setNickname "${TARGET}" "${'n'.repeat(33)}" }}`, 'longer than 32');

  assert.deepEqual(await effects(`{{ scheduleUniqueCC "Remind" "r-1" 60 (dict "a" 1) }}{{ scheduleUniqueCC "remind" "r-2" 5 }}{{ cancelScheduledCC "remind" "r-1" }}`), [
    { type: 'schedule', name: 'remind', id: 'r-1', seconds: 60, data: { a: 1 }, origin: 'command' },
    { type: 'schedule', name: 'remind', id: 'r-2', seconds: 5, data: null, origin: 'command' },
    { type: 'cancelSchedule', name: 'remind', id: 'r-1' },
  ]);
  await failsWith('{{ scheduleUniqueCC "remind" "r" 4 }}', '5 seconds to 7 days');
  await failsWith('{{ scheduleUniqueCC "remind" "r" 604801 }}', '5 seconds to 7 days');
  await failsWith('{{ scheduleUniqueCC "remind" "bad id" 60 }}', '1 to 50 letters');
  await failsWith('{{ scheduleUniqueCC "re mind" "r" 60 }}', 'name');
  await failsWith(`{{ scheduleUniqueCC "remind" "r" 60 "${'x'.repeat(2100)}" }}`, '2000');
  assert.equal(scriptingActions.permissionName('manage_messages'), 'ManageMessages');
  assert.equal(scriptingActions.permissionName('Ban Members'), 'BanMembers');
  assert.equal(scriptingActions.permissionName('nope'), null);

  // ── The web: only what is public, small, quick and few ──
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not an ip']) {
    assert.equal(http.isBlockedAddress(address), true, `${address} is blocked`);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(http.isBlockedAddress(address), false, `${address} is allowed`);
  assert.ok(http.checkUrl('https://example.com/a?b=1').url, 'a public https address');
  for (const [address, problem] of [['http://example.com', 'https'], ['ftp://example.com', 'https'], ['https://user:pass@example.com', 'credentials'], ['https://example.com:8443/', 'port'], ['https://localhost/', 'host'], ['https://127.0.0.1/', 'host'], ['https://[::1]/', 'host'], ['https://intranet/', 'host'], ['https://printer.local/', 'host'], ['https://db.internal/', 'host'], ['not a url', 'invalid'], ['', 'invalid'], [`https://example.com/${'a'.repeat(600)}`, 'invalid']]) {
    assert.equal(http.checkUrl(address).problem, problem, `${address} is refused as ${problem}`);
  }
  assert.deepEqual(http.cleanHeaders({ 'X-Key': 'abc', Accept: 'text/plain' }), { 'X-Key': 'abc', Accept: 'text/plain' });
  for (const bad of [{ Host: 'evil' }, { 'Content-Length': '1' }, { Cookie: 'a=b' }, { 'Proxy-Thing': '1' }, { 'bad name': '1' }, { 'X-A': 'line\nbreak' }, { 'X-A': 'x'.repeat(501) }, Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`X-${i}`, '1']))]) {
    assert.equal(http.cleanHeaders(bad), null, `${JSON.stringify(bad).slice(0, 40)} is refused`);
  }
  http.resetHttpCounts();
  const fakeTransport = (status, body, headers = {}, extra = {}) => async () => ({ status, headers, body: Buffer.from(body), truncated: false, ...extra });
  let answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'g1', transport: fakeTransport(200, '{"ok":true}', { 'content-type': 'application/json; charset=utf-8' }) });
  assert.deepEqual([answer.Status, answer.OK, answer.JSON, answer.Error], [200, true, { ok: true }, null]);
  answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'g1', transport: fakeTransport(302, '', { location: 'https://elsewhere.example/' }) });
  assert.deepEqual([answer.Status, answer.OK, answer.Location], [302, false, 'https://elsewhere.example/'], 'a redirect is told, never followed');
  answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'g1', transport: fakeTransport(200, 'plain text', { 'content-type': 'text/plain' }) });
  assert.deepEqual([answer.Body, answer.JSON], ['plain text', null]);
  answer = await http.httpRequest({ method: 'GET', url: 'http://example.com/x' }, { guildId: 'g1', transport: async () => assert.fail('a refused address is never asked') });
  assert.deepEqual([answer.Status, answer.Error], [0, 'blocked']);
  answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'g1', transport: async () => { throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); } });
  assert.equal(answer.Error, 'timeout');
  answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'g1', transport: async () => { throw Object.assign(new Error('x'), { code: 'EBLOCKED' }); } });
  assert.equal(answer.Error, 'blocked', 'a name that points to a private address');
  answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'g1', transport: async () => { throw new Error('boom'); } });
  assert.equal(answer.Error, 'failed');
  http.resetHttpCounts();
  let sent = 0;
  const counting = async () => { sent += 1; return { status: 200, headers: {}, body: Buffer.from('ok'), truncated: false }; };
  for (let i = 0; i < 31; i += 1) answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'busy', transport: counting });
  assert.deepEqual([sent, answer.Error], [30, 'rate'], 'a server gets 30 requests a minute');
  assert.equal((await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'other', transport: counting })).Status, 200, 'the count is of each server');
  answer = await http.httpRequest({ method: 'GET', url: 'https://example.com/x' }, { guildId: 'cut', transport: fakeTransport(200, '{"a":', {}, { truncated: true }) });
  assert.deepEqual([answer.Truncated, answer.JSON], [true, null], 'an answer that was cut is not parsed');

  // ── The world for the actions ────────────────────────────────────────────
  const permsOf = (list) => ({ has: (flag) => list === 'all' || list.includes(flag) });
  function world({ member = [], me = 'all', memberPosition = 8, mePosition = 10, tweak } = {}) {
    actions.resetModerationCounts();
    const events = [];
    const roles = new Collection();
    const addRole = (id, position, extra = {}) => roles.set(id, { id, position, managed: false, name: `r${position}`, async edit(values) { events.push(['editRole', id, values]); }, async delete(reason) { events.push(['deleteRole', id, reason]); }, ...extra });
    roles.set(GUILD, { id: GUILD, position: 0 });
    addRole(ID(40), 2); // below both
    addRole(ID(41), 9); // above the member, below Petto
    addRole(ID(42), 20); // above both
    addRole(ID(43), 2, { managed: true });
    const memberById = new Collection();
    const makeMember = (id, position, extra = {}) => {
      const roleCache = new Collection();
      const record = { id, user: { id, username: `u${id.slice(-2)}`, displayAvatarURL: () => 'a' }, roles: { highest: { position }, cache: roleCache, async add(role, reason) { events.push(['roleAdd', id, role.id, reason]); }, async remove(role, reason) { events.push(['roleRemove', id, role.id, reason]); } }, permissions: permsOf([]), kickable: true, bannable: true, moderatable: true, manageable: true, nickname: null,
        async kick(reason) { events.push(['kick', id, reason]); }, async timeout(ms, reason) { events.push(['timeout', id, ms, reason]); }, isCommunicationDisabled: () => Boolean(extra.muted), async setNickname(nick, reason) { events.push(['nick', id, nick, reason]); }, ...extra };
      memberById.set(id, record);
      return record;
    };
    const executor = makeMember(MEMBER, memberPosition, { permissions: permsOf(member) });
    const meMember = makeMember(BOT, mePosition, { permissions: permsOf(me) });
    makeMember(TARGET, 3);
    const channels = new Collection();
    const messages = new Map();
    const makeChannel = (id, extra = {}) => {
      const channel = {
        id, name: `c${id.slice(-3)}`, type: 0, isTextBased: () => true, isDMBased: () => false, isThread: () => false,
        permissionsFor: (who) => (who && who.id === BOT ? permsOf(me) : permsOf(member)),
        permissionOverwrites: { async edit(target, change, options) { events.push(['overwrite', id, target, change, options?.reason]); } },
        messages: { async fetch(id2) { return messages.get(id2) ?? Promise.reject(new Error('Unknown Message')); } },
        async bulkDelete(count, filterOld) { events.push(['bulkDelete', id, count, filterOld]); },
        async edit(values) { events.push(['editChannel', id, values]); }, async delete(reason) { events.push(['deleteChannel', id, reason]); },
        threads: { async create(values) { events.push(['thread', id, values.name, values.startMessage?.id ?? null]); } },
        ...extra,
      };
      channels.set(id, channel);
      return channel;
    };
    const here = makeChannel(ID(500));
    makeChannel(ID(501));
    makeChannel(ID(510), { type: 4, isTextBased: () => false });
    makeChannel(ID(511), { type: 15 });
    makeChannel(ID(520), { type: 11, isThread: () => true, async setLocked(value, reason) { events.push(['lock', ID(520), value, reason]); }, async setArchived(value, reason) { events.push(['archive', ID(520), value, reason]); } });
    const put = (id, extra = {}) => { const message = { id, author: { id: BOT }, async edit(payload) { events.push(['messageEdit', id, payload]); }, async delete() { events.push(['messageDelete', id]); }, async pin() { events.push(['pin', id]); }, async unpin() { events.push(['unpin', id]); }, async react(emoji) { events.push(['react', id, emoji]); }, ...extra }; messages.set(id, message); return message; };
    put(ID(700)); put(ID(701), { author: { id: TARGET } });
    const users = new Collection([[TARGET, { id: TARGET, username: 'target' }], [ID(77), { id: ID(77), username: 'outsider' }], [MEMBER, { id: MEMBER, username: 'me' }], [OWNER, { id: OWNER, username: 'owner' }]]);
    const guild = {
      id: GUILD, ownerId: OWNER, rulesChannelId: ID(530), publicUpdatesChannelId: null, roles: { cache: roles, async create(values) { events.push(['createRole', values]); } },
      channels: { cache: channels, async fetch(id) { return channels.get(id) ?? null; }, async create(values) { events.push(['createChannel', values]); } },
      members: { me: meMember, cache: memberById, async fetch(id) { const found = typeof id === 'string' ? memberById.get(id) : memberById.get(id?.user); return found ?? Promise.reject(new Error('Unknown Member')); },
        async ban(id, options) { events.push(['ban', id, options]); }, async unban(id, reason) { if (tweak?.notBanned) throw Object.assign(new Error('x'), { code: 10026 }); events.push(['unban', id, reason]); } },
      client: { user: { id: BOT }, users: { cache: users, async fetch(id) { return users.get(id) ?? Promise.reject(new Error('Unknown User')); } } },
    };
    const source = { id: '0', guild, channel: here, member: executor, author: executor.user };
    const stored = [];
    const store = { async set(entry) { stored.push(entry); }, async cancel(guildId, name, id) { const at = stored.findIndex((entry) => entry.name === name && entry.id === id); if (at >= 0) { stored.splice(at, 1); return true; } return false; }, async count() { return stored.length; } };
    return { guild, source, events, messages, channels, roles, memberById, stored, store, put, makeChannel };
  }
  const ctx = (w, extra = {}) => ({ lang: 'en', commandName: 'test', toPayload: (action) => ({ content: action.content }), schedule: w.store, commands: { getCommand: async (guildId, name) => (name === 'remind' ? { name, code: 'x' } : null) }, ...extra });
  const act = (w, effect, extra) => actions.applyAction(w.source, effect, ctx(w, extra));
  const ofType = (type, rest = {}) => ({ type, ...rest });
  const ALL = 'all';

  // ── Messages ──
  let w = world({ member: ALL });
  assert.equal(await act(w, ofType('editMessage', { channelId: ID(500), messageId: ID(700), content: 'changed' })), null);
  assert.deepEqual(w.events.at(-1), ['messageEdit', ID(700), { content: 'changed' }]);
  assert.match(await act(w, ofType('editMessage', { channelId: ID(500), messageId: ID(701), content: 'x' })), /editMessage: Petto can only change its own messages/);
  assert.match(await act(w, ofType('editMessage', { channelId: ID(500), messageId: ID(799), content: 'x' })), /message was not found/);
  assert.match(await act(w, ofType('editMessage', { channelId: ID(999), messageId: ID(700), content: 'x' })), /channel was not found/);
  assert.equal(await act(w, ofType('deleteMessage', { channelId: ID(500), messageId: ID(701), delay: 0 })), null);
  assert.deepEqual(w.events.at(-1), ['messageDelete', ID(701)]);
  assert.equal(await act(w, ofType('pinMessage', { channelId: ID(500), messageId: ID(700) })), null);
  assert.equal(await act(w, ofType('unpinMessage', { channelId: ID(500), messageId: ID(700) })), null);
  assert.equal(await act(w, ofType('purgeMessages', { channelId: ID(500), count: 30 })), null);
  assert.deepEqual(w.events.at(-1), ['bulkDelete', ID(500), 30, true], 'only messages younger than two weeks');
  assert.equal(await act(w, ofType('reactToMessage', { channelId: ID(500), messageId: ID(700), emoji: '🔥' })), null);
  assert.deepEqual(w.events.at(-1), ['react', ID(700), '🔥']);
  w = world({ member: [] });
  for (const effect of [ofType('editMessage', { channelId: ID(500), messageId: ID(700), content: 'x' }), ofType('deleteMessage', { channelId: ID(500), messageId: ID(700), delay: 0 }), ofType('pinMessage', { channelId: ID(500), messageId: ID(700) }), ofType('purgeMessages', { channelId: ID(500), count: 3 }), ofType('reactToMessage', { channelId: ID(500), messageId: ID(700), emoji: 'x' })]) {
    assert.match(await act(w, effect), /you need the (ManageMessages|AddReactions) permission/, `${effect.type} needs the permission of the member`);
  }
  assert.deepEqual(w.events, [], 'nothing was done');
  w = world({ member: ALL, me: [] });
  assert.match(await act(w, ofType('deleteMessage', { channelId: ID(500), messageId: ID(700), delay: 0 })), /Petto needs the ManageMessages permission/, 'and Petto needs it too');
  w = world({ member: ALL });
  const timed = await act(w, ofType('deleteMessage', { channelId: ID(500), messageId: ID(700), delay: 1 }));
  assert.equal(timed, null);
  assert.deepEqual(w.events, [], 'a delayed delete waits');

  // ── Channels ──
  w = world({ member: ALL });
  assert.equal(await act(w, ofType('createChannel', { name: 'chat', kind: 'text', parentId: null })), null);
  assert.deepEqual([w.events.at(-1)[1].name, w.events.at(-1)[1].type], ['chat', 0]);
  assert.equal(await act(w, ofType('createChannel', { name: 'vc', kind: 'voice', parentId: ID(510) })), null);
  assert.equal(w.events.at(-1)[1].parent, ID(510));
  assert.match(await act(w, ofType('createChannel', { name: 'vc', kind: 'voice', parentId: ID(501) })), /not a category/);
  assert.equal(await act(w, ofType('editChannel', { channelId: ID(501), changes: { name: 'new', topic: 't', slowmode: 7, nsfw: true, parentId: ID(510) } })), null);
  assert.deepEqual(w.events.at(-1)[2], { name: 'new', topic: 't', rateLimitPerUser: 7, nsfw: true, parent: ID(510), reason: 'Custom command' });
  assert.equal(await act(w, ofType('editChannel', { channelId: ID(520), changes: { name: 'th', topic: 'ignored', nsfw: true, slowmode: 3 } })), null);
  assert.deepEqual(w.events.at(-1)[2], { name: 'th', rateLimitPerUser: 3, reason: 'Custom command' }, 'a thread only changes its name and its slowmode');
  assert.equal(await act(w, ofType('deleteChannel', { channelId: ID(501) })), null);
  w.makeChannel(ID(530));
  assert.match(await act(w, ofType('deleteChannel', { channelId: ID(530) })), /rules and updates channels/);
  assert.equal(await act(w, ofType('lockChannel', { channelId: ID(500), reason: 'quiet' })), null);
  assert.deepEqual(w.events.at(-1), ['overwrite', ID(500), GUILD, { SendMessages: false }, 'quiet']);
  assert.equal(await act(w, ofType('unlockChannel', { channelId: ID(500), reason: null })), null);
  assert.deepEqual(w.events.at(-1).slice(0, 4), ['overwrite', ID(500), GUILD, { SendMessages: null }]);
  assert.match(await act(w, ofType('lockChannel', { channelId: ID(520), reason: null })), /channel was not found/, 'a thread is locked with lockThread');
  assert.equal(await act(w, ofType('createThread', { channelId: ID(500), name: 'talk', messageId: null })), null);
  assert.deepEqual(w.events.at(-1), ['thread', ID(500), 'talk', null]);
  assert.equal(await act(w, ofType('createThread', { channelId: ID(500), name: 'about', messageId: ID(700) })), null);
  assert.deepEqual(w.events.at(-1), ['thread', ID(500), 'about', ID(700)]);
  assert.match(await act(w, ofType('createThread', { channelId: ID(511), name: 'x', messageId: null })), /forum needs a post/);
  assert.equal(await act(w, ofType('lockThread', { channelId: ID(520) })), null);
  assert.deepEqual(w.events.at(-1), ['lock', ID(520), true, 'Custom command']);
  assert.equal(await act(w, ofType('archiveThread', { channelId: ID(520) })), null);
  assert.match(await act(w, ofType('lockThread', { channelId: ID(500) })), /not a thread/);
  w = world({ member: [P.ManageMessages] });
  for (const effect of [ofType('createChannel', { name: 'x', kind: 'text', parentId: null }), ofType('editChannel', { channelId: ID(501), changes: { name: 'x' } }), ofType('deleteChannel', { channelId: ID(501) }), ofType('lockChannel', { channelId: ID(500), reason: null }), ofType('createThread', { channelId: ID(500), name: 'x', messageId: null }), ofType('lockThread', { channelId: ID(520) })]) {
    assert.match(await act(w, effect), /you need the/, `${effect.type} needs the permission of the member`);
  }
  assert.deepEqual(w.events, []);

  // ── Roles and nicknames ──
  w = world({ member: ALL });
  assert.equal(await act(w, ofType('createRole', { name: 'Fans', color: 255 })), null);
  assert.deepEqual(w.events.at(-1)[1], { name: 'Fans', color: 255, permissions: [], reason: 'Custom command' }, 'a new role has no permissions');
  assert.equal(await act(w, ofType('editRole', { roleId: ID(40), changes: { name: 'VIP', hoist: true } })), null);
  assert.deepEqual(w.events.at(-1), ['editRole', ID(40), { name: 'VIP', hoist: true, reason: 'Custom command' }]);
  assert.equal(await act(w, ofType('deleteRole', { roleId: ID(40) })), null);
  assert.equal(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(40) })), null);
  assert.deepEqual(w.events.at(-1), ['roleAdd', TARGET, ID(40), 'Custom command']);
  assert.equal(await act(w, ofType('removeRoleFrom', { userId: TARGET, roleId: ID(40) })), null);
  assert.match(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(41) })), /not below your highest role/, 'a role above the member');
  assert.match(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(42) })), /cannot be used/, 'a role above Petto');
  assert.match(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(43) })), /cannot be used/, 'a role of a bot');
  assert.match(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: GUILD })), /cannot be used/, '@everyone');
  assert.match(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(79) })), /role was not found/);
  assert.match(await act(w, ofType('addRoleTo', { userId: ID(88), roleId: ID(40) })), /not in this server/);
  assert.match(await act(w, ofType('deleteRole', { roleId: ID(42) })), /cannot be used/);
  assert.equal(await act(w, ofType('setNickname', { userId: TARGET, nick: 'Pet' })), null);
  assert.deepEqual(w.events.at(-1), ['nick', TARGET, 'Pet', 'Custom command']);
  assert.equal(await act(w, ofType('setNickname', { userId: TARGET, nick: null })), null);
  assert.match(await act(w, ofType('setNickname', { userId: OWNER, nick: 'x' })), /not in this server|owner/);
  w.memberById.set(OWNER, { id: OWNER, roles: { highest: { position: 99 } }, setNickname: async () => {} });
  assert.match(await act(w, ofType('setNickname', { userId: OWNER, nick: 'x' })), /owner of the server/);
  w.memberById.get(TARGET).roles.highest.position = 30;
  assert.match(await act(w, ofType('setNickname', { userId: TARGET, nick: 'x' })), /above you or above Petto/, 'a member above the one who used the command');
  assert.equal(await act(w, ofType('setNickname', { userId: MEMBER, nick: 'me' })), null, 'a member changes their own nickname');
  w = world({ member: [P.ChangeNickname] });
  assert.equal(await act(w, ofType('setNickname', { userId: MEMBER, nick: 'me' })), null, 'with only Change Nickname they change their own');
  assert.match(await act(w, ofType('setNickname', { userId: TARGET, nick: 'x' })), /you need the ManageNicknames/);
  w = world({ member: [] });
  for (const effect of [ofType('createRole', { name: 'x', color: null }), ofType('editRole', { roleId: ID(40), changes: { name: 'x' } }), ofType('deleteRole', { roleId: ID(40) }), ofType('addRoleTo', { userId: TARGET, roleId: ID(40) })]) {
    assert.match(await act(w, effect), /you need the ManageRoles permission/);
  }
  assert.deepEqual(w.events, []);
  w = world({ member: ALL, memberPosition: 50 });
  assert.equal(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(41) })), null, 'a member that is high enough');
  assert.match(await act(w, ofType('addRoleTo', { userId: TARGET, roleId: ID(42) })), /cannot be used/, 'but never above Petto');

  // ── Moderation: the same checks and cases as the commands of Petto ──
  actions.resetModerationCounts();
  w = world({ member: [P.BanMembers, P.KickMembers, P.ModerateMembers], me: 'all' });
  cases.length = 0; dms.length = 0; logged.length = 0;
  assert.equal(await act(w, ofType('ban', { userId: TARGET, days: 2, reason: 'spam' })), null);
  assert.deepEqual(w.events.at(-1), ['ban', TARGET, { reason: 'spam', deleteMessageSeconds: 172800 }]);
  assert.deepEqual([cases[0].type, cases[0].userId, cases[0].moderatorId, cases[0].reason], ['ban', TARGET, MEMBER, 'spam'], 'a case, with the member as the moderator');
  assert.equal(dms[0].to, TARGET, 'the member is told by direct message first');
  assert.equal(logged.length, 1, 'and it is in the log of cases');
  assert.equal(await act(w, ofType('ban', { userId: ID(77), days: 0, reason: null })), null, 'a user that is not in the server can be banned');
  assert.equal(w.events.at(-1)[2].deleteMessageSeconds, undefined);
  assert.equal(await act(w, ofType('tempban', { userId: TARGET, seconds: 3600, reason: null }), { now: () => 1_700_000_000_000 }), null);
  assert.deepEqual([cases.at(-1).type, cases.at(-1).expiresAt], ['tempban', new Date(1_700_000_000_000 + 3_600_000).toISOString()]);
  // A kick needs a member of the server; and a user that does not exist is told, not guessed.
  assert.match(await act(w, ofType('kick', { userId: ID(77), reason: null })), /not in this server/);
  assert.match(await act(w, ofType('kick', { userId: ID(78), reason: null })), /user was not found/);
  assert.equal(await act(w, ofType('kick', { userId: TARGET, reason: 'bye' })), null);
  assert.deepEqual(w.events.at(-1), ['kick', TARGET, 'bye']);
  assert.equal(await act(w, ofType('mute', { userId: TARGET, seconds: 600, reason: 'quiet' }), { now: () => 1_700_000_000_000 }), null);
  assert.deepEqual(w.events.at(-1), ['timeout', TARGET, 600_000, 'quiet']);
  assert.deepEqual([cases.at(-1).type, cases.at(-1).expiresAt], ['tempmute', new Date(1_700_000_000_000 + 600_000).toISOString()]);
  assert.match(await act(w, ofType('unmute', { userId: TARGET, reason: null })), /not muted/);
  w.memberById.get(TARGET).isCommunicationDisabled = () => true;
  assert.equal(await act(w, ofType('unmute', { userId: TARGET, reason: null })), null);
  assert.deepEqual(w.events.at(-1), ['timeout', TARGET, null, undefined]);
  assert.equal(await act(w, ofType('warn', { userId: TARGET, reason: 'rule 2' })), null);
  assert.deepEqual([warnings.at(-1).userId, warnings.at(-1).moderatorId, warnings.at(-1).reason], [TARGET, MEMBER, 'rule 2']);
  assert.equal(await act(w, ofType('unban', { userId: TARGET, reason: 'sorry' })), null);
  assert.equal(cases.at(-1).type, 'unban');
  assert.match(await act(w, ofType('ban', { userId: MEMBER, days: 0, reason: null })), /ban: You cannot target yourself/, 'nobody bans themselves');
  assert.match(await act(w, ofType('kick', { userId: OWNER, reason: null })), /not in this server/, 'the owner is not a member here');
  hardBans.add(TARGET);
  assert.match(await act(w, ofType('unban', { userId: TARGET, reason: null })), /hard ban/, 'a hard ban is lifted only by who can');
  hardBans.clear();
  w = world({ member: [P.BanMembers], tweak: { notBanned: true } });
  assert.match(await act(w, ofType('unban', { userId: TARGET, reason: null })), /not banned/);
  // A member above the one who uses the command, or one that Petto cannot reach.
  w = world({ member: ALL, me: 'all' });
  w.memberById.get(TARGET).roles.highest.position = 30;
  for (const type of ['kick', 'mute', 'warn']) assert.match(await act(w, ofType(type, { userId: TARGET, seconds: 60, reason: 'x' })), new RegExp(`${type}: `), `${type}: a member above the moderator is refused`);
  assert.equal(w.events.length, 0);
  w = world({ member: ALL });
  w.memberById.get(TARGET).bannable = false;
  assert.match(await act(w, ofType('ban', { userId: TARGET, days: 0, reason: null })), /ban: /, 'Petto cannot ban a member that is above it');
  assert.equal(w.events.length, 0);
  // Without the permission of the member: nothing.
  w = world({ member: [P.KickMembers] });
  for (const type of ['ban', 'unban', 'mute', 'unmute', 'warn']) assert.match(await act(w, ofType(type, { userId: TARGET, seconds: 60, days: 0, reason: 'x' })), /you need the/i, `${type} needs its permission`);
  w = world({ member: [P.BanMembers], me: [] });
  assert.match(await act(w, ofType('ban', { userId: TARGET, days: 0, reason: null })), /I need|Petto needs|ban: /i);
  assert.deepEqual(w.events, []);
  // Discord refuses: it is told, and no case is made.
  w = world({ member: 'all' });
  w.guild.members.ban = async () => { throw new Error('Missing Permissions'); };
  const casesBefore = cases.length;
  assert.match(await act(w, ofType('ban', { userId: TARGET, days: 0, reason: null })), /ban: Discord did not allow it \(Missing Permissions\)/);
  assert.equal(cases.length, casesBefore, 'no case for something that did not happen');
  // A command cannot run through a server: 15 a minute.
  actions.resetModerationCounts();
  w = world({ member: 'all' });
  let last = null;
  for (let i = 0; i < 16; i += 1) last = await act(w, ofType('warn', { userId: TARGET, reason: 'x' }));
  assert.match(last, /too many moderation actions/);

  // ── Scheduling ──
  w = world({ member: [] });
  assert.equal(await act(w, ofType('schedule', { name: 'remind', id: 'a', seconds: 60, data: { x: 1 } }), { now: () => 1_000_000 }), null, 'nobody needs a permission to schedule: what runs is judged when it runs');
  assert.deepEqual(w.stored, [{ guildId: GUILD, name: 'remind', id: 'a', runAt: 1_060_000, userId: MEMBER, channelId: ID(500), data: { x: 1 }, origin: 'command' }]);
  await act(w, ofType('schedule', { name: 'remind', id: 'a', seconds: 120, data: null }), { now: () => 1_000_000 });
  assert.equal(w.stored.length, 1, 'the same id replaces the first');
  assert.equal(w.stored[0].runAt, 1_120_000);
  await act(w, ofType('schedule', { name: 'remind', id: 'b', seconds: 60, data: null }));
  assert.equal(w.stored.length, 2);
  assert.match(await act(w, ofType('schedule', { name: 'ghost', id: 'a', seconds: 60, data: null })), /no command called ghost/);
  assert.equal(await act(w, ofType('cancelSchedule', { name: 'remind', id: 'a' })), null);
  assert.deepEqual(w.stored.map((entry) => entry.id), ['b']);
  for (let i = 0; i < 30; i += 1) await act(w, ofType('schedule', { name: 'remind', id: `n${i}`, seconds: 60, data: null }));
  assert.equal(w.stored.length, 25, 'a server has 25 at most');
  assert.match(await act(w, ofType('schedule', { name: 'remind', id: 'extra', seconds: 60, data: null })), /already has 25 commands scheduled/);
  assert.equal(await act(w, ofType('schedule', { name: 'remind', id: 'n1', seconds: 90, data: null })), null, 'replacing one is allowed when the server is full');

  // ── What the code can read ──
  const mappers = { userData: (user) => ({ ID: user.id }), memberData: (member) => ({ ID: member.id, Member: true }), roleData: (role) => ({ ID: role.id }), channelData: (channel) => ({ ID: channel.id }), guildData: (guild) => ({ Name: guild.name ?? 'HQ' }) };
  w = world({ member: ALL });
  const textMessage = w.put(ID(710), { content: 'hello', url: 'https://discord.com/x', createdTimestamp: 1_700_000_000_000, editedTimestamp: null, pinned: true, author: { id: TARGET }, embeds: [{ title: 'T' }], attachments: new Collection([['a', { url: 'u', name: 'n', size: 1, contentType: 'image/png' }]]), reactions: { cache: new Collection([['r', { emoji: { toString: () => '🔥' }, count: 3 }]]) }, reference: { messageId: ID(700) } });
  void textMessage;
  const reads = actions.extraLookups(w.guild, w.source.member, mappers, async (spec, options) => ({ spec, options }));
  const read = await reads.message(ID(500), ID(710));
  assert.deepEqual([read.ID, read.Content, read.Pinned, read.ReplyToID, read.Embeds[0].Title, read.Attachments[0].Name, read.Reactions[0].Count, read.CreatedAt], [ID(710), 'hello', true, ID(700), 'T', 'n', 3, 1_700_000_000]);
  assert.equal(await reads.message(ID(500), ID(799)), null, 'a message that is not there');
  assert.equal(await reads.message(ID(510), ID(710)), null, 'a category has no messages');
  const hidden = actions.extraLookups(world({ member: [] }).guild, world({ member: [] }).source.member, mappers, async () => null);
  assert.equal(await hidden.message(ID(500), ID(710)), null, 'a member who cannot read the channel cannot read it through the command');
  assert.deepEqual(await hidden.channels(null), [], 'nor list the channels they cannot see');
  assert.deepEqual((await reads.channels('text')).map((channel) => channel.ID).sort(), [ID(500), ID(501)], 'channels by kind');
  assert.equal((await reads.channels(null)).length, 5);
  assert.deepEqual(await reads.guild(), { Name: 'HQ' });
  assert.deepEqual(await reads.user(TARGET), { ID: TARGET, Member: true, InServer: true });
  assert.deepEqual(await reads.user(ID(88)), null);
  assert.equal(await reads.permission(TARGET, 'BanMembers', null), false);
  assert.equal(await reads.permission(MEMBER, 'BanMembers', null), true);
  assert.equal(await reads.permission(ID(88), 'BanMembers', null), null);
  assert.equal(await reads.permission(MEMBER, 'Nope', null), null);
  assert.equal(await reads.permission(MEMBER, 'BanMembers', ID(500)), true);
  assert.deepEqual((await reads.roles()).map((role) => role.ID), [ID(42), ID(41), ID(40), ID(43)].sort((a, b) => w.roles.get(b).position - w.roles.get(a).position), 'the roles, the highest first, without @everyone');
  w.guild.bans = { fetch: async ({ user }) => (user === TARGET ? {} : Promise.reject(Object.assign(new Error('x'), { code: 10026 }))) };
  assert.equal(await reads.banned(TARGET), true);
  assert.equal(await reads.banned(ID(88)), false);
  assert.equal(await actions.extraLookups(world({ member: ALL, me: [] }).guild, w.source.member, mappers, async () => null).banned(TARGET), null, 'Petto cannot look at the bans without the permission');
  assert.deepEqual((await reads.http({ method: 'GET', url: 'https://example.com' })).options, { guildId: GUILD });

  assert.deepEqual(log.error, [], 'nothing crashed');
  console.log(`Checked the ${NEW_FUNCTIONS.length} new functions of Petto Code: values, reading the server and the web, and every action with a member who may and one who may not.`);
})().catch((error) => { console.error(error); process.exit(1); });
