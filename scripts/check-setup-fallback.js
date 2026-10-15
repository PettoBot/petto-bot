// Checks where the setup message goes when the private setup channel cannot be made: the system channel, then a public
// channel where Petto can write, then a private one, then nowhere. The database is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

for (const file of ['src/db/guilds.js', 'src/utils/logger.js']) {
  const resolved = require.resolve(path.join(__dirname, '..', file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { ensureGuild() {}, updateGuild() {}, info() {}, warn() {}, error() {} } };
}
const { ChannelType } = require('discord.js');
const { findFallbackChannel, buildAdminSetupMessage } = require('../src/utils/onboarding');

const channel = (id, isPublic, canWrite, rawPosition) => ({ id, type: ChannelType.GuildText, rawPosition, permissionsFor: (who) => ({ has: () => (who === 'everyone' ? isPublic : canWrite) }) });
const guild = (channels, systemChannel = null) => ({ members: { me: {} }, roles: { everyone: 'everyone' }, systemChannel, channels: { cache: new Map(channels.map((entry) => [entry.id, entry])) } });
const priv = channel('private', false, true, 0);
const open = channel('public', true, true, 1);
const locked = channel('locked', true, false, 0);

assert.equal(findFallbackChannel(guild([priv, open, locked])).id, 'public', 'a public channel comes before a private one');
assert.equal(findFallbackChannel(guild([priv, open], open)).id, 'public', 'the system channel is used when Petto can write in it');
assert.equal(findFallbackChannel(guild([priv, locked])).id, 'private', 'a private channel is the last choice');
assert.equal(findFallbackChannel(guild([locked])), null, 'nowhere to write');

const text = (payload) => JSON.stringify(payload.components.map((entry) => entry.toJSON()));
const options = { botId: '1', setupMention: '/setup', reportConfigMention: '/report config', prefix: '!' };
assert.ok(text(buildAdminSetupMessage({ ...options, fallback: true })).includes('could not make its private setup channel'));
assert.ok(!text(buildAdminSetupMessage(options)).includes('could not make'));
// In Spanish the message is Spanish and names the commands with the prefix; /setup stays a slash command.
const spanish = text(buildAdminSetupMessage({ ...options, setupMention: '</setup:1>', reportConfigMention: '</report config:1>', fallback: true, lang: 'es' }));
assert.ok(spanish.includes('Petto no pudo crear su canal privado de configuración'));
assert.ok(spanish.includes('</setup:1>') && spanish.includes('`!report config`') && !spanish.includes('</report config:1>'));
assert.ok(text(buildAdminSetupMessage({ ...options, reportConfigMention: '</report config:1>' })).includes('</report config:1>'), 'English keeps the clickable mention');
console.log('Checked the setup message fallback channels.');
