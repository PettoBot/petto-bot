const {
  ChannelType,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const SETUP_CHANNEL_NAME = 'petto-setup';
const SETUP_CHANNEL_TOPIC = 'Petto private administrator setup channel';
const SETUP_DELETE_AFTER_MS = 120_000;

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

function buildAdminSetupMessage({ setupMention, prefix }) {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${EMOJI.STAR} **Welcome to Petto's admin setup channel!**`),
      new TextDisplayBuilder().setContent([
        'This private channel is visible to server administrators and Petto.',
        '',
        `• Open ${setupMention} to configure the server in one form.`,
        `• Use \`${prefix}help\` to browse Petto's prefix commands.`,
        `• Use \`${prefix}logs\`, \`${prefix}automod\`, and \`${prefix}welcome\` for detailed settings.`,
        '• Do not share this channel with regular members or other bots.',
      ].join('\n')),
    );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildOwnerGuide({ guild, setupChannel, setupMention, prefix }) {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${EMOJI.STAR} **Petto is ready in ${guild.name}!**`),
      new TextDisplayBuilder().setContent([
        `I created a private admin channel: <#${setupChannel.id}>`,
        '',
        `Start the visual setup with ${setupMention}.`,
        '',
        '**Useful prefix commands**',
        `• \`${prefix}help\` to browse every command`,
        `• \`${prefix}logs\` to configure audit logs`,
        `• \`${prefix}automod\` to configure anti-spam, anti-raid and filters`,
        `• \`${prefix}welcome\` to configure join messages`,
        `• \`${prefix}lock\` and \`${prefix}unlock\` for channel lockdowns`,
        '',
        'The setup flow uses a Discord command mention. The rest of Petto uses the server prefix.',
      ].join('\n')),
    );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function sendExpiringSetupMessage(channel, payload) {
  const message = await channel.send(payload);
  setTimeout(() => message.delete().catch(() => {}), SETUP_DELETE_AFTER_MS);
  return message;
}

module.exports = {
  SETUP_CHANNEL_TOPIC,
  ensureAdminSetupChannel,
  commandMention,
  buildAdminSetupMessage,
  buildOwnerGuide,
  sendExpiringSetupMessage,
};
