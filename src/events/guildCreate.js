const { Events, AuditLogEvent, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { sendGuildLifecycleLog } = require('../utils/discordOps');
const { ensureGuild } = require('../db/guilds');
const config = require('../config');
const { syncGuildAutoMod } = require('../utils/autoModManager');
const {
  commandMention,
  commandSubcommandMention,
  ensureAdminSetupChannel,
  buildAdminSetupMessage,
  buildOwnerGuide,
  sendSetupMessage,
} = require('../utils/onboarding');

// The configured operations channel receives the join event; the shared lifecycle
// helper also mirrors it to the general operations channel.
const OWNER_ID = '293504726505357312';

/** Public-facing thank-you sent to whoever added the bot, no internal server data in it. */
function buildThanksMessage(guildName, setupMention, prefix) {
  const container = new ContainerBuilder()
    .setAccentColor(0x4b4f59)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${EMOJI.STAR} **Thanks for adding Petto to ${guildName}!**`),
      new TextDisplayBuilder().setContent(
        `Run ${setupMention} in the server to open the visual setup, or use \`${prefix}help\` to browse the prefix commands.`,
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

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    try {
      const [owner, inviter] = await Promise.all([
        guild.fetchOwner().catch(() => null),
        findInviter(guild),
      ]);

      const content = [
        `**Petto joined a new server.**`,
        `Name: ${guild.name}`,
        `ID: ${guild.id}`,
        `Members: ${guild.memberCount}`,
        `Owner: ${owner ? `${owner.user.tag} (${owner.id})` : 'unknown'}`,
        `Added by: ${inviter ? `${inviter.tag} (${inviter.id})` : 'unknown'}`,
        `Server created: <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
        'Invite: not created automatically (privacy-safe join handling)',
      ].join('\n');

      await sendGuildLifecycleLog(guild.client, { kind: 'join', guild, ownerId: owner?.id, inviter });

      const guildConfig = await ensureGuild(guild.id).catch(() => ({ prefix: '!' }));
      if (config.automodSyncOnGuildJoin) {
        await syncGuildAutoMod(guild).catch((err) => logger.error(`[AutoMod] Join synchronization failed for guild ${guild.id}:`, err));
      }
      const setupChannel = await ensureAdminSetupChannel(guild).catch((err) => {
        logger.error(`Could not create private setup channel in guild ${guild.id}:`, err);
        return null;
      });
      const setupMention = await commandMention(guild.client, 'setup', guild);
      const reportConfigMention = await commandSubcommandMention(guild.client, 'report', 'config', guild);

      if (setupChannel) {
        await sendSetupMessage(setupChannel, buildAdminSetupMessage({
          botId: guild.client.user.id,
          setupMention,
          reportConfigMention,
          prefix: guildConfig.prefix || '!',
        })).catch((err) => {
          logger.error(`Could not send setup welcome message in guild ${guild.id}:`, err);
        });
      }

      const ownerUser = await guild.client.users.fetch(OWNER_ID).catch(() => null);
      if (ownerUser) await ownerUser.send({ content }).catch(() => {});

      if (owner?.user && setupChannel) {
        await owner.user.send(buildOwnerGuide({ guild, setupChannel, setupMention, prefix: guildConfig.prefix || '!' })).catch(() => {});
      }

      if (inviter && inviter.id !== owner?.id) {
        await inviter.send(buildThanksMessage(guild.name, setupMention, guildConfig.prefix || '!')).catch(() => {});
      }
    } catch (err) {
      logger.error(`guildCreate join notification failed for guild ${guild.id}:`, err);
    }
  },
};
