// Checks that a long text can never turn a finished command into an error: the lists of the mass actions are capped, a text display and a
// whole card stay inside what Discord accepts, and a reply that Discord refuses for its size is retried once as a short plain text.
// Everything runs against fakes: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

const errors = []; // what the stubbed logger was told as an error
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
  stub('src/utils/logger.js', { info() {}, debug() {}, error: (...args) => errors.push(args.join(' ')), warn: (...args) => warnings.push(args.join(' ')) });
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

// ---------------------------------------------------------------------------------------------------------------------
// addBlocks: 1 to 4000 characters in a display, 4000 in a whole message, cut in a clean place, never a throw.
// ---------------------------------------------------------------------------------------------------------------------
const { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } = require('discord.js');
const cardBlocks = require('../src/utils/cardBlocks');
const { addBlocks, splitBlocks, clipText, textLength, installTextDisplayGuard } = cardBlocks;

/** What `addBlocks` did before the limits: the same layout, with no cutting at all. */
function oldAddBlocks(container, text) {
  splitBlocks(text).forEach((block, index) => {
    if (index > 0) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
  });
  return container;
}

/** The text of every display of a built card, in order. */
function displays(container) {
  return container.toJSON().components.filter((part) => part.type === 10).map((part) => part.content);
}

/** Nothing left half written at the end of a cut text: a mention, an emoji, a timestamp, a link, an open fence. */
function assertCleanEnd(text, label) {
  assert.ok(!/<[^<>\s]*$/.test(text), `${label}: a half mention or emoji at the end: ${JSON.stringify(text.slice(-30))}`);
  assert.ok(!/\]\([^)\s]*$/.test(text), `${label}: a half link at the end`);
  assert.ok(!/(^|\n)`{1,2}$/.test(text), `${label}: a half fence at the end`);
  assert.equal(text.split('\n').filter((line) => /^```/.test(line)).length % 2, 0, `${label}: a code fence was left open`);
}

