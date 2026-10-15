const {
  ChannelType,
  PermissionFlagsBits,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { EMOJI } = require('./emojis');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

const SETUP_CHANNEL_NAME = 'petto-setup';
// i18n-ignore-next-line: the topic is how Petto finds its channel again, so it never changes with the language
const SETUP_CHANNEL_TOPIC = 'Petto private administrator setup channel';
const PETTO_IMAGE_URL = 'https://i.imgur.com/WUwcYwM.png';

const MAX_CHANNEL_PERMISSION_OVERWRITES = 100;
// @everyone + owner + Petto are always included. Keep a little headroom so a
// future managed overwrite cannot push channel creation over Discord's limit.
const MAX_SETUP_MANAGE_GUILD_ROLES = MAX_CHANNEL_PERMISSION_OVERWRITES - 5;

function adminRoleOverwrites(guild) {
  // Roles with Administrator already bypass channel permission overwrites, so
  // adding one overwrite per admin role only wastes Discord's 100-overwrite
  // limit. Explicit access is only needed for Manage Server roles that do not
  // also have Administrator. Highest roles win when a huge server has >95.
  return [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id
      && !role.permissions.has(PermissionFlagsBits.Administrator)
      && role.permissions.has(PermissionFlagsBits.ManageGuild))
    .sort((a, b) => b.position - a.position)
    .slice(0, MAX_SETUP_MANAGE_GUILD_ROLES)
    .map((role) => ({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    }));
}

function setupChannelOverwrites(guild, botId) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    ...adminRoleOverwrites(guild),
    {
      id: guild.ownerId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: botId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    },
  ];
}

/** Finds or creates the private channel used for first-run setup and admin guidance. */
async function ensureAdminSetupChannel(guild, lang = currentLanguage()) {
  const guildConfig = await ensureGuild(guild.id);
  const botId = guild.client.user.id;
  let channel = guildConfig.setup_channel_id
    ? await guild.channels.fetch(guildConfig.setup_channel_id).catch(() => null)
    : null;

  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((candidate) => candidate.type === ChannelType.GuildText && candidate.topic === SETUP_CHANNEL_TOPIC) ?? null;
  }

  if (!channel) {
    channel = await guild.channels.create({
      name: SETUP_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: SETUP_CHANNEL_TOPIC,
      permissionOverwrites: setupChannelOverwrites(guild, botId),
      reason: t(lang, 'setup.reason.createChannel'),
    });
  } else {
    // This is a Petto-managed private channel. Replacing the managed overwrite
    // set prevents stale role entries from accumulating until Discord rejects
    // the channel with BASE_TYPE_MAX_LENGTH (>100 overwrites).
    await channel.permissionOverwrites.set(
      setupChannelOverwrites(guild, botId),
      t(lang, 'setup.reason.refreshChannel'),
    ).catch((err) => logger.warn(`Could not refresh setup channel permissions in ${guild.id}:`, err.message));
  }

  if (guildConfig.setup_channel_id !== channel.id) {
    await updateGuild(guild.id, { setup_channel_id: channel.id }).catch((err) => {
      // The channel is still usable if an older database has not run the new
      // nullable column migration yet. The topic lets the next run find it.
      logger.warn(`Could not persist setup channel for ${guild.id}:`, err.message);
    });
  }

  return channel;
}

/**
 * A channel to send the setup message to when the private one could not be made: the system channel, then a public text channel
 * where Petto can write, then any text channel where it can (a private one). Null when there is none.
 */
function findFallbackChannel(guild) {
  const me = guild.members.me;
  if (!me) return null;
  const canWrite = (channel) => channel.type === ChannelType.GuildText
    && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
  const isPublic = (channel) => channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
  const texts = [...guild.channels.cache.values()].filter(canWrite).sort((a, b) => a.rawPosition - b.rawPosition);
  const system = guild.systemChannel && canWrite(guild.systemChannel) ? guild.systemChannel : null;
  return system ?? texts.find(isPublic) ?? texts[0] ?? null;
}

