// The voter role: given when a vote arrives and kept afterwards.
const config = require('../config');
const logger = require('./logger');

/** The server that holds the voter role: the one of the vote channel, or any server where the role exists. */
async function roleGuild(client) {
  if (!config.voteRoleId) return null;
  if (config.voteChannelId) {
    const channel = await client.channels.fetch(config.voteChannelId).catch(() => null);
    if (channel?.guild) return channel.guild;
  }
  return client.guilds.cache.find((guild) => guild.roles.cache.has(config.voteRoleId)) ?? null;
}

async function grantVoteRole(client, userId) {
  const guild = await roleGuild(client);
  if (!guild) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.has(config.voteRoleId)) return Boolean(member);
  await member.roles.add(config.voteRoleId, 'Voted for Petto on top.gg').catch((err) => logger.warn('Could not give the voter role:', err.message));
  return true;
}

module.exports = { grantVoteRole };
