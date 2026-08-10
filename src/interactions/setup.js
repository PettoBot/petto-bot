const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { getConfig: getMemberConfig, upsertConfig: upsertMemberConfig } = require('../db/memberEvents');
const { upsertConfig: upsertAutomodConfig } = require('../db/automod');
const {
  EVENTS,
  getLogConfig,
  addEntry,
  upsertWebhook,
} = require('../db/logConfig');
const { ensureAdminSetupChannel } = require('../utils/onboarding');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

function selectedChannel(fields, customId) {
  return fields.getSelectedChannels(customId)?.first?.() ?? null;
}

async function configureLogChannel(client, guild, channel) {
  const me = guild.members.me;
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks])) {
    throw new Error(`I need View Channel, Send Messages and Manage Webhooks in <#${channel.id}>.`);
  }

  const config = await getLogConfig(guild.id);
  if (!config.webhooks.some((webhook) => webhook.channel_id === channel.id)) {
    const webhook = await channel.createWebhook({
      name: 'Petto logs',
      avatar: client.user.displayAvatarURL({ extension: 'png', size: 256 }),
      reason: 'Petto all-in-one setup',
    });
    await upsertWebhook(guild.id, channel.id, webhook.id, webhook.token);
  }

  let added = 0;
  for (const event of EVENTS) {
    if (config.entries.some((entry) => entry.channel_id === channel.id && entry.event === event)) continue;
    await addEntry(guild.id, channel.id, event);
    added += 1;
  }
  return added;
}

async function handleSetupModal(interaction) {
  const guild = interaction.guild;
  const fields = interaction.fields;
  const logChannel = selectedChannel(fields, 'setup_log_channel');
  const welcomeChannel = selectedChannel(fields, 'setup_welcome_channel');
  const mode = fields.getRadioGroup('setup_moderation_mode', true);
  const features = [...fields.getStringSelectValues('setup_features')];
  const prefix = fields.getTextInputValue('setup_prefix').trim();

  if (!prefix || prefix.length > 5 || /\s/.test(prefix)) {
    await interaction.reply({ content: 'The prefix must be 1 to 5 characters and cannot contain spaces.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    await ensureGuild(guild.id);
    await updateGuild(guild.id, { prefix });

    const strict = mode === 'strict';
    const disabled = mode === 'disabled';
    await upsertAutomodConfig(guild.id, {
      anti_spam_enabled: !disabled && features.includes('anti-spam'),
      anti_raid_enabled: !disabled && features.includes('anti-raid'),
      raid_action: strict ? 'kick' : 'alert',
      anti_alt_enabled: !disabled && features.includes('anti-alt'),
      anti_alt_action: strict ? 'kick' : 'flag',
    });

    const existingWelcome = await getMemberConfig(guild.id).catch(() => null);
    const welcomeEnabled = features.includes('welcome') && Boolean(welcomeChannel);
    const welcomePatch = { welcome_channel_id: welcomeEnabled ? welcomeChannel.id : null };
    if (welcomeEnabled && !existingWelcome?.welcome_message && !existingWelcome?.welcome_embed_template) {
      welcomePatch.welcome_message = 'Welcome {user.mention} to {server.name}!';
    }
    await upsertMemberConfig(guild.id, welcomePatch);

    let logLine = 'Audit logs were left unchanged.';
    if (features.includes('logs') && logChannel) {
      const added = await configureLogChannel(interaction.client, guild, logChannel);
      logLine = `Audit logs are routed to <#${logChannel.id}> (${added || 'already configured'} event categories).`;
    } else if (features.includes('logs')) {
      logLine = 'Audit logs were not enabled because no log channel was selected.';
    }

    const setupChannel = await ensureAdminSetupChannel(guild);
    const lines = [
      `${EMOJI.APPROVE} **Petto setup saved.**`,
      `**Prefix:** \`${prefix}\``,
      `**Moderation mode:** ${mode}`,
      logLine,
      welcomeEnabled ? `Welcome messages are enabled in <#${welcomeChannel.id}>.` : 'Welcome messages are disabled.',
      `**Setup channel:** <#${setupChannel.id}>`,
      '',
      `Use \`${prefix}help\` for the rest of Petto's prefix commands.`,
    ];

    await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    logger.error(`Petto setup failed in guild ${guild.id}:`, err);
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY} Setup could not be completed: ${err.message}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }
}

module.exports = { handleSetupModal };