async function commandMention(client, commandName, guild = null) {
  try {
    const commands = guild?.commands
      ? await guild.commands.fetch().catch(() => null)
      : await client.application?.commands?.fetch();
    const command = commands?.find((item) => item.name === commandName);
    return command ? `</${commandName}:${command.id}>` : `/${commandName}`;
  } catch {
    return `/${commandName}`;
  }
}

async function commandSubcommandMention(client, commandName, subcommandName, guild = null) {
  const mention = await commandMention(client, commandName, guild);
  const commandPrefix = `</${commandName}:`;
  if (!mention.startsWith(commandPrefix)) return `/${commandName} ${subcommandName}`;
  return `</${commandName} ${subcommandName}:${mention.slice(commandPrefix.length)}`;
}

function buildAdminSetupMessage({ botId, setupMention, reportConfigMention, prefix, fallback = false, lang = currentLanguage() }) {
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot%20applications.commands`;
  const intro = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'setup.intro')))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(t(lang, 'setup.invite.button'))
          .setEmoji({ name: 'petto', id: '1542559402983428368' })
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl),
        new ButtonBuilder().setLabel(t(lang, 'setup.docs.button')).setStyle(ButtonStyle.Link).setURL('https://wiki.petto.sbs/overview/introduction'),
        new ButtonBuilder().setLabel(t(lang, 'setup.web.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/'),
      ),
    );

  // `/report config` is a slash mention in English; Spanish and Portuguese name commands with the prefix (`!report config`).
  const reportConfig = lang === 'en' ? reportConfigMention : `\`${prefix}report config\``; // i18n-ignore: a command name
  const setup = new ContainerBuilder().addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          t(lang, 'setup.admin.heading'),
          '',
          fallback ? t(lang, 'setup.admin.welcomeFallback', { emoji: EMOJI.RELEASE_MAGIC }) : t(lang, 'setup.admin.welcome', { emoji: EMOJI.RELEASE_MAGIC }),
          fallback ? t(lang, 'setup.admin.fallbackNote') : t(lang, 'setup.admin.privateNote'),
          '',
          t(lang, 'setup.admin.openSetup', { setup: setupMention }),
          t(lang, 'setup.admin.help', { prefix }),
          t(lang, 'setup.admin.detailed', { prefix }),
          ...(fallback ? [] : [t(lang, 'setup.admin.doNotShare')]),
          t(lang, 'setup.admin.reports', { reportConfig }),
        ].join('\n')),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(PETTO_IMAGE_URL)),
  );

  return { components: [intro, setup], flags: MessageFlags.IsComponentsV2 };
}

function buildOwnerGuide({ guild, setupChannel, setupMention, prefix, lang = currentLanguage() }) {
  const container = new ContainerBuilder()
    .setAccentColor(0x4b4f59)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(t(lang, 'core.join.thanks', { emoji: EMOJI.STAR, server: guild.name })),
      new TextDisplayBuilder().setContent(t(lang, 'setup.owner.howToStart', { prefix })),
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel(t(lang, 'core.join.website.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs'),
    new ButtonBuilder().setLabel(t(lang, 'core.join.dashboard.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/dash'),
    new ButtonBuilder().setLabel(t(lang, 'core.join.docs.button')).setStyle(ButtonStyle.Link).setURL('https://wiki.petto.sbs'),
    new ButtonBuilder().setLabel(t(lang, 'core.join.support.button')).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/support'),
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

async function sendSetupMessage(channel, payload) {
  return channel.send(payload);
}

module.exports = {
  SETUP_CHANNEL_TOPIC,
  ensureAdminSetupChannel,
  findFallbackChannel,
  commandMention,
  commandSubcommandMention,
  buildAdminSetupMessage,
  buildOwnerGuide,
  sendSetupMessage,
};
