// Checks where the setup message goes when the private setup channel cannot be made: never a public channel. It goes by direct message
// (the owner, then who added Petto) and only then to a channel that the whole server cannot see. The database is replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

for (const file of ['src/db/guilds.js', 'src/utils/logger.js']) {
  const resolved = require.resolve(path.join(__dirname, '..', file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { ensureGuild() {}, updateGuild() {}, info() {}, warn() {}, error() {} } };
}
const { ChannelType } = require('discord.js');
const { findPrivateChannel, buildAdminSetupMessage } = require('../src/utils/onboarding');

const channel = (id, isPublic, canWrite, rawPosition) => ({ id, type: ChannelType.GuildText, rawPosition, permissionsFor: (who) => ({ has: () => (who === 'everyone' ? isPublic : canWrite) }) });
const guild = (channels, systemChannel = null) => ({ members: { me: {} }, roles: { everyone: 'everyone' }, systemChannel, channels: { cache: new Map(channels.map((entry) => [entry.id, entry])) } });
const priv = channel('private', false, true, 0);
const open = channel('public', true, true, 1);
const locked = channel('locked', true, false, 0);

assert.equal(findPrivateChannel(guild([priv, open, locked])).id, 'private', 'a public channel is never chosen');
assert.equal(findPrivateChannel(guild([priv, open], open)).id, 'private', 'neither is the system channel when it is public');
assert.equal(findPrivateChannel(guild([open, locked])), null, 'with only public channels there is nowhere: the setup was sent by direct message instead');
assert.equal(findPrivateChannel(guild([locked])), null, 'nowhere to write');
assert.equal(findPrivateChannel({ members: { me: null }, channels: { cache: new Map() }, roles: { everyone: 'everyone' } }), null);

const text = (payload) => JSON.stringify(payload.components.map((entry) => entry.toJSON()));
const options = { botId: '1', setupMention: '/setup', reportConfigMention: '/report config', prefix: '!' };
assert.ok(text(buildAdminSetupMessage({ ...options, fallback: true })).includes('could not make its private setup channel'));
assert.ok(!text(buildAdminSetupMessage(options)).includes('could not make'));
// In Spanish the message is Spanish and names the commands with the prefix; /setup stays a slash command.
const spanish = text(buildAdminSetupMessage({ ...options, setupMention: '</setup:1>', reportConfigMention: '</report config:1>', fallback: true, lang: 'es' }));
assert.ok(spanish.includes('Petto no pudo crear su canal privado de configuración'));
assert.ok(spanish.includes('</setup:1>') && spanish.includes('`!report config`') && !spanish.includes('</report config:1>'));
assert.ok(text(buildAdminSetupMessage({ ...options, reportConfigMention: '</report config:1>' })).includes('</report config:1>'), 'English keeps the clickable mention');
// The message that goes by direct message says why, names the server, and does not tell to move it to a private channel.
const dm = text(buildAdminSetupMessage({ ...options, dm: true, guildName: 'Duck' }));
assert.ok(dm.includes('could not make its private setup channel in Duck') && dm.includes('direct message'));
assert.ok(!dm.includes('delete this message') && !dm.includes('Do not share this channel') && !dm.includes('visible to server administrators'));
assert.ok(text(buildAdminSetupMessage({ ...options, dm: true, guildName: 'Duck', lang: 'es' })).includes('mensaje directo'));
assert.ok(text(buildAdminSetupMessage({ ...options, dm: true, guildName: 'Duck', lang: 'pt-BR' })).includes('mensagem direta'));
console.log('Checked where the setup message goes when the private channel cannot be made.');