function checkAddBlocks() {
  const MENTION = '<@123456789012345678>';

  // 10000 characters of one text: one display, exactly at the limit at most, with the mark of the cut.
  let card = addBlocks(new ContainerBuilder(), 'word '.repeat(2000));
  let shown = displays(card);
  assert.equal(shown.length, 1);
  assert.ok(shown[0].length <= 4000 && shown[0].length > 3900 && shown[0].endsWith('…'), `10000 characters became ${shown[0].length}`);
  assert.ok(shown[0].endsWith('word…'), 'it is cut at a word');
  card = addBlocks(new ContainerBuilder(), 'x'.repeat(10000));
  assert.ok(displays(card)[0].length === 4000, 'a text with no place to cut is cut at the limit');
  card = addBlocks(new ContainerBuilder(), Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n'));
  shown = displays(card);
  assert.ok(/line \d+…$/.test(shown[0]) && !/\n…$/.test(shown[0]) && shown[0].length <= 4000, 'it is cut at the end of a line');

  // An open code fence is closed, and the text stays inside the limit.
  const code = `Here is the code:\n\`\`\`js\n${Array.from({ length: 600 }, (_, i) => `const value${i} = ${i};`).join('\n')}\n\`\`\`\nAnd after.`;
  shown = displays(addBlocks(new ContainerBuilder(), code));
  assert.equal(shown.length, 1);
  assert.ok(shown[0].length <= 4000);
  assertCleanEnd(shown[0], 'code fence');
  assert.ok(shown[0].endsWith('\n```\n…'), 'the fence is closed and then the mark of the cut');
  // A fence that was already open and never closed by the text itself is closed too.
  assertCleanEnd(clipText(`\`\`\`\n${'a\n'.repeat(3000)}`, 4000), 'open fence');
  // A fence that closes before the cut is left alone.
  assert.ok(clipText(`\`\`\`\ncode\n\`\`\`\n${'b '.repeat(3000)}`, 4000).startsWith('```\ncode\n```\n'));

  // Mentions, custom emojis, timestamps and links are never cut in half, wherever the cut falls.
  const tokens = [MENTION, '<@&123456789012345678>', '<#123456789012345678>', '<:petto_ok:123456789012345678>', '<a:dance:123456789012345678>', '<t:1700000000:R>', '[a link](https://example.com/some/long/path)', '[text](<https://example.com>)'];
  for (const token of tokens) {
    // Every position of the cut around the token, with and without a place to cut near it.
    for (let offset = 0; offset <= token.length + 1; offset += 1) {
      for (const filler of ['x', 'x ']) {
        const prefix = filler.repeat(Math.ceil((3999 - offset) / filler.length)).slice(0, 3999 - offset);
        const clipped = clipText(`${prefix}${token}${'tail '.repeat(100)}`, 4000);
        assert.ok(clipped.length <= 4000 && clipped.endsWith('…'));
        assertCleanEnd(clipped.slice(0, -1), `${token} at ${offset}`);
        assert.ok(!clipped.includes('<@12') || clipped.includes(MENTION) || !token.startsWith('<@1'), 'the whole mention or none');
      }
    }
  }
  // A text that fits is returned as it is, even with a mention at the very end.
  assert.equal(clipText(`${'x'.repeat(3979)}${MENTION}`, 4000), `${'x'.repeat(3979)}${MENTION}`);

  // An empty text: one display with a zero width space, never an error.
  for (const empty of ['', '   ', '\n\n', null, undefined]) {
    shown = displays(addBlocks(new ContainerBuilder(), empty));
    assert.deepEqual(shown, ['​'], `${JSON.stringify(empty)} needs a display with something in it`);
  }
  // Blocks with nothing in them are skipped, and the dividers follow the blocks that stay.
  const stayed = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('Already here'));
  assert.deepEqual(displays(addBlocks(stayed, '')), ['Already here'], 'a card that has text gets no empty display');

  // Many blocks that add up to more than 4000: the last ones go, a short `…` says so, the card builds.
  const heading = (i, size) => `### Part ${i}\n${'y'.repeat(size)}`;
  card = addBlocks(new ContainerBuilder(), Array.from({ length: 12 }, (_, i) => heading(i, 900)).join('\n'));
  shown = displays(card);
  assert.ok(textLength(card) <= 4000, `${textLength(card)} characters in all`);
  assert.ok(shown.length >= 4 && shown.length < 12 && shown.every((part) => part.length >= 1 && part.length <= 4000));
  assert.ok(shown[0].startsWith('### Part 0') && shown[1].startsWith('### Part 1'), 'the first blocks stay whole');
  assert.ok(shown.at(-1).endsWith('…'), 'the cut is marked');
  // No room left for even a piece of the next block: a block with just the mark.
  card = addBlocks(new ContainerBuilder(), Array.from({ length: 6 }, (_, i) => `### P${i}\n${'z'.repeat(988)}`).join('\n'));
  shown = displays(card);
  assert.equal(shown.at(-1), '…');
  assert.ok(shown.slice(0, -1).every((part) => part.length === 995), 'the blocks that fit are whole');
  assert.ok(textLength(card) <= 4000);
  // The separators are the same as before: a divider between two displays, none after the last.
  const parts = card.toJSON().components;
  assert.deepEqual(parts.map((part) => part.type), shown.flatMap((_, i) => (i ? [14, 10] : [10])));

  // What the container already holds counts: the text of the whole message is 4000.
  const withHeader = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('h'.repeat(3000)));
  addBlocks(withHeader, `${'w '.repeat(1500)}`);
  assert.ok(textLength(withHeader) <= 4000, `${textLength(withHeader)} with a header of 3000`);
  const full = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('f'.repeat(4000)));
  addBlocks(full, 'more text');
  assert.equal(textLength(full), 4000, 'nothing is added to a full message');

  // Text that fits is exactly what it was: the same JSON as before, for the shapes cards really use.
  const fitting = [
    'Done.',
    '<:petto_approve:1527894552277549066>  Unbanned **3** user(s) · Cases #1, #2, #3.\nModerator: <@1>\nReason: spam',
    '### Title\nline one\nline two\n### Second\nmore\n### Third\n-# small',
    'Intro\n\n### Settings\n- a\n- b\n```\n### not a heading\n```\nend',
    `${'a'.repeat(3999)}`,
    `${'b'.repeat(2000)}\n### Next\n${'c'.repeat(1900)}`,
    `-# ${'d'.repeat(10)}\n\n\n### Heading with blank lines\n\n\nbody\n\n`,
    'Ñandú, día, ✅ ❌ 😀 and <@1> <t:1:R> [x](https://a.b)',
  ];
  for (const text of fitting) {
    assert.equal(JSON.stringify(addBlocks(new ContainerBuilder(), text).toJSON()), JSON.stringify(oldAddBlocks(new ContainerBuilder(), text).toJSON()), `it changed ${JSON.stringify(text.slice(0, 40))}`);
  }
}

