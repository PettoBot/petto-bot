const { Events, AuditLogEvent, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { sendGuildLifecycleLog } = require('../utils/discordOps');
const { createGuildIfMissing } = require('../db/guilds');
const guildDepartures = require('../db/guildDepartures');
const { languageFromLocale, setCachedGuildLanguage, runWithLanguage, t, currentLanguage } = require('../i18n');
const config = require('../config');
const { syncGuildAutoMod } = require('../utils/autoModManager');
const {
  commandMention,
  commandSubcommandMention,
  ensureAdminSetupChannel,
  findPrivateChannel,
  buildAdminSetupMessage,
  buildOwnerGuide,
  sendSetupMessage,
} = require('../utils/onboarding');

// The configured operations channel receives the join event; the shared lifecycle
// helper also mirrors it to the general operations channel.
const OWNER_ID = '293504726505357312';

/** Public-facing thank-you sent to whoever added the bot, no internal server data in it. */
function buildThanksMessage(guildName, setupMention, prefix, lang = currentLanguage()) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t(lang, 'core.join.thanks', { emoji: EMOJI.STAR, server: guildName })),
      new TextDisplayBuilder().setContent(t(lang, 'core.join.howToStart', { setup: setupMention, prefix })),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel(t(lang, 'core.join.website.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs'),
    new ButtonBuilder().setLabel(t(lang, 'core.join.dashboard.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/dash'),
    new ButtonBuilder().setLabel(t(lang, 'core.join.docs.button')).setStyle(ButtonStyle.Link).setURL('https://wiki.petto.sbs'),
    new ButtonBuilder().setLabel(t(lang, 'core.join.support.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/support'),
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
  buildThanksMessage,
  async execute(guild) {
    // Petto is in the server: what is stored for it is not going to be deleted (a server that left and came back in time).
    await guildDepartures.clear(guild.id).catch((err) => logger.warn(`Could not clear the departure of server ${guild.id}: ${err.message}`));
    // First of all, before anything else can make the row: a server Petto never saw starts in the language of its community
    // (es-ES / es-419 -> es, pt-BR -> pt-BR, else en). A server that already has a row keeps its language; `!language` always decides.
    const guildConfig = await createGuildIfMissing(guild.id, { language: languageFromLocale(guild.preferredLocale) })
      .then(({ row }) => row)
      .catch(() => ({ prefix: '!' }));
    if (guildConfig.language) setCachedGuildLanguage(guild.id, guildConfig.language);
    await runWithLanguage(guildConfig.language, () => welcomeGuild(guild, guildConfig));
  },
};

/** The notices of a join: the team log, the setup message for the admins and the DMs to the owner and the inviter. */
async function welcomeGuild(guild, guildConfig) {
  try {
    const [owner, inviter] = await Promise.all([
      guild.fetchOwner().catch(() => null),
      findInviter(guild),
    ]);

    // The notice for the Petto team, in English. i18n-ignore-next-line: team notice
    const content = [
      `**Petto joined a new server.**`, // i18n-ignore: team notice
      `Name: ${guild.name}`, // i18n-ignore: team notice
      `ID: ${guild.id}`,
      `Members: ${guild.memberCount}`, // i18n-ignore: team notice
      `Owner: ${owner ? `${owner.user.tag} (${owner.id})` : 'unknown'}`, // i18n-ignore: team notice
      `Added by: ${inviter ? `${inviter.tag} (${inviter.id})` : 'unknown'}`, // i18n-ignore: team notice
      `Server created: <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, // i18n-ignore: team notice
      'Invite: not created automatically (privacy-safe join handling)', // i18n-ignore: team notice
    ].join('\n');

    await sendGuildLifecycleLog(guild.client, { kind: 'join', guild, ownerId: owner?.id, inviter });

    if (config.automodSyncOnGuildJoin) {
      await syncGuildAutoMod(guild).catch((err) => logger.error(`[AutoMod] Join synchronization failed for guild ${guild.id}:`, err));
    }
    const setupChannel = await ensureAdminSetupChannel(guild).catch((err) => {
      logger.error(`Could not create private setup channel in guild ${guild.id}:`, err);
      return null;
    });
    const setupMention = await commandMention(guild.client, 'setup', guild);
    const reportConfigMention = await commandSubcommandMention(guild.client, 'report', 'config', guild);

    const setupPayload = (options = {}) => buildAdminSetupMessage({
      botId: guild.client.user.id,
      setupMention,
      reportConfigMention,
      prefix: guildConfig.prefix || '!',
      ...options,
    });
    // The private channel is the first choice. When it could not be made (or written to), the setup is never put in a public channel and is not
    // sent to the owner out of the blue: it goes by direct message to whoever added Petto (they asked for it), and if that is not possible
    // to a channel that the whole server cannot see.
    let setupTarget = setupChannel;
    if (setupTarget) {
      const sent = await sendSetupMessage(setupTarget, setupPayload()).catch((err) => {
        logger.error(`Could not send setup welcome message in guild ${guild.id}:`, err);
        return null;
      });
      if (!sent) setupTarget = null;
    }
    if (!setupTarget) {
      const byDm = inviter ? await inviter.send(setupPayload({ dm: true, guildName: guild.name })).then(() => true).catch(() => false) : false;
      if (!byDm) {
        const privateChannel = findPrivateChannel(guild);
        const sent = privateChannel ? await sendSetupMessage(privateChannel, setupPayload({ fallback: true })).catch(() => null) : null;
        if (sent) setupTarget = privateChannel;
      }
    }

    const ownerUser = await guild.client.users.fetch(OWNER_ID).catch(() => null);
    if (ownerUser) await ownerUser.send({ content }).catch(() => {});

    if (owner?.user && setupTarget) {
      await owner.user.send(buildOwnerGuide({ guild, setupChannel: setupTarget, setupMention, prefix: guildConfig.prefix || '!' })).catch(() => {});
    }

    if (inviter && inviter.id !== owner?.id) {
      await inviter.send(buildThanksMessage(guild.name, setupMention, guildConfig.prefix || '!')).catch(() => {});
    }
  } catch (err) {
    logger.error(`guildCreate join notification failed for guild ${guild.id}:`, err);
  }
}
