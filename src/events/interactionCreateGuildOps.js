const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const { isPettoOperator } = require('../utils/autoModControl');
const { sendGuildNotice, TEMPLATES } = require('../utils/guildOpsAlerts');
const logger = require('../utils/logger');

const NOTICE_PREFIX = 'gops_notice:';
const PREPARE_PREFIX = 'gops_leave_prepare:';
const CONFIRM_PREFIX = 'gops_leave_confirm:';
const CANCEL_PREFIX = 'gops_leave_cancel:';
const SNOWFLAKE_RE = /^\d{15,25}$/;

const BUTTON_LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const usedButtonLocks = new Map();

function actionLockKey(interaction, group = interaction.customId) {
  return `${interaction.message?.id || 'no-message'}:${group}`;
}

function claimButton(interaction, group = interaction.customId) {
  const now = Date.now();
  if (usedButtonLocks.size > 2_000) {
    for (const [key, createdAt] of usedButtonLocks) {
      if (now - createdAt > BUTTON_LOCK_TTL_MS) usedButtonLocks.delete(key);
    }
  }

  const key = actionLockKey(interaction, group);
  const previous = usedButtonLocks.get(key);
  if (previous && now - previous < BUTTON_LOCK_TTL_MS) return false;
  usedButtonLocks.set(key, now);
  return true;
}

async function disableSourceButton(interaction, replacementLabel = null) {
  const message = interaction.message;
  if (!message?.edit || !Array.isArray(message.components)) return false;

  let changed = false;
  const components = message.components.map((row) => ({
    ...row.toJSON(),
    components: row.components.map((component) => {
      const json = component.toJSON();
      if (json.custom_id !== interaction.customId) return json;
      changed = true;
      return {
        ...json,
        disabled: true,
        ...(replacementLabel ? { label: replacementLabel.slice(0, 80) } : {}),
      };
    }),
  }));

  if (!changed) return false;
  return Boolean(await message.edit({ components }).catch(() => null));
}

async function rejectAlreadyUsed(interaction) {
  await interaction.reply({
    content: 'This control was already used and is locked for safety.',
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    const customId = interaction.customId;
    const isGuildOpsButton = customId.startsWith(NOTICE_PREFIX)
      || customId.startsWith(PREPARE_PREFIX)
      || customId.startsWith(CONFIRM_PREFIX)
      || customId.startsWith(CANCEL_PREFIX);
    if (!isGuildOpsButton) return;

    if (!isPettoOperator(interaction.user?.id)) {
      await interaction.reply({ content: 'This private support control is not available to this account.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const supportGuildId = await resolveSupportGuildId(interaction.client);
    if (!supportGuildId || interaction.guildId !== supportGuildId) {
      await interaction.reply({ content: 'This control can only be used in Petto\'s official support server.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (customId.startsWith(NOTICE_PREFIX)) {
      const payload = customId.slice(NOTICE_PREFIX.length);
      const separator = payload.indexOf(':');
      const kind = separator === -1 ? '' : payload.slice(0, separator);
      const guildId = separator === -1 ? '' : payload.slice(separator + 1);
      if (!TEMPLATES[kind] || !SNOWFLAKE_RE.test(guildId) || guildId === supportGuildId) {
        await interaction.reply({ content: 'Invalid review-notice target.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      if (!claimButton(interaction)) {
        await rejectAlreadyUsed(interaction);
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      await disableSourceButton(interaction, 'Review notice used');
      const result = await sendGuildNotice(interaction.client, {
        guildId,
        kind,
        details: 'The Petto team requested a manual review after an automated guild signal.',
        source: 'team review button',
        requestedBy: interaction.user.id,
        force: true,
        teamAlert: false,
      });

      if (!result.guild) {
        await interaction.editReply({ content: 'Petto is no longer in that server.' }).catch(() => {});
        return;
      }
      if (!result.ok) {
        await interaction.editReply({ content: 'Petto could not find a safe private delivery route. No public channel was used.' }).catch(() => {});
        return;
      }

      const destination = result.deliveryType === 'owner_dm'
        ? 'by DM to the server owner'
        : result.channel
          ? `in <#${result.channel.id}>`
          : 'through a private route';
      logger.info({ guildId, action: 'guildops-review-notice', userId: interaction.user.id, deliveryType: result.deliveryType }, `Review notice delivered ${destination}.`);
      await interaction.editReply({ content: `Review notice delivered to **${result.guild.name}** ${destination}.` }).catch(() => {});
      return;
    }

    const prefix = customId.startsWith(PREPARE_PREFIX)
      ? PREPARE_PREFIX
      : customId.startsWith(CONFIRM_PREFIX)
        ? CONFIRM_PREFIX
        : CANCEL_PREFIX;
    const guildId = customId.slice(prefix.length);
    if (!SNOWFLAKE_RE.test(guildId) || guildId === supportGuildId) {
      await interaction.reply({ content: 'Invalid or protected server target.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (prefix === CANCEL_PREFIX) {
      if (!claimButton(interaction, 'leave-confirmation')) {
        await rejectAlreadyUsed(interaction);
        return;
      }
      await interaction.update({ content: 'Leave action cancelled. This confirmation is now locked.', components: [] }).catch(() => {});
      return;
    }

    const target = interaction.client.guilds.cache.get(guildId)
      ?? await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!target) {
      await interaction.reply({ content: 'Petto is no longer in that server.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (prefix === PREPARE_PREFIX) {
      if (!claimButton(interaction)) {
        await rejectAlreadyUsed(interaction);
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      await disableSourceButton(interaction, 'Leave action opened');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CONFIRM_PREFIX}${guildId}`).setLabel('Confirm leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${CANCEL_PREFIX}${guildId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({
        content: `Confirm that Petto should leave **${target.name}** (\`${guildId}\`). This action immediately disconnects Petto from that server.`,
        components: [row],
      }).catch(() => {});
      return;
    }

    if (!claimButton(interaction, 'leave-confirmation')) {
      await rejectAlreadyUsed(interaction);
      return;
    }

    const targetName = target.name || 'Unknown server';
    // Acknowledge and remove the confirmation controls before the destructive action
    // so a second click cannot race the first one.
    await interaction.update({
      content: `Leaving **${targetName}** (\`${guildId}\`)…`,
      components: [],
    }).catch(() => {});

    try {
      await target.leave();
      logger.info({ guildId, action: 'guildops-leave', userId: interaction.user.id }, `Petto left ${targetName} after team confirmation.`);
      await interaction.editReply({ content: `Petto left **${targetName}** (\`${guildId}\`).`, components: [] }).catch(() => {});
    } catch (error) {
      logger.error({ guildId, action: 'guildops-leave', userId: interaction.user.id }, 'GuildOps leave button failed:', error);
      await interaction.editReply({ content: `Petto could not leave **${targetName}** right now. The confirmation remains locked for safety.`, components: [] }).catch(() => {});
    }
  },
};

async function resolveSupportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}