/** Random texts made of the pieces that break cards: the output is always inside the limits and cut clean. */
function checkFuzz() {
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const pieces = ['word ', 'another word ', '\n', '\n\n', '### Heading\n', '-# small\n', '<@123456789012345678> ', '<:petto_ok:123456789012345678>', '<t:1700000000:R> ', '[link](https://example.com/x) ', '`code` ', '😀', '**bold** ', 'x'.repeat(50), '```js\nconst a = 1;\n\n### inside\n```\n', '> quote\n'];
  for (let round = 0; round < 300; round += 1) {
    let text = '';
    const target = Math.floor(random() * 14000);
    while (text.length < target) text += pick(pieces);
    const card = addBlocks(new ContainerBuilder(), text);
    const shown = displays(card);
    assert.ok(shown.length >= 1 && shown.every((part) => part.length >= 1 && part.length <= 4000), `round ${round}: a display out of 1-4000`);
    assert.ok(textLength(card) <= 4000, `round ${round}: ${textLength(card)} characters in all`);
    if (text.length > 4000) shown.filter((part) => part.endsWith('…')).forEach((part) => assertCleanEnd(part.endsWith('\n```\n…') ? part : part.slice(0, -1), `round ${round}`));
    if (text.length <= 4000) assert.equal(JSON.stringify(card.toJSON()), JSON.stringify(oldAddBlocks(new ContainerBuilder(), text).toJSON()), `round ${round}: a text that fits changed`);
  }
}

