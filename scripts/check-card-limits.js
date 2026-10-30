// Checks that a long text can never turn a finished command into an error: the lists of the mass actions are capped, a text display and a
// whole card stay inside what Discord accepts, and a reply that Discord refuses for its size is retried once as a short plain text.
// Everything runs against fakes: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// ---------------------------------------------------------------------------------------------------------------------
// The first 20 cases and "and N more" (the helper of the mass actions), in the three languages.
// ---------------------------------------------------------------------------------------------------------------------
const { caseNumberList, mentionList, listWithMore, capList } = require('../src/utils/listCap');

function checkLists() {
  const numbers = Array.from({ length: 5000 }, (_, i) => 100000 + i);
  assert.equal(caseNumberList('en', numbers), `${numbers.slice(0, 20).join(', #')} and 4,980 more`);
  assert.equal(caseNumberList('es', numbers), `${numbers.slice(0, 20).join(', #')} y 4,980 más`);
  assert.match(caseNumberList('pt-BR', numbers), /e mais 4\.980$/);
  assert.equal(caseNumberList('en', numbers.slice(0, 21)), `${numbers.slice(0, 20).join(', #')} and 1 more`);
  assert.equal(caseNumberList('en', numbers.slice(0, 20)), numbers.slice(0, 20).join(', #'), 'exactly 20 are all shown');
  assert.equal(caseNumberList('en', [7]), '7');
  assert.equal(caseNumberList('en', []), '');
  assert.equal(mentionList('en', Array.from({ length: 30 }, (_, i) => `<@${i}>`)).split(' ').length, 25 + 3, '25 mentions and "and 5 more"');
  assert.equal(listWithMore('en', ['a', 'b', 'c'], { limit: 2, format: (x) => `\`${x}\`` }), '`a`, `b` and 1 more');
  assert.deepEqual(capList(new Set([1, 2, 3]), 2), { shown: [1, 2], hidden: 1 });
}

// ---------------------------------------------------------------------------------------------------------------------
// The real `!massunban` with 5000 bans: the result is a card, and the log is sent before it, whatever happens to the card.
// ---------------------------------------------------------------------------------------------------------------------
async function checkUnbanAll() {
  const warnings = [];
  stub('src/utils/logger.js', { info() {}, debug() {}, error() {}, warn: (...args) => warnings.push(args.join(' ')) });
  stub('src/db/hardBans.js', { addHardBan: async () => {}, getHardBan: async () => null, removeHardBan: async () => {}, canLiftHardBan: async () => true, listHardBanIds: async () => new Set() });
  let caseCounter = 100000;
  stub('src/db/modActions.js', { createCase: async () => ({ case_number: caseCounter++ }), getActiveSanction: async () => null, deactivateCase: async () => {} });
  stub('src/utils/caseLog.js', { logSanction: async () => {} });
  const events = [];
  let failLog = false;
  stub('src/logging/engine.js', { sendLog: async (client, guildId, category, payload) => { events.push(`log:${category}`); if (failLog) throw new Error('log failed'); return payload; } });
  const ban = require('../src/commands/moderation/ban');

  async function run({ failResult = false } = {}) {
    events.length = 0;
    caseCounter = 100000;
    const replies = [];
    const guilds = new Map([['1', {}]]);
    const bans = new Map(Array.from({ length: 5000 }, (_, i) => [`u${i}`, { user: { id: `u${i}`, username: `u${i}` } }]));
    const guild = { id: '1', name: 'Test', iconURL: () => null, bans: { fetch: async () => bans }, members: { unban: async () => {} } };
    const click = { customId: 'unbanall_confirm', update: async () => {} };
    const interaction = {
      pettoLang: 'en', guild, client: { guilds: { cache: guilds } }, user: { id: 'owner', username: 'owner', toString: () => '<@owner>' },
      member: { permissions: { has: () => true } },
      options: { getString: () => null, getSubcommand: () => 'remove-all' },
      deferReply: async () => {},
      reply: async () => {},
      editReply: async (payload) => {
        const json = JSON.stringify(payload);
        replies.push(json);
        if (failResult && replies.length >= 2) { events.push('result:failed'); throw Object.assign(new Error('Invalid Form Body'), { code: 50035 }); }
        if (replies.length >= 2) events.push('result:shown');
        return { awaitMessageComponent: async () => click };
      },
    };
    await ban.execute(interaction);
    return replies;
  }

  let replies = await run();
  const result = JSON.parse(replies.at(-1));
  const text = result.components.flatMap((c) => c.components ?? []).map((c) => c.content).filter(Boolean).join('\n');
  assert.ok(text.length <= 4000 && text.length > 0, `the result card has ${text.length} characters`);
  assert.ok(text.includes('Unbanned **5000** user(s)'), `the count is complete: ${text.slice(0, 200)}`);
  assert.ok(text.includes('#100000, #100001'), 'the first cases are listed');
  assert.ok(text.includes('#100019 and 4,980 more'), 'the first 20 cases and the rest counted');
  assert.ok(!text.includes('#100020'), 'the 21st case is not listed');
  assert.deepEqual(events, ['log:sanctions', 'result:shown'], 'the log goes before the result');

  // The result cannot be shown (Discord refuses it): the log was already sent, and the command does not fail.
  replies = await run({ failResult: true });
  assert.deepEqual(events, ['log:sanctions', 'result:failed'], 'the log is not lost when the result fails');
  assert.ok(warnings.some((line) => line.includes('could not show the result')));

  // The log itself fails: the result is still shown.
  failLog = true;
  await run();
  assert.deepEqual(events, ['log:sanctions', 'result:shown'], 'a failed log does not hide the result');
  assert.ok(warnings.some((line) => line.includes('could not log the result')));
  failLog = false;
}

(async () => {
  checkLists();
  await checkUnbanAll();
  console.log('check-card-limits: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
