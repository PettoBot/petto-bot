// Checks that the music commands are hidden from absolutely everybody while the code stays (src/utils/hiddenCommands.js, `hiddenEverywhere` on /music):
//   - nothing was deleted: the files of the music, its command, buttons, voice listener and locale files are still there;
//   - /music is never registered with Discord (not in the commands that are sent, not a slash command, not counted by `!bots` or the slot budget), even with
//     MUSIC_ENABLED; only the explicit opt-in MUSIC_LISTED brings it back;
//   - it is in no place where a person sees a command: !help (the browser, the categories, `!help music`, `!help play`), the `/help command:` list, the "did
//     you mean" of a mistyped word, the umbrellas, the `!bots` numbers, the generated `!<name>config` cards, the tables of short aliases that are published
//     (the JSON, the wiki tables) and what the website reads (the flag `hiddenEverywhere`, and every route to it marked `team`);
//   - for a normal member the music words (`!music`, `!play`, `!skip`, `!queue`, a short alias, `petto play`) are not commands: no answer at all, not even
//     "unknown command", and a word the server chose (a custom command `play`) still works; for the team (owner and PETTO_DEVELOPER_IDS) they work as before;
//   - the buttons of a music card that was already posted keep their handler.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const DEV = '900000000000000001';
process.env.PETTO_DEVELOPER_IDS = DEV;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionsBitField, PermissionFlagsBits, MessageFlags } = require('discord.js');

const root = path.join(__dirname, '..');
function patch(relative, overrides) {
  return Object.assign(require(path.join(root, relative)), overrides);
}
const stubPath = require.resolve(path.join(root, 'src/db/database.js'));
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports: { from: () => ({}) } };