/** `setContent` of a text display, wherever it is called: cut when long, never empty, the same when it fits. */
function checkDisplayGuard() {
  assert.throws(() => new TextDisplayBuilder().setContent('x'.repeat(5000)), 'without the guard discord.js refuses a long text');
  installTextDisplayGuard();
  installTextDisplayGuard();
  assert.equal(new TextDisplayBuilder().setContent('x'.repeat(5000)).toJSON().content.length, 4000);
  assert.equal(new TextDisplayBuilder().setContent('').toJSON().content, '​');
  assert.equal(new TextDisplayBuilder().setContent('  \n ').toJSON().content, '​');
  assert.equal(new TextDisplayBuilder().setContent(undefined).toJSON().content, '​');
  assert.equal(new TextDisplayBuilder().setContent('hello').toJSON().content, 'hello');
  assert.equal(new TextDisplayBuilder().setContent('y'.repeat(4000)).toJSON().content.length, 4000);
  assert.equal(new TextDisplayBuilder().setContent(`${'z'.repeat(3990)} <@123456789012345678>`).toJSON().content.length <= 4000, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// The last resort: an answer that Discord refuses for its content is told once as a short text; nothing else is retried.
// ---------------------------------------------------------------------------------------------------------------------
async function checkFallback() {
  const { MessageFlags } = require('discord.js');
  const { isPayloadError, sendWithPlainFallback, plainPayload, PLAIN_LIMIT } = require('../src/utils/payloadFallback');
  const { buildPseudoInteraction } = require('../src/handlers/prefixInteraction');
  const refused = (code = 50035, rawError = { errors: { components: {} } }) => Object.assign(new Error('Invalid Form Body'), { code, rawError });

  assert.equal(isPayloadError(refused()), true);
  for (const other of [refused(50013), refused(10003), refused(50001), refused(160002), refused(10062), new Error('boom'), null, undefined]) assert.equal(isPayloadError(other), false);

  // A card Discord refuses: one retry, a plain short text, nothing that can mention or show a component, one line in the log.
  const sent = [];
  let failures = 1;
  const send = async (payload) => { sent.push(payload); if (failures-- > 0) throw refused(); return { id: 'ok' }; };
  const card = { components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('hello'))], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
  errors.length = 0;
  const result = await sendWithPlainFallback(send, card, { lang: 'es', context: '!massban' });
  assert.deepEqual(result, { id: 'ok' });
  assert.equal(sent.length, 2, 'one try and one retry');
  assert.equal(sent[0], card, 'the first try is the card as it was');
  const retry = sent[1].components[0].toJSON();
  assert.equal(retry.type, 10, 'in Components V2 the short text is a text display (content is not allowed there)');
  assert.ok(retry.content.length <= PLAIN_LIMIT && retry.content.includes('demasiado larga'), 'in the language of the server');
  assert.equal(sent[1].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, 'private stays private');
  assert.deepEqual(sent[1].allowedMentions, { parse: [] });
  assert.equal(errors.length, 1, 'the failure is logged once');
  assert.ok(errors[0].includes('50035') && errors[0].includes('!massban'));

  // Not in Components V2: a plain `content`, with no components, embeds or files.
  sent.length = 0;
  failures = 1;
  await sendWithPlainFallback(send, { embeds: [{ title: 'x' }], components: [{}], files: ['a'], content: undefined }, { lang: 'pt-BR' });
  assert.equal(sent[1].content.includes('longa demais'), true);
  assert.deepEqual([sent[1].components, sent[1].embeds, sent[1].files, sent[1].flags], [[], [], [], undefined]);
  assert.ok(sent[1].content.length <= 1900);
  // An error card that is short text of its own is kept as it is; Discord's own words about Components V2 make it a text display.
  const v2Conflict = refused(50035, { errors: { content: { _errors: [{ code: 'MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2' }] } } });
  const sentConflict = [];
  await sendWithPlainFallback(async (payload) => { sentConflict.push(payload); if (sentConflict.length === 1) throw v2Conflict; }, { content: 'Something went wrong while running that command.', flags: MessageFlags.Ephemeral }, { lang: 'en' });
  assert.equal(sentConflict[1].components[0].toJSON().content, 'Something went wrong while running that command.');
  assert.equal(sentConflict[1].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.ok(plainPayload('a'.repeat(5000), 'en').content.length <= PLAIN_LIMIT, 'whatever the text, the short text is at most 1900 characters');

  // A permission or an unknown channel is not about the answer: no retry, the same error.
  for (const code of [50013, 10003, 50001, 160002, 10062, 10008]) {
    const calls = [];
    const error = refused(code);
    await assert.rejects(() => sendWithPlainFallback(async (payload) => { calls.push(payload); throw error; }, card, { lang: 'en' }), (thrown) => thrown === error);
    assert.equal(calls.length, 1, `code ${code} is not retried`);
  }
  // No loop: when the short text is refused too, the error goes up after two tries.
  const always = [];
  await assert.rejects(() => sendWithPlainFallback(async (payload) => { always.push(payload); throw refused(); }, card, { lang: 'en' }), (error) => error.code === 50035);
  assert.equal(always.length, 2, 'two tries, never more');

  // The prefix commands: the same thing through the fake interaction every `!command` runs with, for reply, editReply and followUp.
  const log = [];
  let failNext = 0;
  const channel = { id: 'c1', send: async (options) => { log.push(['send', options]); if (failNext-- > 0) throw refused(); return { id: 'sent', edit: async (o) => { log.push(['edit', o]); if (failNext-- > 0) throw refused(); return { id: 'edited' }; } }; } };
  const message = {
    guild: { id: 'g1' }, channel, author: { id: 'u1' }, member: {}, client: {}, channelId: 'c1',
    reply: async (options) => {
      log.push(['reply', options]);
      if (failNext-- > 0) throw refused();
      return { id: 'r', edit: async (o) => { log.push(['edit', o]); if (failNext-- > 0) throw refused(); return { id: 'edited' }; } };
    },
  };
  const pseudo = buildPseudoInteraction(message, { commandName: 'massban', subcommand: null, subcommandGroup: null, values: {} });
  pseudo.pettoLang = 'es';
  failNext = 1;
  log.length = 0;
  await pseudo.reply(card);
  assert.equal(log[0][0], 'reply');
  assert.equal(log[1][0], 'reply');
  assert.ok(log[1][1].components[0].toJSON().content.includes('demasiado larga'), 'the language of the server');
  failNext = 1;
  log.length = 0;
  await pseudo.editReply(card);
  assert.deepEqual(log.map((entry) => entry[0]), ['edit', 'edit'], 'an edit that Discord refuses is retried once as an edit');
  failNext = 1;
  log.length = 0;
  await pseudo.followUp(card);
  assert.deepEqual(log.map((entry) => entry[0]), ['reply', 'reply'], 'and a follow up too (it is an answer to the message too, retried once as a short text)');
  // A refusal that is not about the answer still reaches the command.
  message.reply = async () => { throw refused(50013); };
  await assert.rejects(() => pseudo.reply(card), (error) => error.code === 50013);

  // The whole chain for the case of the report: a card that Discord refuses never ends as a generic error.
  const guarded = await (async () => {
    const tries = [];
    await sendWithPlainFallback(async (payload) => { tries.push(payload); if (tries.length === 1) throw refused(); }, { components: [], flags: MessageFlags.IsComponentsV2 }, { lang: 'en' });
    return tries;
  })();
  assert.equal(guarded.length, 2);
}

(async () => {
  checkLists();
  await checkUnbanAll();
  checkAddBlocks();
  checkFuzz();
  checkDisplayGuard();
  await checkFallback();
  console.log('check-card-limits: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
