const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { isPettoOperator } = require('../../utils/autoModControl');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { sendGuildNotice, TEMPLATES } = require('../../utils/guildOpsAlerts');
const { scanGuildForCompliance } = require('../../utils/guildComplianceDetector');
const logger = require('../../utils/logger');

const SNOWFLAKE_RE = /^\d{15,25}$/;
const TYPES = [...Object.keys(TEMPLATES), 'scan'];

module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('guildsend')
    .setDescription('Private support control: send an operational notice to one Petto server.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('guild_id')
      .setDescription('Discord server ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('type')
      .setDescription(`Notice type: ${TYPES.join(', ')}`)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('details')
      .setDescription('Optional extra context shown in the notice.')),

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
    if (kind !== 'scan' && !TEMPLATES[kind]) {
      return reply(interaction, `${EMOJI.WARNING} Unknown notice type. Use: \`${TYPES.join('`, `')}\`.`, 0xfed53c);
    }

    if (kind === 'scan') {
      await interaction.reply({
        components: [textCard(`${EMOJI.WARNING} Scanning \`${guildId}\` for guild-compliance signals…`, 0xfed53c)],
        flags: MessageFlags.IsComponentsV2,
      });

      const scan = await scanGuildForCompliance(interaction.client, guildId, {
        force: true,
        source: '!guildsend scan',
        requestedBy: interaction.user.id,
      });

      if (!scan.guild) {
        return interaction.editReply({
          components: [textCard(`${EMOJI.DENY} Petto is not currently in a server with ID \`${guildId}\`.`, 0xfe6465)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const labels = scan.labels?.length ? scan.labels.slice(0, 6).join(', ') : 'No notable signals';
      return interaction.editReply({
        components: [textCard(
          `${EMOJI.APPROVE} Scan complete for **${scan.guild.name}**.\n`
          + `Confidence: **${scan.confidence}** • Score: **${scan.score}**\n`
          + `Signals: ${labels}\n`
          + `Team alert: **${scan.teamAlerted ? 'sent' : 'not needed'}** • Server notice: **${scan.noticeSent ? 'sent' : 'not sent'}**`,
          scan.score >= 8 ? 0xfe6465 : scan.score >= 5 ? 0xfed53c : 0xa5ea7a,
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

    if (!result.guild) {
      return interaction.editReply({
        components: [textCard(`${EMOJI.DENY} Petto is not currently in a server with ID \`${guildId}\`.`, 0xfe6465)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    if (!result.ok) {
      logger.warn({ guildId, action: 'guildsend', userId: interaction.user.id }, 'Guild notice could not be delivered; team alert fallback was attempted.');
      return interaction.editReply({
        components: [textCard(`${EMOJI.WARNING} Petto could not find a channel where it can send the notice. The team alert fallback was attempted.`, 0xfed53c)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    logger.info({ guildId, action: 'guildsend', userId: interaction.user.id }, `Guild ${kind} notice delivered in channel ${result.channel.id}.`);
    return interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE} Notice delivered to **${result.guild.name}** (\`${guildId}\`) in <#${result.channel.id}>.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

async function resolveSupportGuildId(client) {
  if (config.supportGuildId) return config.supportGuildId;
  const joinLog = await client.channels.fetch(config.opsChannels?.joinLog).catch(() => null);
  return joinLog?.guildId ?? null;
}

async function reply(interaction, content, color) {
  return interaction.reply({
    components: [textCard(content, color)],
    flags: MessageFlags.IsComponentsV2,
  });
}
