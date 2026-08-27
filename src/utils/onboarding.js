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

const SETUP_CHANNEL_NAME = 'petto-setup';
const SETUP_CHANNEL_TOPIC = 'Petto private administrator setup channel';
const PETTO_IMAGE_URL = 'https://i.imgur.com/WUwcYwM.png';

function adminRoleOverwrites(guild) {
  return guild.roles.cache
    .filter((role) => role.id !== guild.id && (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageGuild)))
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
async function ensureAdminSetupChannel(guild) {
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
      reason: 'Petto private administrator onboarding channel',
    });
  } else {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
      SendMessages: false,
      ReadMessageHistory: false,
    }).catch((err) => logger.warn(`Could not refresh setup channel privacy in ${guild.id}:`, err.message));
    await channel.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: true,
    }).catch((err) => logger.warn(`Could not refresh bot access to setup channel in ${guild.id}:`, err.message));
    for (const overwrite of adminRoleOverwrites(guild)) {
      await channel.permissionOverwrites.edit(overwrite.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch((err) => logger.warn(`Could not refresh admin role access to setup channel in ${guild.id}:`, err.message));
    }
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

function buildAdminSetupMessage({ botId, setupMention, reportConfigMention, prefix }) {
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot%20applications.commands`;
  const intro = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        '## What is Petto?',
        '',
        'Petto is a multipurpose Discord bot designed to help communities manage, protect, and improve their servers.',
        '',
        'Petto provides tools for moderation, security, tickets, automation, utilities, and community management, all configurable for different types of servers.',
        '',
        'Server administrators can use Petto to automate repetitive tasks, manage members, protect their community from unwanted activity, and provide a smoother experience for both staff and users.',
      ].join('\n')),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Invite bot')
          .setEmoji({ name: 'petto', id: '1542559402983428368' })
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl),
        new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL('https://wiki.petto.sbs/overview/introduction'),
        new ButtonBuilder().setLabel('Web').setStyle(ButtonStyle.Link).setURL('https://petto.sbs/'),
      ),
    );

  const setup = new ContainerBuilder().addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          '## Petto setup',
          '',
          `${EMOJI.RELEASE_MAGIC} Welcome to Petto's admin setup channel!`,
          'This private channel is visible to server administrators and Petto.',
          '',
          `- Open ${setupMention} to configure the server in one form.`,
          `- Use \`${prefix}help\` to browse Petto's prefix commands.`,
          `- Use \`${prefix}logs\`, \`${prefix}automod\`, and \`${prefix}welcome\` for detailed settings.`,
          '- Do not share this channel with regular members or other bots.',
          `- Use ${reportConfigMention} to configure the reporting system.`,
        ].join('\n')),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(PETTO_IMAGE_URL)),
  );

  return { components: [intro, setup], flags: MessageFlags.IsComponentsV2 };
}

function buildOwnerGuide({ guild, setupChannel, setupMention, prefix }) {
  const container = new ContainerBuilder()
    .setAccentColor(0x4b4f59)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${EMOJI.STAR} **Thanks for adding Petto to ${guild.name}!**`),
      new TextDisplayBuilder().setContent(
        `Run \`${prefix}help\` in the server to see every command, or set everything up from a browser instead with the dashboard.`,
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

async function sendSetupMessage(channel, payload) {
  return channel.send(payload);
}

module.exports = {
  SETUP_CHANNEL_TOPIC,
  ensureAdminSetupChannel,
  commandMention,
  commandSubcommandMention,
  buildAdminSetupMessage,
  buildOwnerGuide,
  sendSetupMessage,
};
