// Checks `/support`: the card has the invitation of the support server in every language, the command is a slash command, and the message of a new
// server points to it (and to the other commands as slash commands, with the avatar Petto has in the server as its face).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const support = require('../src/commands/info/support');
const { SUPPORT_URL } = require('../src/utils/links');
const { collectCommandData, collectGuildCommandData } = require('../src/handlers/commandHandler');
const { buildAdminSetupMessage, buildOwnerGuide, botAvatarUrl } = require('../src/utils/onboarding');

const json = (value) => JSON.stringify(value.components.map((component) => component.toJSON()));
assert.equal(SUPPORT_URL, 'https://petto.sbs/support');
for (const lang of ['en', 'es', 'pt-BR']) {
  const card = json(support.buildSupportCard(lang));
  assert.ok(card.includes(`"url":"${SUPPORT_URL}"`), `${lang}: the button opens the invitation`);
  assert.ok(!card.includes('{emoji}'), `${lang}: nothing is left unfilled`);
}
assert.ok(json(support.buildSupportCard('es')).includes('servidor de soporte'), 'Spanish card');

// They are slash commands of the second set (registered in each server), so the 100 global slots stay free.
const global = collectCommandData().map((command) => command.name);
const perServer = collectGuildCommandData().map((command) => command.name);
assert.ok(perServer.includes('support') && perServer.includes('language'), '/support and /language are slash commands in each server');
assert.ok(!global.includes('support') && !global.includes('language'), 'and they take no global slot');

// The setup message: the support server in its buttons and in its text, slash commands only, and the avatar of Petto in the server.
const message = json(buildAdminSetupMessage({ botId: '1', setupMention: '</setup:1>', reportConfigMention: '</report config:1>', prefix: '!', avatarUrl: 'https://cdn.discordapp.com/guilds/1/users/2/avatars/xmas.png', mentions: { support: '</support:9>' }, lang: 'en' }));
assert.ok(message.includes(`"url":"${SUPPORT_URL}"`) && message.includes('</support:9>'), 'the support server is in the setup message');
assert.ok(message.includes('xmas.png') && !message.includes('imgur'), 'the face is the avatar of Petto in the server');
assert.ok(!/`!\w+`/.test(message), 'no prefix command is named');
assert.ok(!/`!\w+`/.test(json(buildOwnerGuide({ guild: { id: '1', name: 'S' }, setupChannel: null, setupMention: '</setup:1>', prefix: '!', lang: 'es' }))), 'nor in the guide of the owner');

// The avatar: the one of Petto in the server first (a Christmas one, for example), else its profile picture.
const asked = [];
assert.equal(botAvatarUrl({ members: { me: { displayAvatarURL: (options) => { asked.push(options); return 'server.png'; } } } }, { user: { displayAvatarURL: () => 'profile.png' } }), 'server.png');
assert.deepEqual(asked[0], { extension: 'png', size: 256 });
assert.equal(botAvatarUrl({ members: { me: null } }, { user: { displayAvatarURL: () => 'profile.png' } }), 'profile.png');
assert.equal(botAvatarUrl(null, null), null);
console.log('Support command checks passed (the card in three languages, the slash commands, the setup message and the avatar of Petto).');
