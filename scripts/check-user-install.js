// Checks the install by person ("User Install"): the five commands can be used from a person's own installation (and the rest cannot), where Petto is not a member nothing reads a server,
// the language is the one of the person's Discord, /action goes alone (no counters, no answer button), and /birthday keeps a personal birthday that only its owner sees.
// Discord and the database are replaced: nothing leaves this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) { failed += 1; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); } };

// ---- what Discord is told: which commands can be installed on a person ----
const { collectCommandData, collectGuildCommandData } = require('../src/handlers/commandHandler');
const global = collectCommandData();
const userNames = global.filter((json) => (json.integration_types ?? []).includes(1)).map((json) => json.name).sort();
check('registration: exactly the five commands are available on a person\'s installation', JSON.stringify(userNames) === JSON.stringify(['action', 'avatar', 'banner', 'birthday', 'userinfo']), userNames.join(','));
check('registration: they are also available on a server\'s installation', global.filter((json) => userNames.includes(json.name)).every((json) => json.integration_types.includes(0)));
check('registration: the five are usable in servers, direct messages and group chats', global.filter((json) => userNames.includes(json.name)).every((json) => [0, 1, 2].every((c) => (json.contexts ?? []).includes(c))));
check('registration: every other global command says it is for servers only (so turning User Install on in the portal adds nothing else)', global.filter((json) => !userNames.includes(json.name)).every((json) => JSON.stringify(json.integration_types) === '[0]'), global.filter((json) => !userNames.includes(json.name) && JSON.stringify(json.integration_types) !== '[0]').map((json) => json.name).join(','));
check('registration: the commands of the second set are in a server anyway (no install types)', collectGuildCommandData().every((json) => !json.integration_types || !json.integration_types.includes(1)));
check('registration: the five do not keep the old "no direct messages" mark', global.filter((json) => userNames.includes(json.name)).every((json) => json.dm_permission !== false));

// ---- where Petto is not a member ----
const { outsideServer } = require('../src/utils/userInstall');
check('outside: a direct message', outsideServer({ guildId: null, guild: null }) === true);
check('outside: a server Petto is not in', outsideServer({ guildId: '123', guild: null }) === true);
check('outside: a server of Petto', outsideServer({ guildId: '123', guild: { id: '123' } }) === false);
check('outside: nothing given', outsideServer(null) === false);

const i18n = require('../src/i18n');
check('language: the person\'s Discord language outside a server', i18n.languageFromLocale('es-ES') === 'es');
(async () => {
  const lang = await i18n.languageOf({ guildId: '999', guild: null, locale: 'pt-BR' });
  check('language: a server Petto is not in uses the language of the person', lang === 'pt-BR', lang);
  const dm = await i18n.languageOf({ guildId: null, guild: null, locale: 'es-ES' });
  check('language: a direct message uses the language of the person', dm === 'es', dm);
  const inServer = await i18n.languageOf({ guildId: '555', guild: { id: '555' }, locale: 'es-ES' });
  check('language: a server of Petto keeps the language of the server', inServer === i18n.peekGuildLanguage('555'), inServer);

  // /action outside a server: the sentence and the picture, no counters and no answer button
  const roleplayDb = require('../src/db/roleplayStats');
  let counted = 0;
  roleplayDb.getRoleplayCounter = async () => { counted += 1; return 3; };
  delete require.cache[require.resolve('../src/utils/roleplay')]; // loaded again so it takes the stand-in counter
  const roleplay = require('../src/utils/roleplay');
  const sentPayloads = [];
  const make = (guild) => ({
    id: 'i1', guildId: guild ? 'G' : null, guild, locale: 'en-US', user: { id: 'U1', bot: false, username: 'a', displayName: 'A', displayAvatarURL: () => 'https://cdn/a.png' },
    options: { getSubcommand: () => 'hug', getUser: () => ({ id: 'U2', bot: false, username: 'b', displayName: 'B', displayAvatarURL: () => 'https://cdn/b.png' }) },
    deferReply: async () => {}, editReply: async (payload) => { sentPayloads.push(payload); },
  });
  await roleplay.executeAction(make(null));
  check('action: outside a server it sends the action', sentPayloads.length === 1 && sentPayloads[0].embeds?.length === 1);
  check('action: outside a server there is no answer button and no counter', !sentPayloads[0].components && counted === 0, `counted ${counted}`);
  await roleplay.executeAction(make({ id: 'G' }));
  check('action: in a server of Petto the button and the counter stay', Boolean(sentPayloads[1].components?.length) && counted === 1);

  // /birthday outside a server: a personal birthday, only the person's own
  const personal = require('../src/db/userBirthdays');
  const saved = new Map();
  personal.getPersonalBirthday = async (id) => saved.get(id) ?? null;
  personal.setPersonalBirthday = async (id, value) => { saved.set(id, { year: null, ...value }); return saved.get(id); };
  personal.removePersonalBirthday = async (id) => saved.delete(id);
  const birthday = require('../src/commands/utility/birthday');
  const replies = [];
  const ask = (sub, values = {}, userOption = null) => ({
    guildId: null, guild: null, locale: 'en-US', user: { id: 'U1', toString: () => '<@U1>' },
    options: { getSubcommand: () => sub, getInteger: (name) => values[name] ?? null, getUser: () => userOption },
    reply: async (payload) => { replies.push(payload); },
  });
  await birthday.execute(ask('set', { day: 25, month: 12 }));
  check('birthday: outside a server it saves a personal birthday', saved.get('U1')?.day === 25 && saved.get('U1')?.month === 12);
  check('birthday: the answer is private', Boolean(replies[0].flags & 64));
  await birthday.execute(ask('view'));
  check('birthday: it shows your own', replies.length === 2);
  await birthday.execute(ask('view', {}, { id: 'U2' }));
  check('birthday: it does not show someone else\'s outside a server', replies.length === 3 && JSON.stringify(replies[2]).includes('Outside a server'), JSON.stringify(replies[2]).slice(0, 200));
  await birthday.execute(ask('upcoming'));
  check('birthday: the server parts say they need a server', JSON.stringify(replies[3]).includes('needs a server'));
  await birthday.execute(ask('remove'));
  check('birthday: it forgets it', !saved.has('U1'));

  // ---- where it is all connected ----
  const handler = read('src/events/interactionCreate.js');
  check('handler: nothing of a server Petto is not in is read', /interaction\.guild !== null/.test(handler) && /disabledCheck = interaction\.guildId && interaction\.guild !== null/.test(handler));
  check('hint: no language hint outside a server of Petto', /interaction\.guild === null/.test(read('src/utils/languageHint.js')));
  check('schema: the personal birthday table with row level security', /create table if not exists user_birthdays/i.test(read('src/db/schema.sql')) && /alter table user_birthdays enable row level security/i.test(read('src/db/schema.sql')));
  if (failed) { console.log(`${failed} user-install checks failed`); process.exit(1); }
  console.log('user install checks ok');
})().catch((error) => { console.error(error); process.exit(1); });