let customRows = {}; // word -> row of a custom command the server wrote
const guildRow = { prefix: '!', prefixes: ['!', 'petto'] };
patch('src/db/guilds.js', { ensureGuild: async () => guildRow });
patch('src/db/commandAliases.js', { get: async () => null });
patch('src/db/customCommands.js', { getCommand: async (guildId, word) => customRows[word] ?? null });
patch('src/db/disabledCommands.js', { findCached: async () => null, canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => ({}) });
patch('src/db/permissions.js', { hasCommandPermission: async () => true, listGroups: async () => [] });
patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
patch('src/utils/codeCommands.js', { runCodeCommand: async () => true });
patch('src/logging/extraLog.js', { logCommandUse() {} });
patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
patch('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const config = require('../src/config');
const { loadCommands, collectCommandData, isSlashCommand } = require('../src/handlers/commandHandler');
const event = require('../src/events/messageCreateCommands');
const interactionCreate = require('../src/events/interactionCreate');
const help = require('../src/commands/utility/help');
const bots = require('../src/commands/utility/bots');
const { isHiddenEverywhere, isHiddenWordFor } = require('../src/utils/hiddenCommands');
const { DEFAULT_PREFIX_ROUTES, BASE_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
const { SHORT_ALIAS_TABLE, TEAM_ALIAS_TABLE } = require('../src/utils/shortAliases');
const generator = require('./gen-short-aliases');
const docs = require('./short-aliases-docs');
const { slotUsage } = require('../src/utils/slashBudget');
const { isRealCommand } = require('../src/utils/codeCommandAdmin');

const F = PermissionFlagsBits;
const ANA = '111111111111111111';
const GUILD = '444444444444444444';
const client = { user: { id: '123', displayAvatarURL: () => 'https://example.com/a.png' }, users: { fetch: async (id) => ({ id, username: `user${id.slice(-3)}` }) } };
loadCommands(client);
const music = client.commands.get('music');
const musicSource = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const MUSIC_WORDS = ['music', 'play', 'playnext', 'skip', 'previous', 'stop', 'resume', 'queue', 'volume', 'loop', 'shuffle', 'seek', 'autoplay', 'disconnect'];

(async () => {
  // ------------------------------------------------------------ nothing was deleted
  for (const file of ['src/music/access.js', 'src/music/autoplay.js', 'src/music/card.js', 'src/music/icons.js', 'src/music/match.js', 'src/music/node.js', 'src/music/queue.js', 'src/music/resolver.js',
    'src/music/service.js', 'src/music/spotify.js', 'src/music/status.js', 'src/commands/music/music.js', 'src/interactions/music.js', 'src/events/voiceStateUpdateMusic.js',
    'src/i18n/locales/en/music.js', 'src/i18n/locales/es/music.js', 'src/i18n/locales/pt-BR/music.js', 'src/i18n/locales/en/cmd.music.js', 'src/i18n/locales/es/cmd.music.js', 'src/i18n/locales/pt-BR/cmd.music.js',
    'scripts/check-music.js']) assert.ok(fs.existsSync(path.join(root, file)), `${file} is still there (the code of the music stays)`);
  assert.ok(music && music.data.toJSON().options.length >= 15, '/music is still a loaded command with its subcommands');
  assert.ok(musicSource('index.js').includes("require('./src/music/node')"), 'the Lavalink integration is still started by index.js');
  assert.ok(musicSource('src/events/interactionCreate.js').includes("require('../interactions/music')"), 'the buttons of the music card still have their handler');

  // ------------------------------------------------------------ the flag, and the opt-in that brings it back
  assert.equal(config.musicListed, false, 'MUSIC_LISTED is off by default');
  assert.equal(music.hiddenEverywhere, true);
  assert.equal(isHiddenEverywhere(music), true);
  assert.equal(music.hiddenFromHelp, true, 'and the places that only know hiddenFromHelp skip it too');
  for (const enabled of [false, true]) {
    config.musicEnabled = enabled;
    assert.equal(music.registerSlash, false, `/music is not registered with MUSIC_ENABLED=${enabled}`);
    assert.equal(isSlashCommand(music), false);
    assert.ok(!collectCommandData().some((json) => json.name === 'music'), `not in the commands sent to Discord (MUSIC_ENABLED=${enabled})`);
  }
  for (const other of client.commands.values()) if (other !== music) assert.ok(!isHiddenEverywhere(other), `${other.data.name} is not hidden`);
  const slotsHidden = slotUsage(collectCommandData()).chat.used;
  config.musicEnabled = true;
  config.musicListed = true;
  assert.equal(music.hiddenEverywhere, false, 'MUSIC_LISTED brings it back as a normal command');
  assert.equal(isSlashCommand(music), true);
  assert.equal(slotUsage(collectCommandData()).chat.used, slotsHidden + 1, 'hidden, /music does not take a slot of the budget');
  config.musicListed = false;
  config.musicEnabled = false;
  assert.equal(slotUsage(collectCommandData()).chat.used, slotsHidden);

  // ------------------------------------------------------------ nowhere a person sees a command
  const mentionsMusic = (value) => /\/music|!music|\bmusic (play|queue|skip)|\bplaynext\b|🎵|nowplaying|\/play\b|!play\b|!skip\b/i.test(typeof value === 'string' ? value : JSON.stringify(value));
  // !help: the browser and the menus, for a member and for the team
  for (const includeHidden of [false, true]) {
    const main = help.mainView(client, { name: 'Test', members: { me: null } }, '!', includeHidden, 'en');
    assert.ok(!mentionsMusic(JSON.parse(JSON.stringify(main))), `the main menu does not list the music (includeHidden=${includeHidden})`);
    const category = help.categoryView(client, { name: 'Test', members: { me: null } }, 'music', includeHidden, 'en');
    // (the category is not in the main menu, so nobody gets here; typed by hand it has no command to pick)
    assert.ok(!/"value":"music/.test(JSON.stringify(category)) && /"options":\[\]/.test(JSON.stringify(JSON.parse(JSON.stringify(category)))) && /0 commands/.test(JSON.stringify(category)), 'the music category menu is empty of commands');
    for (const typed of ['music', 'play', 'skip', 'queue', 'nowplaying', 'mp', 'mq', 'mpl', 'volume', 'autoplay']) {
      const choices = help.helpChoices(client, typed, includeHidden);
      assert.ok(!choices.some((choice) => /^music( |$)/.test(choice.value)), `/help command:${typed} does not offer music (includeHidden=${includeHidden})`);
    }
    assert.ok(!help.helpChoices(client, '', includeHidden).some((choice) => /^music/.test(choice.value)), 'the empty list does not offer it');
    for (const typed of ['musik', 'musc', 'mussic', 'plya', 'quee', 'musi', 'skp', 'play']) {
      assert.ok(!help.suggestCommands(client, typed, includeHidden).includes('music'), `"did you mean" for ${typed} does not suggest music (includeHidden=${includeHidden})`);
    }
  }
  // `!help music`, `!help play`, `!help mp skip`: nothing found, for the team too (it is hidden even for developers)
  const helpCommand = client.commands.get('help');
  for (const typed of ['music', 'play', 'skip', 'queue', 'music play', 'mp']) {
    const answers = [];
    const guildId = '5550';
    const interaction = {
      client, user: { id: DEV }, guild: { id: guildId, name: 'Test', members: { me: null } }, pettoLang: 'en', options: { getString: () => typed },
      reply: async (payload) => { answers.push(payload); return { createMessageComponentCollector: () => ({ on() {} }) }; },
      editReply: async (payload) => { answers.push(payload); },
      deferReply: async () => {}, isChatInputCommand: () => true,
    };
    await helpCommand.execute(interaction, client).catch(() => {});
    for (const answer of answers) assert.ok(!/Music|music play|🎵/.test(JSON.stringify(JSON.parse(JSON.stringify(answer))).replace(/"name":"[^"]*"/g, '')) || /not (found|a command)|Unknown|No command|no such/i.test(JSON.stringify(answer)), `!help ${typed} does not show the music card`);
  }
  // The umbrellas and the generated cards
  for (const command of client.commands.values()) {
    if (!command.umbrella) continue;
    assert.ok(!JSON.stringify(command.data.toJSON().options).includes('"music"'), `/${command.data.name} has no music subcommand`);
  }
  assert.ok(!client.commands.has('musicconfig') && !client.commandAliases.has('musicconfig'), 'there is no generated !musicconfig card');
  // `!bots`: the numbers of the team do not count it (a listed and enabled /music would be one more of each)
  const botsNumbers = async () => {
    const answers = [];
    const members = new Collection();
    const interaction = {
      client: { ...client, user: { id: '1' }, commands: client.commands, application: { commands: { fetch: async () => { throw new Error('down'); } } } }, user: { id: DEV },
      guild: { memberCount: 0, members: { cache: members, fetch: async () => members } }, deferReply: async () => {}, reply: async (payload) => { answers.push(payload); }, editReply: async (payload) => { answers.push(payload); },
    };
    await bots.execute(interaction);
    const out = JSON.stringify(answers.at(-1).components.map((component) => component.toJSON()));
    return { slash: Number(/Slash commands: \*\*(\d+) \//.exec(out)[1]), prefix: Number(/Only with the prefix \(not slash yet\): (\d+)/.exec(out)[1]), out };
  };
  const hidden = await botsNumbers();
  assert.equal(hidden.slash, slotsHidden - 0, '`!bots` counts the registered commands, music not among them');
  assert.ok(!/music/i.test(hidden.out), '`!bots` does not name it');
  config.musicListed = true;
  const listedOff = await botsNumbers();
  assert.equal(listedOff.prefix, hidden.prefix + 1, 'listed but off, /music would be one more of the prefix commands: hidden, it is not counted');
  config.musicEnabled = true;
  const listedOn = await botsNumbers();
  assert.equal(listedOn.slash, hidden.slash + 1, 'listed and on, /music would take a slot: hidden, it takes none');
  config.musicListed = false;
  config.musicEnabled = false;
  // The tables of short aliases that are published
  assert.ok(!Object.values(SHORT_ALIAS_TABLE).some((target) => target.split(' ')[0] === 'music'), 'src/utils/short-aliases.json has no music word');
  assert.ok(Object.keys(TEAM_ALIAS_TABLE).length >= 15 && Object.values(TEAM_ALIAS_TABLE).every((target) => target.split(' ')[0] === 'music'), 'the words for the team are in their own table');
  for (const word of Object.keys(TEAM_ALIAS_TABLE)) assert.ok(!(word in SHORT_ALIAS_TABLE), `${word} is not in both tables`);
  const info = generator.loadCommandInfo();
  assert.equal(info.commands.find((command) => command.name === 'music').hidden, true, 'the generator skips it');
  assert.deepEqual(generator.generate({ ...info, table: SHORT_ALIAS_TABLE }).added, {}, 'and gives no music word to anybody');
  assert.ok(generator.generate({ ...info, table: {} }).added && !Object.values(generator.generate({ ...info, table: {} }).added).some((target) => target.startsWith('music')), 'from nothing it does not make music words either');
  for (const word of Object.keys(TEAM_ALIAS_TABLE)) assert.ok(info.taken.has(word), `${word} is a taken word: no other command gets it`);
  // The wiki tables (written in a temporary folder) never get a music row, whatever the table says
  const wiki = fs.mkdtempSync(path.join(os.tmpdir(), 'petto-wiki-'));
  for (const lang of ['', 'es', 'pt-br']) {
    fs.mkdirSync(path.join(wiki, lang, 'setup'), { recursive: true });
    fs.writeFileSync(path.join(wiki, lang, 'setup', 'short-aliases.mdx'), `# x\n\n${docs.START}\n\nold\n\n${docs.END}\n`);
  }
  const originalLog = console.log;
  console.log = () => {};
  try { docs.writeWiki(wiki, { ...SHORT_ALIAS_TABLE, mp: 'music play', mq: 'music queue' }, { commands: info.commands }); } finally { console.log = originalLog; }
  for (const lang of ['', 'es', 'pt-br']) {
    const page = fs.readFileSync(path.join(wiki, lang, 'setup', 'short-aliases.mdx'), 'utf8');
    assert.ok(page.includes('`!image`') && !/music/i.test(page), `the wiki table (${lang || 'en'}) has the other commands and no music`);
  }
  fs.rmSync(wiki, { recursive: true, force: true });
  // What the website reads: the flag on the command, and every route to it is marked for the team
  const toMusic = DEFAULT_PREFIX_ROUTES.filter((route) => route.command === 'music');
  assert.ok(toMusic.length >= 30 && toMusic.every((route) => route.team === true), 'every route to /music is marked `team`');
  assert.ok(BASE_PREFIX_ROUTES.filter((route) => route.command === 'music').every((route) => route.team === true));
  for (const route of DEFAULT_PREFIX_ROUTES.filter((other) => other.team)) assert.equal(route.command, 'music', 'only the music has team routes');

  // ------------------------------------------------------------ the prefix: silent for a member, as before for the team
  const calls = [];
  const original = music.execute;
  music.execute = async function spy(interaction) { calls.push({ sub: interaction.options.getSubcommand(false), user: interaction.user.id }); };
  let seq = 0;
  async function send(content, { as = ANA, perms = 0n } = {}) {
    const sent = [];
    const before = calls.length;
    seq += 1;
    const guild = { id: `7${seq}`, name: 'Petto Test', members: { cache: new Map(), fetch: async () => new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() } };
    const message = {
      content, author: { id: as, bot: false }, guild, client,
      member: { id: as, guild: { ownerId: '1' }, permissions: new PermissionsBitField(perms), roles: { cache: new Map(), highest: { position: 1 } } },
      mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
      channel: { id: '5', sendTyping: async () => {}, send: async (payload) => { sent.push(JSON.stringify(payload.components ?? payload.content ?? payload)); return {}; } },
      reply: async (payload) => { sent.push(JSON.stringify((payload.components ?? []).map((component) => component.toJSON?.() ?? component)) + (payload.content ?? '')); return { delete: async () => {}, edit: async () => {} }; },
    };
    event.setCachedPrefix(guild.id, guildRow.prefixes);
    await event.execute(message);
    return { sent, called: calls.slice(before), isCommand: await event.isCommandMessage(message) };
  }
  const WORDS = [
    '!music', '!music play creep radiohead', '!play creep radiohead', '!playnext creep', '!skip', '!queue', '!stop', '!resume', '!previous', '!volume 80', '!loop queue', '!shuffle', '!seek 1:30',
    '!autoplay', '!disconnect', '!MUSIC', '! play creep', 'petto play creep', 'petto music', '<@123> play creep', '!mp creep', '!mq', '!mski', '!mpl creep',
  ];
  for (const text of WORDS) {
    const member = await send(text);
    assert.deepEqual(member.sent, [], `a normal member typing \`${text}\` gets no answer at all`);
    assert.equal(member.called.length, 0, `\`${text}\` does not reach the music`);
    assert.equal(member.isCommand, false, `\`${text}\` is not a command for the other features either (an autoresponder may see it)`);
  }
  // another typed word near it is still answered as an unknown command, without naming the music
  const typo = await send('!musik');
  assert.equal(typo.sent.length, 1, 'a real typo gets the usual answer');
  assert.ok(!/music/i.test(typo.sent[0].replace(/musik/g, '')), 'and it does not suggest the music');
  const typo2 = await send('!plya creep');
  assert.ok(typo2.sent.length === 0 || !/`!music`|!play\b/.test(typo2.sent[0]), 'nor does a typo of a music word');
  assert.equal((await send('!zzzzzz')).sent.length, 1, 'any other unknown word is still answered (the silence is only for the music words)');
  assert.equal((await send('!ping')).isCommand, true, 'a real command is a command');
  // the team keeps today's behaviour
  for (const [text, sub] of [['!music play creep', 'play'], ['!music', 'queue'], ['!play creep radiohead', 'play'], ['!skip', 'skip'], ['!queue', 'queue'], ['!stop', 'stop'], ['!mp creep', 'play'], ['!mq', 'queue'], ['!playnext x', 'playnext'], ['!disconnect', 'leave'], ['petto play creep', 'play']]) {
    for (const who of [DEV, config.ownerId]) {
      const team = await send(text, { as: who });
      assert.equal(team.called.length, 1, `\`${text}\` runs the music for the team (${who === DEV ? 'developer' : 'owner'})`);
      assert.equal(team.called[0].sub, sub, `\`${text}\` is /music ${sub}`);
      assert.equal(team.isCommand, true);
    }
  }
  // a word the server chose is the server's: it works for a member, and the team still gets the music
  customRows = { play: { name: 'play', response: 'server play', trigger_type: null } };
  const own = await send('!play creep');
  assert.ok(own.sent.length === 1 && /server play/.test(own.sent[0]) && own.called.length === 0, 'a custom command `play` of the server answers a member');
  assert.equal((await send('!play creep', { as: DEV })).called.length, 1, 'and the team still plays music');
  customRows = {};
  assert.equal(isRealCommand(client, 'play', ANA), false, 'a server may write a custom command with a music word (it is not a command for its members)');
  assert.equal(isRealCommand(client, 'music', ANA), false);
  assert.equal(isRealCommand(client, 'play', DEV), true, 'but the team cannot (it is taken for them)');
  assert.equal(isRealCommand(client, 'ban', ANA), true, 'other commands stay taken');
  assert.equal(isHiddenWordFor(client, 'play', ANA), true);
  assert.equal(isHiddenWordFor(client, 'play', DEV), false);
  assert.equal(isHiddenWordFor(client, 'ban', ANA), false);
  for (const word of MUSIC_WORDS) assert.equal(isHiddenWordFor(client, word, ANA), true, `${word} is hidden for a member`);

  // ------------------------------------------------------------ the slash command that Discord may still have in a cache, and the buttons
  const slash = async (userId) => {
    const replies = [];
    const interaction = new Proxy({
      id: '777777777777777701', commandName: 'music', commandType: 1, user: { id: userId }, guild: { id: GUILD }, guildId: GUILD, channelId: '5', channel: { id: '5' }, member: { permissions: new PermissionsBitField(0n), roles: { cache: new Map() } },
      locale: 'en-US', client, options: { getSubcommand: () => 'queue', getSubcommandGroup: () => null, getInteger: () => null, getString: () => null },
      deferred: false, replied: false, isChatInputCommand: () => true,
      reply: async (payload) => { replies.push(payload); return {}; }, deferReply: async () => {}, editReply: async () => {},
    }, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
    const before = calls.length;
    await interactionCreate.execute(interaction, client);
    return { replies, called: calls.length - before };
  };
  const memberSlash = await slash(ANA);
  assert.equal(memberSlash.called, 0, 'a /music typed from a stale cache does not run for a member');
  assert.equal(memberSlash.replies.length, 1);
  assert.ok((memberSlash.replies[0].flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral && /Unknown command/.test(memberSlash.replies[0].content), 'it is answered in private as an unknown command (a popup of Discord, not a music answer)');
  assert.equal((await slash(DEV)).called, 1, 'the team can still run it');
  music.execute = original;
  const press = async (customId) => {
    const replies = [];
    const interaction = new Proxy({
      customId, user: { id: ANA }, guild: { id: GUILD }, guildId: GUILD, client, locale: 'en-US', member: { permissions: new PermissionsBitField(F.SendMessages), roles: { cache: new Map() } },
      isButton: () => true, isStringSelectMenu: () => false, isChatInputCommand: () => false, deferred: false, replied: false,
      reply: async (payload) => { replies.push(payload); return {}; }, update: async (payload) => { replies.push(payload); }, deferUpdate: async () => {},
    }, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
    await interactionCreate.execute(interaction, client);
    return replies;
  };
  const buttonReplies = await press('music:pause');
  assert.equal(buttonReplies.length, 1, 'the button of a music card that was posted before still has its handler (it answers, here that the music is off)');
  assert.ok((buttonReplies[0].flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral, 'in private');

  // ------------------------------------------------------------ it runs last
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.ok(scripts.check.includes('node scripts/check-music-hidden.js'), 'this check is part of `npm run check`');
  console.log('check-music-hidden: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
