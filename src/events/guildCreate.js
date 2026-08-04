const { Events, AuditLogEvent, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

// Where join notifications go. Hardcoded on purpose (same convention as the team
// roster in petto-web): this is an operational detail for the bot owner, not
// something that should need its own env var on every host.
const LOG_CHANNEL_ID = '1480736317787607090';
const OWNER_ID = '293504726505357312';

/** Public-facing thank-you sent to whoever added the bot, no internal server data in it. */
function buildThanksMessage(guildName) {
  const container = new ContainerBuilder()
    .setAccentColor(0x4b4f59)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${EMOJI.STAR} **Thanks for adding Petto to ${guildName}!**`),
      new TextDisplayBuilder().setContent(
        "Run `/help` in the server to see every command, or set everything up from a browser instead with the dashboard.",
      ),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Website').setStyle(ButtonStyle.Link).setURL('https://petto.sbs'),
    new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL('https://petto.sbs/dash'),
    new ButtonBuilder().setLabel('Docs').setStyle(ButtonStyle.Link).setURL('https://wiki.petto.sbs'),
    new ButtonBuilder().setLabel('Support server').setStyle(ButtonStyle.Link).setURL('https://petto.sbs/support'),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

async function findInviter(guild) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === guild.client.user.id);
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

/** A never-expiring invite, so the join log stays useful even days later when checking whether a server is legit. */
async function createPermanentInvite(guild) {
  const me = guild.members.me;
  if (!me) return null;

  const channel = guild.channels.cache.find(
    (c) => c.type === 0 && c.permissionsFor(me)?.has(['ViewChannel', 'CreateInstantInvite']),
  );
  if (!channel) return null;

  try {
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: 'Join log' });
    return invite.url;
  } catch {
    return null;
  }
}

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    try {
      const [owner, inviter, inviteUrl] = await Promise.all([
        guild.fetchOwner().catch(() => null),
        findInviter(guild),
        createPermanentInvite(guild),
      ]);

      const content = [
        `**Petto joined a new server.**`,
        `Name: ${guild.name}`,
        `ID: ${guild.id}`,
        `Members: ${guild.memberCount}`,
        `Owner: ${owner ? `${owner.user.tag} (${owner.id})` : 'unknown'}`,
        `Added by: ${inviter ? `${inviter.tag} (${inviter.id})` : 'unknown'}`,
        `Server created: <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
        `Invite: ${inviteUrl ?? "couldn't create one, missing permission"}`,
      ].join('\n');

      const logChannel = await guild.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (logChannel) await logChannel.send({ content }).catch((err) => logger.warn('Join log channel send failed:', err.message));

      const ownerUser = await guild.client.users.fetch(OWNER_ID).catch(() => null);
      if (ownerUser) await ownerUser.send({ content }).catch(() => {});

      if (inviter) {
        await inviter.send(buildThanksMessage(guild.name)).catch(() => {});
      }
    } catch (err) {
      logger.error(`guildCreate join notification failed for guild ${guild.id}:`, err);
    }
  },
};
