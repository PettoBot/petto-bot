const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { isPettoOperator } = require('../../utils/autoModControl');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { sendGuildNotice, TEMPLATES } = require('../../utils/guildOpsAlerts');
const {
  clearGuildComplianceRuntimeState,
  scanGuildForCompliance,
} = require('../../utils/guildComplianceDetector');
const {
  getGuildComplianceSettings,
  setGuildComplianceIgnored,
} = require('../../db/guildComplianceSettings');
const logger = require('../../utils/logger');

const SNOWFLAKE_RE = /^\d{15,25}$/;
const CONTROL_TYPES = ['scan', 'ignore', 'unignore', 'status'];
const TYPES = [...Object.keys(TEMPLATES), ...CONTROL_TYPES];

module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('guildsend')
    .setDescription('Private support control: send notices and manage guild diagnostics.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('guild_id')
      .setDescription('Discord server ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('type')
      .setDescription(`Type: ${TYPES.join(', ')}`)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('details')
      .setDescription('Optional notice context or ignore reason.')),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) {
      return reply(interaction, `${EMOJI.DENY} This private support control is not available to this account.`, 0xfe6465);
    }

    const supportGuildId = await resolveSupportGuildId(interaction.client);
    if (!supportGuildId || interaction.guildId !== supportGuildId) {
      return reply(interaction, `${EMOJI.DENY} This control can only be used in Petto's official support server.`, 0xfe6465);
    }

    const guildId = interaction.options.getString('guild_id', true).trim();
    const kind = interaction.options.getString('type', true).trim().toLowerCase();
    const details = interaction.options.getString('details', false)?.trim() || null;

    if (!SNOWFLAKE_RE.test(guildId)) {
      return reply(interaction, `${EMOJI.WARNING} Use a valid Discord server ID.`, 0xfed53c);
    }
    if (!TYPES.includes(kind)) {
      return reply(interaction, `${EMOJI.WARNING} Unknown type. Use: \`${TYPES.join('`, `')}\`.`, 0xfed53c);
    }

    const guild = await resolveGuild(interaction.client, guildId);
    if (!guild) {
      return reply(interaction, `${EMOJI.DENY} Petto is not currently in a server with ID \`${guildId}\`.`, 0xfe6465);
    }

    if (kind === 'ignore' || kind === 'unignore') {
      const ignored = kind === 'ignore';
      const settings = await setGuildComplianceIgnored(guildId, ignored, {
        userId: interaction.user.id,
        reason: ignored ? details : null,
      });
      clearGuildComplianceRuntimeState(guildId);

      logger.info(
        { guildId, action: `guild-compliance-${kind}`, userId: interaction.user.id },
        `Guild compliance monitor ${ignored ? 'ignored' : 're-enabled'} for ${guild.name}.`,
      );

      return reply(
        interaction,
        ignored
          ? `${EMOJI.APPROVE} Automatic compliance alerts are now **ignored** for **${guild.name}** (\`${guildId}\`).${settings.reason ? `\nReason: ${settings.reason}` : ''}`
          : `${EMOJI.APPROVE} Automatic compliance alerts are **enabled again** for **${guild.name}** (\`${guildId}\`).`,
        0xa5ea7a,
      );
    }

    if (kind === 'status') {
      const settings = await getGuildComplianceSettings(guildId, { refresh: true });
      const lines = [
        `${EMOJI.APPROVE} Compliance-monitor status for **${guild.name}**`,
        `Server: \`${guildId}\``,
        `Automatic alerts: **${settings.ignored ? 'ignored' : 'enabled'}**`,
      ];
      if (settings.ignoredBy) lines.push(`Ignored by: <@${settings.ignoredBy}> (\`${settings.ignoredBy}\`)`);
      if (settings.ignoredAt) lines.push(`Ignored at: ${settings.ignoredAt}`);
      if (settings.reason) lines.push(`Reason: ${settings.reason}`);
      return reply(interaction, lines.join('\n'), settings.ignored ? 0xfed53c : 0xa5ea7a);
    }

    if (kind === 'scan') {
      await interaction.reply({
        components: [textCard(`${EMOJI.WARNING} Running a **read-only** compliance scan for \`${guildId}\`…`, 0xfed53c)],
        flags: MessageFlags.IsComponentsV2,
      });

      const [scan, settings] = await Promise.all([
        scanGuildForCompliance(interaction.client, guildId, {
          force: true,
          source: '!guildsend scan',
          requestedBy: interaction.user.id,
          report: false,
          includeIgnored: true,
        }),
        getGuildComplianceSettings(guildId),
      ]);

      const labels = scan.labels?.length ? scan.labels.slice(0, 6).join(', ') : 'No notable signals';
      const evidence = formatEvidence(scan.evidence);

      return interaction.editReply({
        components: [textCard(
          `${EMOJI.APPROVE} Scan complete for **${guild.name}**.\n`
          + `Monitor: **${settings.ignored ? 'ignored' : 'enabled'}**\n`
          + `Confidence: **${scan.confidence}** • Score: **${scan.score}**\n`
          + `Actionable evidence: **${scan.actionable ? 'yes' : 'no'}**\n`
          + `Signals: ${labels}\n`
          + `${evidence ? `${evidence}\n` : ''}`
          + 'This manual scan is **read-only**: no team alert and no server notice were sent.',
          scan.score >= 10 ? 0xfe6465 : scan.score >= 5 ? 0xfed53c : 0xa5ea7a,
        )],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    await interaction.reply({
      components: [textCard(`${EMOJI.WARNING} Sending **${kind}** notice to \`${guildId}\`…`, 0xfed53c)],
      flags: MessageFlags.IsComponentsV2,
    });

    const result = await sendGuildNotice(interaction.client, {
      guildId,
      kind,
      details,
      source: '!guildsend',
      requestedBy: interaction.user.id,
      force: true,
      teamAlert: TEMPLATES[kind].severity === 'critical',
    });

    if (!result.ok) {
      logger.warn({ guildId, action: 'guildsend', userId: interaction.user.id }, 'Guild notice could not be delivered privately; team alert fallback was attempted.');
      return interaction.editReply({
        components: [textCard(`${EMOJI.WARNING} Petto could not find a safe private delivery route. No public channel was used; the team alert fallback was attempted.`, 0xfed53c)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    const destination = result.deliveryType === 'owner_dm'
      ? 'by DM to the server owner'
      : result.channel
        ? `in <#${result.channel.id}>`
        : 'through a private route';

    logger.info({ guildId, action: 'guildsend', userId: interaction.user.id, deliveryType: result.deliveryType }, `Guild ${kind} notice delivered ${destination}.`);
    return interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE} Notice delivered to **${guild.name}** (\`${guildId}\`) ${destination}.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

async function resolveGuild(client, guildId) {
  return client.guilds.cache.get(String(guildId))
    ?? client.guilds.fetch(String(guildId)).catch(() => null);
}

async function resolveSupportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}

function formatEvidence(evidence) {
  if (!evidence?.content) return null;
  const safe = String(evidence.content)
    .replace(/@/g, '@\u200b')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 350);
  const parts = ['Detected message:'];
  if (evidence.channelId) parts.push(`Channel: <#${evidence.channelId}>`);
  if (evidence.authorId) parts.push(`Author: <@${evidence.authorId}>`);
  parts.push(`> ${safe}`);
  if (evidence.url) parts.push(`Jump: ${evidence.url}`);
  return parts.join('\n');
}

async function reply(interaction, content, color) {
  return interaction.reply({
    components: [textCard(content, color)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}
