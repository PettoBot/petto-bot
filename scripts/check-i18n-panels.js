// Every panel and every message with buttons or menus, drawn in Spanish and Brazilian Portuguese, has no English words left in
// what people read (names of products and commands aside). Also: the messages Petto keeps standing in a server (panels, running
// giveaways) are redrawn in the new language when it changes, in place, and the defaults saved in English are shown translated.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

const resolvedDb = require.resolve('../src/db/database');
require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: () => ({}) } };
function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {}, runWithContext: (c, fn) => fn() });

const { t, defaultText, LANGUAGES } = require('../src/i18n');

// English words that never belong in a Spanish or Portuguese message. Words that are the same in those languages (no, info,
// panel, ticket, rank, roles…) and the names of products are not in the list.
const ENGLISH = new Set(`the and your you to of with for this that these those from into by are is was were be been has have had
will would can cannot could should click press button buttons channel channels member members server servers lock unlock locked
unlocked hide hidden reveal claim claimed permit reject rejected rename transfer delete deleted disconnect start started view
increase decrease limit user users open opened close closed enter entered entries winner winners hosted ends ended join joined
leave left ban banned kick kicked mute muted warn warning reason reasons duration verify verified unverified confess confession
anonymous reply replies anonymously caught giveaway prize pick picked here there now new old please again
only every all any none nothing something someone everyone their them they our we yes enabled disabled enable disable settings
setup create created edit edited remove removed add added send sent message messages show shown list back next previous page
first last cancel confirm save saved category categories support help details report reports role voice temporary
manage owner owners status rating rate rated transcript level xp`.split(/\s+/).filter(Boolean));
// Names people read in every language.
const NAMES = /\b(Petto|Discord|VoiceMaster|Nitro|Premium|Components|Server Tag|Vanity|AutoMod|Cloudflare|Turnstile|top\.gg|Watch Together|Petto Code|XP)\b/g;
// Words of the list that are also words of that language: Portuguese "remove" (Remove o cargo), "role" (Role os dados, from rolar)
// and "status" (um status AFK).
const ALSO_NATIVE = { 'pt-BR': new Set(['remove', 'role', 'status']) };

/** Every text of a payload people read: contents, labels, placeholders, descriptions, titles, footers, field names and values. */
function texts(node, out = []) {
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out; }
  if (!node || typeof node !== 'object') return out;
  const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
  // `name` and `value` are text in an embed field ({ name, value }); elsewhere they are an emoji's name or a menu option's value.
  const field = typeof json.name === 'string' && typeof json.value === 'string' && !('label' in json);
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string' && (['content', 'label', 'placeholder', 'description', 'title', 'text'].includes(key) || (field && (key === 'name' || key === 'value')))) out.push(value);
    else if (key === 'author' && typeof value?.name === 'string') out.push(value.name);
    else if (value && typeof value === 'object') texts(value, out);
  }
  return out;
}

// The names of commands and subcommands (`!report list, view`): they are never translated, so they are not English left behind.
const COMMAND_WORDS = (() => {
  const words = new Set();
  const { findCommandFiles, COMMANDS_DIR } = require('../src/handlers/commandHandler');
  const walk = (node) => { words.add(node.name); for (const option of node.options ?? []) if (option.type === 1 || option.type === 2) walk(option); };
  for (const file of findCommandFiles(COMMANDS_DIR)) { const command = require(file); if (command?.data?.toJSON) walk(command.data.toJSON()); }
  return words;
})();

