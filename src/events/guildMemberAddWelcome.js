const { Events, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../db/memberEvents');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const { inviteInfoFor } = require('../utils/inviteContext');
const { holdOrSend } = require('../utils/joinGate');
const logger = require('../utils/logger');

// A welcome that cannot be posted (the channel is gone, or Petto cannot see it or write in it) says so in the log once an hour for each channel.
const noted = new Map(); // `${guild}:${channel}` -> when it was last said
function noteProblem(guildId, channelId, why) {
  const key = `${guildId}:${channelId}`;
  if (Date.now() - (noted.get(key) ?? 0) < 60 * 60_000) return;
  if (noted.size > 500) noted.clear();
  noted.set(key, Date.now());
  logger.warn(`Welcome: could not post in channel ${channelId} of guild ${guildId}: ${why}`); // i18n-ignore: a log line for the operator
}

/** One welcome (the first or the second): its channel, its text or saved design. Whatever goes wrong stays here, so the other welcome still goes out. */
async function postWelcome(member, { channelId, message, template, invite }) {
  try {
    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) { noteProblem(member.guild.id, channelId, 'the channel does not exist any more'); return; } // i18n-ignore: part of a log line for the operator
    const allowed = channel.permissionsFor?.(member.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
    if (allowed === false) { noteProblem(member.guild.id, channelId, 'Petto cannot see the channel or write in it'); return; } // i18n-ignore: part of a log line for the operator

    await sendMemberEvent({
      guild: member.guild,
      channel,
      kind: 'welcome',
      messageText: message,
      embedTemplateName: template,
      ctx: { member, guild: member.guild, channel, invite: await invite() },
    });
  } catch (err) {
    logger.error(`Welcome message failed for ${member.id} in guild ${member.guild.id}:`, err);
  }
}

module.exports = {
  name: Events.GuildMemberAdd,
  // Held until the member accepts the rules (and finishes the onboarding) when the server asked for that, otherwise sent at the join: utils/joinGate.js.
  execute(member) {
    return holdOrSend(member, (joined) => module.exports.send(joined));
  },
  /** The welcome and the second welcome, the first one first. `held` is a member who waited: who invited them was recorded when they joined. */
  async send(member, { held = false } = {}) {
    try {
      const config = await getConfig(member.guild.id);
      let invite = null; // looked at once, and only when there is something to send
      const lookup = async () => (invite ??= { value: await inviteInfoFor(member, { recorded: held }) }).value;

      if (config?.welcome_channel_id) {
        await postWelcome(member, { channelId: config.welcome_channel_id, message: config.welcome_message, template: config.welcome_embed_template, invite: lookup });
      }
      if (config?.welcome_second_enabled && config.welcome_second_channel_id) {
        await postWelcome(member, { channelId: config.welcome_second_channel_id, message: config.welcome_second_message, template: config.welcome_second_embed_template, invite: lookup });
      }
    } catch (err) {
      logger.error(`Welcome message failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
