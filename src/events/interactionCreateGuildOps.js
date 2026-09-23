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
const { clearGuildComplianceRuntimeState } = require('../utils/guildComplianceDetector');
const { setGuildComplianceIgnored } = require('../db/guildComplianceSettings');
const logger = require('../utils/logger');

const NOTICE_PREFIX = 'gops_notice:';
const LEAVE_PREPARE_PREFIX = 'gops_leave_prepare:';
const LEAVE_CONFIRM_PREFIX = 'gops_leave_confirm:';
const LEAVE_CANCEL_PREFIX = 'gops_leave_cancel:';
const IGNORE_PREPARE_PREFIX = 'gops_ignore_prepare:';
const IGNORE_CONFIRM_PREFIX = 'gops_ignore_confirm:';
const IGNORE_CANCEL_PREFIX = 'gops_ignore_cancel:';
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
    const isGuildOpsButton = [
      NOTICE_PREFIX,
      LEAVE_PREPARE_PREFIX,
      LEAVE_CONFIRM_PREFIX,
      LEAVE_CANCEL_PREFIX,
      IGNORE_PREPARE_PREFIX,
      IGNORE_CONFIRM_PREFIX,
      IGNORE_CANCEL_PREFIX,
    ].some((prefix) => customId.startsWith(prefix));

    if (!isGuildOpsButton) return;

    if (!isPettoOperator(interaction.user?.id)) {
      await interaction.reply({
        content: 'This private support control is not available to this account.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const supportGuildId = await resolveSupportGuildId(interaction.client);
    if (!supportGuildId || interaction.guildId !== supportGuildId) {
      await interaction.reply({
        content: 'This control can only be used in Petto\'s official support server.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (customId.startsWith(NOTICE_PREFIX)) {
      await handleReviewNotice(interaction, supportGuildId);
      return;
    }

    if (
      customId.startsWith(IGNORE_PREPARE_PREFIX)
      || customId.startsWith(IGNORE_CONFIRM_PREFIX)
      || customId.startsWith(IGNORE_CANCEL_PREFIX)
    ) {
      await handleIgnoreControl(interaction, supportGuildId);
      return;
    }

    await handleLeaveControl(interaction, supportGuildId);
  },
};

async function handleReviewNotice(interaction, supportGuildId) {
  const payload = interaction.customId.slice(NOTICE_PREFIX.length);
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

  logger.info(
    { guildId, action: 'guildops-review-notice', userId: interaction.user.id, deliveryType: result.deliveryType },
    `Review notice delivered ${destination}.`,
  );
  await interaction.editReply({ content: `Review notice delivered to **${result.guild.name}** ${destination}.` }).catch(() => {});
}

async function handleIgnoreControl(interaction, supportGuildId) {
  const prefix = interaction.customId.startsWith(IGNORE_PREPARE_PREFIX)
    ? IGNORE_PREPARE_PREFIX
    : interaction.customId.startsWith(IGNORE_CONFIRM_PREFIX)
      ? IGNORE_CONFIRM_PREFIX
      : IGNORE_CANCEL_PREFIX;

  const guildId = interaction.customId.slice(prefix.length);
  if (!SNOWFLAKE_RE.test(guildId) || guildId === supportGuildId) {
    await interaction.reply({ content: 'Invalid or protected server target.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (prefix === IGNORE_CANCEL_PREFIX) {
    if (!claimButton(interaction, `ignore-confirmation:${guildId}`)) {
      await rejectAlreadyUsed(interaction);
      return;
    }
    await interaction.update({
      content: 'Ignore action cancelled. This confirmation is now locked.',
      components: [],
    }).catch(() => {});
    return;
  }

  const target = interaction.client.guilds.cache.get(guildId)
    ?? await interaction.client.guilds.fetch(guildId).catch(() => null);

  if (!target) {
    await interaction.reply({ content: 'Petto is no longer in that server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (prefix === IGNORE_PREPARE_PREFIX) {
    if (!claimButton(interaction)) {
      await rejectAlreadyUsed(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    await disableSourceButton(interaction, 'Ignore action opened');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${IGNORE_CONFIRM_PREFIX}${guildId}`)
        .setLabel('Confirm ignore')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${IGNORE_CANCEL_PREFIX}${guildId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content: `Ignore automatic compliance alerts for **${target.name}** (\`${guildId}\`)? Manual \`!guildsend ... scan\` will still work.`,
      components: [row],
    }).catch(() => {});
    return;
  }

  if (!claimButton(interaction, `ignore-confirmation:${guildId}`)) {
    await rejectAlreadyUsed(interaction);
    return;
  }

  await interaction.update({
    content: `Ignoring automatic compliance alerts for **${target.name}** (\`${guildId}\`)…`,
    components: [],
  }).catch(() => {});

  try {
    await setGuildComplianceIgnored(guildId, true, {
      userId: interaction.user.id,
      reason: 'Ignored from Petto team alert control',
    });
    clearGuildComplianceRuntimeState(guildId);

    logger.info(
      { guildId, action: 'guildops-ignore', userId: interaction.user.id },
      `Automatic compliance alerts ignored for ${target.name}.`,
    );

    await interaction.editReply({
      content: `Automatic compliance alerts are now ignored for **${target.name}** (\`${guildId}\`). Use \`!guildsend ${guildId} unignore\` to re-enable them.`,
      components: [],
    }).catch(() => {});
  } catch (error) {
    logger.error({ guildId, action: 'guildops-ignore', userId: interaction.user.id }, 'Failed to ignore guild compliance alerts:', error);
    await interaction.editReply({
      content: `Could not save the ignore state for **${target.name}**. The confirmation remains locked for safety.`,
      components: [],
    }).catch(() => {});
  }
}

async function handleLeaveControl(interaction, supportGuildId) {
  const prefix = interaction.customId.startsWith(LEAVE_PREPARE_PREFIX)
    ? LEAVE_PREPARE_PREFIX
    : interaction.customId.startsWith(LEAVE_CONFIRM_PREFIX)
      ? LEAVE_CONFIRM_PREFIX
      : LEAVE_CANCEL_PREFIX;

  const guildId = interaction.customId.slice(prefix.length);
  if (!SNOWFLAKE_RE.test(guildId) || guildId === supportGuildId) {
    await interaction.reply({ content: 'Invalid or protected server target.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (prefix === LEAVE_CANCEL_PREFIX) {
    if (!claimButton(interaction, `leave-confirmation:${guildId}`)) {
      await rejectAlreadyUsed(interaction);
      return;
    }
    await interaction.update({
      content: 'Leave action cancelled. This confirmation is now locked.',
      components: [],
    }).catch(() => {});
    return;
  }

  const target = interaction.client.guilds.cache.get(guildId)
    ?? await interaction.client.guilds.fetch(guildId).catch(() => null);

  if (!target) {
    await interaction.reply({ content: 'Petto is no longer in that server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (prefix === LEAVE_PREPARE_PREFIX) {
    if (!claimButton(interaction)) {
      await rejectAlreadyUsed(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    await disableSourceButton(interaction, 'Leave action opened');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${LEAVE_CONFIRM_PREFIX}${guildId}`)
        .setLabel('Confirm leave')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${LEAVE_CANCEL_PREFIX}${guildId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content: `Confirm that Petto should leave **${target.name}** (\`${guildId}\`). This action immediately disconnects Petto from that server.`,
      components: [row],
    }).catch(() => {});
    return;
  }

  if (!claimButton(interaction, `leave-confirmation:${guildId}`)) {
    await rejectAlreadyUsed(interaction);
    return;
  }

  const targetName = target.name || 'Unknown server';
  await interaction.update({
    content: `Leaving **${targetName}** (\`${guildId}\`)…`,
    components: [],
  }).catch(() => {});

  try {
    await target.leave();
    logger.info(
      { guildId, action: 'guildops-leave', userId: interaction.user.id },
      `Petto left ${targetName} after team confirmation.`,
    );
    await interaction.editReply({
      content: `Petto left **${targetName}** (\`${guildId}\`).`,
      components: [],
    }).catch(() => {});
  } catch (error) {
    logger.error({ guildId, action: 'guildops-leave', userId: interaction.user.id }, 'GuildOps leave button failed:', error);
    await interaction.editReply({
      content: `Petto could not leave **${targetName}** right now. The confirmation remains locked for safety.`,
      components: [],
    }).catch(() => {});
  }
}

async function resolveSupportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}