/** The English words left in a payload drawn in another language. */
function englishLeft(payload, lang = null) {
  const found = new Set();
  for (const text of texts(payload)) {
    // A text that is only the name of a command (a menu option of `!help`) is a name.
    if (COMMAND_WORDS.has(text.trim())) continue;
    const hasCommand = /![a-z]/.test(text);
    const plain = text
      .replace(/`[^`]*`/g, ' ') // code and command syntax
      .replace(/<[^>]+>/g, ' ') // mentions, channels, emojis, timestamps
      .replace(/\{[^{}]*\}/g, ' ') // placeholders
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(NAMES, ' ');
    for (const word of plain.toLowerCase().match(/\p{L}+/gu) ?? []) {
      if (ENGLISH.has(word) && !(hasCommand && COMMAND_WORDS.has(word)) && !ALSO_NATIVE[lang]?.has(word)) found.add(word);
    }
  }
  return [...found];
}

const guild = { id: '111111111111111111', name: 'Servidor', iconURL: () => null, members: { me: { id: 'bot' } }, client: { user: { id: 'bot' } } };
const drawn = []; // [name, lang, payload]
function draw(name, build) {
  for (const lang of LANGUAGES) {
    try {
      drawn.push([name, lang, build(lang)]);
    } catch (err) {
      throw new Error(`${name} could not be drawn in ${lang}: ${err.stack}`);
    }
  }
}

(async () => {
  // VoiceMaster: the panel of the reported case.
  const voicemaster = require('../src/commands/automation/voicemaster');
  draw('voicemaster panel', (lang) => voicemaster.buildPanelPayload(lang));
  const vmEs = JSON.stringify(voicemaster.buildPanelPayload('es'));
  for (const words of ['Panel del canal de voz', 'Bloquear', 'Desbloquear', 'Ocultar', 'Mostrar', 'Reclamar', 'Permitir', 'Rechazar', 'Renombrar', 'Transferir', 'Eliminar', 'Desconectar', 'Iniciar', 'Ver** info del canal', 'Aumentar', 'Disminuir']) {
    assert.ok(vmEs.includes(words), `the Spanish VoiceMaster panel says "${words}"`);
  }
  const ids = (payload) => JSON.stringify(payload).match(/"custom_id":"[^"]+"/g);
  assert.deepEqual(ids(voicemaster.buildPanelPayload('pt-BR')), ids(voicemaster.buildPanelPayload('en')), 'the buttons keep their ids in every language');

  // Tickets: the panel (with the English defaults the setup wizard saved), its rows and the ticket controls.
  const tickets = require('../src/commands/tickets/ticket');
  const cards = require('../src/utils/ticketCards');
  const wizardPanel = { id: 1, style: 'select', title: 'Support', description: 'Click a button below to open a ticket. A private channel will be created for you and our staff.', placeholder: null, color: null };
  const wizardTypes = [{ key: 'support', label: 'Support', description: 'General help', emoji: '🎫', button_style: 'primary' }];
  for (const lang of LANGUAGES) drawn.push(['ticket panel (wizard defaults)', lang, await tickets.renderPanelMessage(guild, wizardPanel, wizardTypes, null, lang)]);
  const esPanel = JSON.stringify(await tickets.renderPanelMessage(guild, wizardPanel, wizardTypes, null, 'es'));
  assert.ok(esPanel.includes(t('es', 'tickets.setup.default.title')) && esPanel.includes(t('es', 'tickets.setup.default.typeDescription')), 'the wizard defaults are shown in Spanish');
  const staffPanel = JSON.stringify(await tickets.renderPanelMessage(guild, { ...wizardPanel, title: 'Ayuda con pedidos' }, [{ ...wizardTypes[0], label: 'Pedidos' }], null, 'pt-BR'));
  assert.ok(staffPanel.includes('Ayuda con pedidos') && staffPanel.includes('Pedidos'), 'what the staff wrote is shown as it is');
  draw('ticket button row', (lang) => cards.buildPanelRows('button', [{ key: 'a', label: t(lang, 'tickets.setup.default.typeLabel'), button_style: 'primary' }], { lang }));
  draw('ticket controls', (lang) => [cards.buildTicketControlRow(1, lang), cards.buildTicketMemberRow(1, lang), cards.buildCloseRequestRow(1, lang)]);
  draw('ticket closed controls', (lang) => cards.buildClosedControlRow(1, 'https://petto.sbs/t/1', lang));

  // Verification panel, every method.
  const verify = require('../src/interactions/verifyLetters');
  for (const method of ['turnstile', 'letters', 'both']) draw(`verification panel (${method})`, (lang) => verify.buildPanel({ guild, method, lang }));

  // Confessions panel, with the English defaults the database keeps.
  const confessions = require('../src/utils/confessions');
  const confessionConfig = { color: null, panel_text: 'Press the button and write it. Nobody will know it was you.', button_label: 'Confess' };
  draw('confessions panel (database defaults)', (lang) => confessions.buildPanel(guild, confessionConfig, lang));
  assert.ok(JSON.stringify(confessions.buildPanel(guild, { ...confessionConfig, panel_text: 'Cuéntanos', button_label: 'Contar' }, 'pt-BR')).includes('Cuéntanos'), 'a panel text the server wrote is kept');

  // Honeypot panels.
  const honeypot = require('../src/utils/honeypotPanel');
  draw('honeypot panel', (lang) => honeypot.buildHoneypotPanel({ punishment: 'softban', caughtCount: 3, lang }));
  draw('honeypot stats panel', (lang) => honeypot.buildHoneypotStatsPanel({ punishment: 'ban', caughtCount: 1, channelId: '2', lang }));

  // Giveaways: the card, the Enter and claim buttons.
  const giveaway = require('../src/utils/giveawayCard');
  draw('giveaway card', (lang) => giveaway.buildEntryCard({ prize: 'Nitro', hostId: '5', winnersCount: 2, endsAtUnix: 1_900_000_000, entryMode: 'button', reaction: '🎉', entriesCount: 12, ended: false, presetText: null, lang }));
  draw('ended giveaway card', (lang) => giveaway.buildEntryCard({ prize: 'Nitro', hostId: '5', winnersCount: 1, endsAtUnix: 1_900_000_000, entryMode: 'reaction', reaction: '🎉', entriesCount: 1, ended: true, presetText: null, lang }));
  draw('giveaway buttons', (lang) => [giveaway.buildEnterRow(9, { lang }), giveaway.buildClaimRow('w1', lang)]);

  // Polls, suggestions, roleplay, backups, the setup panel, the report settings and the version card.
  const pollCard = require('../src/utils/pollCard');
  const poll = { id: 1, question: '¿Pizza?', options: ['Sí', 'No'], multi: false, closed: false, ends_at: null, creator_id: '5', image: null };
  draw('poll card', (lang) => [pollCard.buildPollCard(poll, { counts: [3, 1], voters: 4 }, lang), ...pollCard.voteRows(poll, lang)]);
  draw('closed poll card', (lang) => pollCard.buildPollCard({ ...poll, closed: true }, { counts: [1, 0], voters: 1 }, lang));
  const suggestions = require('../src/utils/suggestions');
  draw('suggestion buttons', () => suggestions.voteRow('abc', { up_emoji: '👍', down_emoji: '👎' }));
  const roleplay = require('../src/utils/roleplayButtons');
  draw('roleplay buttons', (lang) => roleplay.buildRoleplayButtonRow({ requestId: 'r'.repeat(16), action: 'hug', actorId: '1'.repeat(17), targetId: '2'.repeat(17) }, false, lang));
  const backup = require('../src/commands/config/backup');
  draw('backup panel', (lang) => backup.buildPanel(guild, '5', [{ backup_number: 1, label: 'Manual backup', source: 'manual', created_at: new Date().toISOString() }, { backup_number: 2, label: 'Scheduled backup', source: 'scheduled', created_at: new Date().toISOString() }], null, lang));
  const setupPanel = require('../src/interactions/setupPanel');
  const setupGuild = { ...guild, channels: { cache: new Map() }, roles: { cache: new Map() }, members: { me: { permissions: { has: () => false } } } };
  draw('setup panel', (lang) => setupPanel.buildSetupPanel(setupGuild, { guild: { prefix: '!' }, logs: { entries: [] }, automod: {}, report: null }, { lang }));
  draw('setup form', (lang) => setupPanel.buildSetupModal(setupGuild, { guild: { prefix: '!' }, logs: { entries: [] }, automod: {}, report: null }, lang));
  const reportPanel = require('../src/interactions/reportConfigPanel');
  draw('report settings panel', (lang) => reportPanel.buildConfigPanel({ ...guild, channels: { cache: new Map() }, roles: { cache: new Map() } }, {}, { lang }));
  draw('language cards', (lang) => [require('../src/commands/config/language').buildCurrentCard(lang, '!'), require('../src/commands/config/language').buildDoneCard(lang, 3)]);

  // A payload drawn by an async builder, in every language.
  const drawAsync = async (name, build) => {
    for (const lang of LANGUAGES) {
      try {
        drawn.push([name, lang, await build(lang)]);
      } catch (err) {
        throw new Error(`${name} could not be drawn in ${lang}: ${err.stack}`);
      }
    }
  };
  // What a command answers (reply, editReply, followUp), run with a pretend interaction in `lang`. The database modules it reads are
  // replaced by giving their functions fixed answers.
  const avatar = () => 'https://cdn.discordapp.com/embed/avatars/1.png';
  const user = { id: '5', username: 'ana', globalName: 'Ana', tag: 'ana', bot: false, createdTimestamp: 0, displayAvatarURL: avatar, avatarURL: avatar, toString: () => '<@5>' };
  const { Collection } = require('discord.js');
  const member = { id: '5', displayName: 'Ana', user, guild, joinedTimestamp: 0, displayAvatarURL: avatar, roles: { cache: new Collection(), highest: { id: '1', name: 'Rol' } }, permissions: { has: () => true }, toString: () => '<@5>' };
  // A server with the caches the template variables read.
  const richGuild = {
    ...guild, memberCount: 50, iconURL: () => null, bannerURL: () => null, createdTimestamp: 0, createdAt: new Date(0), ownerId: '6', emojis: { cache: new Collection() },
    members: { cache: new Collection([['5', member]]), me: guild.members.me },
    roles: { cache: new Collection() }, channels: { cache: new Collection(), fetch: async () => null },
    client: { user: { id: 'bot' }, users: { fetch: async () => null } },
  };
  const runCommand = async (command, options, lang) => {
    const sent = [];
    const interaction = {
      guild: richGuild,
      guildId: guild.id, pettoLang: lang, user: member.user, member, client: { user: { id: 'bot' }, users: { fetch: async () => null } },
      options: { getSubcommand: () => options.sub, getSubcommandGroup: () => null, getString: (key) => options[key] ?? null, getUser: (key) => options[key] ?? null, getInteger: (key) => options[key] ?? null, getChannel: () => null, getRole: () => null, getBoolean: () => null },
      deferReply: async () => {}, reply: async (payload) => sent.push(payload), editReply: async (payload) => sent.push(payload), followUp: async (payload) => sent.push(payload),
    };
    await command.execute(interaction);
    return sent;
  };
  const day = new Date().toISOString();

  // Reaction roles: the buttons Petto puts on a message, one without a label of its own (it shows the role, or "Role").
  const reactionRoles = require('../src/interactions/reactionRoleButton');
  draw('reaction role buttons', (lang) => reactionRoles.buildButtonRows([{ id: 1, interaction_type: 'button', emoji: '🎮', role_id: 'gone', mode: 'toggle', button_label: null }, { id: 2, interaction_type: 'button', emoji: 'label:x', role_id: 'gone', mode: 'add', button_label: null }], { roles: { cache: new Map() } }, lang));

  // Suggestions: the posted card, pending and answered by the staff, with its buttons.
  const suggestionGuild = richGuild;
  const suggestionConfig = { anonymous: false, up_emoji: '👍', down_emoji: '👎', status_colors: true, color_pending: 0x999999, color_approved: 0x00ff00, embed_template: null };
  const suggestionRow = { id: 'abc', number: 7, content: 'Más canales de voz', status: 'pending', author_id: '5', created_at: day, image_url: null };
  await drawAsync('suggestion card', (lang) => suggestions.render(suggestionGuild, suggestionRow, suggestionConfig, { tally: { up: 3, down: 1 }, lang }));
  await drawAsync('answered suggestion card', (lang) => suggestions.render(suggestionGuild, { ...suggestionRow, status: 'approved', status_reason: 'Buena idea', status_by: '5' }, suggestionConfig, { tally: { up: 9, down: 0 }, lang }));
  await drawAsync('anonymous suggestion card', (lang) => suggestions.render(suggestionGuild, suggestionRow, { ...suggestionConfig, anonymous: true }, { tally: { up: 0, down: 0 }, lang }));

  // Confessions: the posted confession with its reply button, and the staff review card in each state.
  const confessionRow = { id: 'c1', number: 4, content: 'Me gusta el servidor', image_url: null };
  // As the database keeps them: the English defaults, shown in the server's language.
  const confessionLook = { ...confessionConfig, title: t('en', 'confessions.default.title'), footer: t('en', 'confessions.default.footer'), allow_replies: true, reply_label: t('en', 'confessions.default.reply.button'), embed_template: null };
  await drawAsync('confession', (lang) => confessions.render(richGuild, confessionRow, confessionLook, { lang }));
  for (const status of ['pending', 'approved', 'rejected']) draw(`confession review card (${status})`, (lang) => confessions.reviewCard(confessionRow, confessionLook, { status, by: '5', lang }));

  // Counting: the settings card the staff reads.
  const countingDb = require('../src/db/counting');
  countingDb.getConfig = async () => ({ enabled: true, channel_id: '9', current_number: 41, high_score: 120, allow_double: false, math: true, reset_on_wrong: true, delete_wrong: false, saves: 1, saves_max: 3, save_every: 100, milestone_every: 0, start_number: 0, react_ok: '✅', react_bad: '❌', react_record: '🏆', record_every: 50, wrong_role_id: '3', wrong_role_minutes: 10, top_role_id: null, alert_seconds: 0 });
  const counting = require('../src/commands/utility/counting');
  await drawAsync('counting settings card', (lang) => runCommand(counting, { sub: 'config' }, lang));

  // Votes: the totals and the ranking.
  const votesDb = require('../src/db/votes');
  votesDb.voteTotals = async () => ({ total: 1520, voters: 300, mine: 4, last: day });
  votesDb.topVoters = async () => [{ user_id: '5', total: 12 }, { user_id: '6', total: 1 }];
  const votes = require('../src/commands/info/votes');
  await drawAsync('votes card', (lang) => runCommand(votes, { sub: 'show' }, lang));
  await drawAsync('votes ranking', (lang) => runCommand(votes, { sub: 'top' }, lang));

  // Partners: every response of the Partner Manager system (the welcome of a new manager included), the stats and the ranking.
  const partnerMessages = require('../src/utils/partnerMessages');
  const partnerCtx = { guild: richGuild, member, user: member.user, channel: { id: '9', name: 'partners' }, partner: { name: 'Otro servidor', members: 120 } };
  for (const key of partnerMessages.RESPONSE_KEYS) await drawAsync(`partner response (${key})`, (lang) => partnerMessages.responsePayload(guild.id, { enabled: true, messages: {} }, key, partnerCtx, lang));
  const partnersDb = require('../src/db/partners');
  partnersDb.getConfig = async () => ({ enabled: true });
  partnersDb.listLog = async () => [{ manager_id: '5', partner_name: null, created_at: day }];
  const partner = require('../src/commands/automation/partner');
  await drawAsync('partner stats', (lang) => runCommand(partner, { sub: 'stats' }, lang));
  await drawAsync('partner ranking', (lang) => runCommand(partner, { sub: 'leaderboard', period: 'week' }, lang));

  // Requests: the card in every state, with its buttons.
  const requestCards = require('../src/utils/requestCards');
  for (const status of ['open', 'claimed', 'done', 'cancelled']) {
    draw(`request card (${status})`, (lang) => requestCards.requestCard({ number: 3, status, user_id: '5', content: 'Un banner nuevo', claimed_by: '6', claimed_at: day, completed_at: day, created_at: day }, lang));
  }

  // Reviews and uploads: what a member sees.
  const reviewsDb = require('../src/db/reviews');
  reviewsDb.getConfig = async () => ({ reviews_enabled: true });
  reviewsDb.listFor = async () => [{ stars: 4, reviewer_id: '6', updated_at: day, comment: 'Muy amable' }, { stars: 5, reviewer_id: '7', updated_at: day, comment: null }];
  const review = require('../src/commands/automation/review');
  await drawAsync('reviews card', (lang) => runCommand(review, { sub: 'show' }, lang));
  const uploadsDb = require('../src/db/uploads');
  uploadsDb.getConfig = async () => ({ enabled: true });
  uploadsDb.listLog = async () => [{ user_id: '5', files: 2, channel_id: '9', created_at: day }];
  const uploads = require('../src/commands/automation/uploads');
  await drawAsync('uploads stats', (lang) => runCommand(uploads, { sub: 'stats' }, lang));
  await drawAsync('uploads ranking', (lang) => runCommand(uploads, { sub: 'leaderboard', period: 'all' }, lang));

  // Tickets: the DM a member gets when their ticket is closed, with the rating and transcript buttons.
  const closer = { toString: () => '<@6>', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/6/a.png' };
  draw('ticket closed DM', (lang) => [cards.buildTicketClosedCard({ ticket: { ticket_number: 12 }, guild, actor: closer, reason: null, channel: { id: '9' }, lang }), cards.buildRatingRow(1), cards.buildTranscriptLinkRow('https://petto.sbs/t/1', lang)]);
  draw('ticket closed DM (closer hidden)', (lang) => cards.buildTicketClosedCard({ ticket: { ticket_number: 12 }, guild: { ...guild, iconURL: () => null }, actor: closer, reason: 'Resuelto', channel: null, hideCloser: true, lang }));

  // Help: the main menu and a category page, with every command loaded.
  const { loadCommands } = require('../src/handlers/commandHandler');
  const helpClient = { user: { id: 'bot', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } };
  loadCommands(helpClient);
  const help = require('../src/commands/utility/help');
  const helpGuild = { ...guild, members: { me: { displayAvatarURL: avatar } } };
  draw('help main menu', (lang) => help.mainView(helpClient, helpGuild, '!', false, lang));
  for (const category of ['moderation', 'utility']) draw(`help category (${category})`, (lang) => help.categoryView(helpClient, helpGuild, category, false, lang));

  // The notices Petto sends to a server's staff channel or its owner, every kind, with details Petto wrote itself (translated) and
  // details from Discord (kept as they are).
  const { renderNotice, TEMPLATES: NOTICE_KINDS } = require('../src/utils/guildOpsAlerts');
  for (const kind of Object.keys(NOTICE_KINDS)) {
    draw(`server notice (${kind})`, (lang) => ({ content: renderNotice({ kind, details: t('en', 'notices.details.permissions'), lang }) }));
  }
  assert.ok(renderNotice({ kind: 'logs', details: 'Missing Access', lang: 'es' }).includes('> Missing Access'), 'details from Discord are shown as they are');
  assert.equal(renderNotice({ kind: 'logs', details: 'x', lang: 'en' }), renderNotice({ kind: 'logs', details: 'x' }), 'English is the default');

  // A few `!<module>config` cards and a generated one.
  const moduleConfig = require('../src/utils/moduleConfig');
  for (const name of ['welcomeconfig', 'counterconfig', 'ticketconfig', 'automodconfig', 'pollconfig', 'banconfig']) {
    const card = helpClient.commands.get(name);
    assert.ok(card?.configModule, `${name} is a config card`);
    await drawAsync(`!${name}`, async (lang) => ({ content: await moduleConfig.buildCardText(card.configModule, { guildId: guild.id, prefix: '!', commands: helpClient.commands, lang }) }));
  }

  const problems = [];
  for (const [name, lang, payload] of drawn) {
    if (lang === 'en') continue;
    const left = englishLeft(payload, lang);
    if (left.length) problems.push(`${name} [${lang}]: ${left.join(', ')}  <- ${texts(payload).join(' | ').slice(0, 400)}`);
  }
  assert.deepEqual(problems, [], `English words left in translated panels:\n${problems.join('\n')}`);
  // The check reads these cards for real: their English drawings are full of the listed words.
  for (const name of ['votes card', 'partner stats', 'reviews card', 'uploads stats', 'request card (open)', 'counting settings card', 'ticket closed DM', 'confession review card (pending)', 'suggestion card', 'help main menu', 'reaction role buttons']) {
    const english = drawn.find(([drawnName, lang]) => drawnName === name && lang === 'en');
    assert.ok(english && englishLeft(english[2]).length, `the English ${name} is drawn and read`);
  }

  // The English defaults the database keeps are shown in the server's language while nobody changed them.
  assert.equal(defaultText('es', 'Manual backup', 'backup.manualLabel'), t('es', 'backup.manualLabel'));
  assert.equal(defaultText('pt-BR', 'Mi copia', 'backup.manualLabel'), 'Mi copia');
  assert.equal(defaultText('en', 'Ticket details', 'tickets.form.defaultTitle'), 'Ticket details');
  assert.match(JSON.stringify(drawn.find(([name, lang]) => name === 'backup panel' && lang === 'es')[2]), new RegExp(t('es', 'backup.scheduledLabel')));

  // Changing the language redraws the standing messages in place: the panels of VoiceMaster, tickets, verification, confessions and
  // honeypots and the running giveaways, each one edited (never posted again), a message of someone else left alone, and a
  // module that fails never stopping the others.
  const { refreshGuildPanels } = require('../src/utils/panelRefresh');
  const edits = [];
  const message = (id, author = 'bot') => ({ id, author: { id: author }, edit: async (payload) => { edits.push([id, payload]); return true; } });
  const messages = { vm: message('vm'), tp: message('tp'), vf: message('vf'), cf: message('cf'), hp: message('hp'), foreign: message('foreign', 'someone') };
  const channel = { isTextBased: () => true, messages: { fetch: async (id) => messages[id] ?? null } };
  const liveGuild = { ...guild, channels: { fetch: async () => channel } };
  stub('src/db/voiceMaster.js', { getConfig: async () => ({ panel_channel_id: 'c', panel_message_id: 'vm' }) });
  stub('src/db/tickets.js', { listPanels: async () => [{ ...wizardPanel, channel_id: 'c', message_id: 'tp' }, { ...wizardPanel, id: 2, channel_id: 'c', message_id: 'foreign' }], listCategories: async () => wizardTypes });
  stub('src/db/verificationConfig.js', { getConfig: async () => ({ panel_channel_id: 'c', panel_message_id: 'vf', method: 'letters' }) });
  stub('src/db/confessions.js', { getConfig: async () => ({ ...confessionConfig, panel_channel_id: 'c', panel_message_id: 'cf' }) });
  stub('src/db/honeypot.js', { listHoneypots: async () => [{ guild_id: guild.id, channel_id: 'c', panel_message_id: 'hp', punishment: 'kick', caught_count: 2, panel_mode: 'default' }] });
  stub('src/db/giveaways.js', { listActiveForGuild: async () => { throw new Error('database down'); } });
  const result = await refreshGuildPanels(liveGuild, 'es');
  assert.deepEqual(result.failed, ['giveaways'], 'a failing module is reported and skipped');
  assert.deepEqual(edits.map(([id]) => id).sort(), ['cf', 'hp', 'tp', 'vf', 'vm'], 'each standing panel is edited, the message of someone else is not');
  assert.equal(result.total, 5);
  const editedVm = JSON.stringify(edits.find(([id]) => id === 'vm')[1]);
  assert.ok(editedVm.includes('Panel del canal de voz') && editedVm.includes('"custom_id":"vc:lock"'), 'the VoiceMaster panel is redrawn in Spanish with the same buttons');
  for (const [id, payload] of edits) assert.deepEqual(englishLeft(payload), [], `the redrawn ${id} panel has no English left`);
  assert.deepEqual(await refreshGuildPanels(null, 'es'), { total: 0, modules: {}, failed: [] }, 'a server the bot is not in has nothing to redraw');

  console.log(`Checked ${drawn.length / LANGUAGES.length} panels and button messages in ${LANGUAGES.join(', ')}, and redrawing them when the language changes.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
