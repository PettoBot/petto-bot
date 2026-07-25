const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const {
  EVENTS,
  getLogConfig,
  addEntry,
  removeEntries,
  setEntryColor,
  upsertWebhook,
  deleteWebhookByChannel,
  toggleIgnored,
} = require('../../db/logConfig');
const logger = require('../../utils/logger');

const COLOR = 0x8399ff;
const OK = 0xa5ea7a;
const ERR = 0xfe6465;

const okEmbed = (text) => new EmbedBuilder().setColor(OK).setDescription(text);
const errEmbed = (text) => new EmbedBuilder().setColor(ERR).setDescription(text);

function parseColor(str) {
  const hex = str?.replace(/^#/, '');
  const n = parseInt(hex, 16);
  return !hex || Number.isNaN(n) || n < 0 || n > 0xffffff ? null : n;
}

/** Deletes the channel's actual Discord webhook (if any) and its DB row. Used when a channel has no entries left. */
async function deleteWebhookForChannel(client, guildId, channelId) {
  const config = await getLogConfig(guildId);
  const wh = config.webhooks.find((w) => w.channel_id === channelId);
  if (!wh) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const hooks = await channel?.fetchWebhooks().catch(() => null);
    const found = hooks?.get(wh.webhook_id);
    if (found) await found.delete().catch(() => {});
  } catch {
    // Channel or webhook already gone — the DB row still needs cleaning up below.
  }

  await deleteWebhookByChannel(guildId, channelId).catch(() => {});
}

module.exports = {
  aliases: ['log'],
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configure the audit-log system (message/member/role/channel/voice/etc. logs).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('view').setDescription('Show the current log configuration.'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Start logging an event category to a channel.')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to send these logs to')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription('Event category')
            .setRequired(true)
            .addChoices(...EVENTS.map((e) => ({ name: e, value: e }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop logging an event category (or everything) in a channel.')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to stop logging to').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('event')
            .setDescription('Event category (omit to remove all events for this channel)')
            .setRequired(false)
            .addChoices(...EVENTS.map((e) => ({ name: e, value: e }))),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('color')
        .setDescription('Override the embed color for a logged event.')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set the embed color for an event in a channel.')
            .addChannelOption((opt) => opt.setName('channel').setDescription('Channel').setRequired(true))
            .addStringOption((opt) =>
              opt
                .setName('event')
                .setDescription('Event category')
                .setRequired(true)
                .addChoices(...EVENTS.map((e) => ({ name: e, value: e }))),
            )
            .addStringOption((opt) => opt.setName('color').setDescription('Hex color, e.g. #ff0000').setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List the configured colors for a channel.')
            .addChannelOption((opt) => opt.setName('channel').setDescription('Channel').setRequired(true)),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('ignore')
        .setDescription('Exclude a user or channel from being logged.')
        .addSubcommand((sub) =>
          sub
            .setName('toggle')
            .setDescription('Toggle ignoring a user or channel.')
            .addUserOption((opt) => opt.setName('user').setDescription('User to ignore/unignore').setRequired(false))
            .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to ignore/unignore').setRequired(false)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List ignored users/channels.')),
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    await ensureGuild(guildId);

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ── /logs view ─────────────────────────────────────────────────────────
    if (!group && sub === 'view') {
      const config = await getLogConfig(guildId);

      if (!config.entries.length) {
        await interaction.reply({
          embeds: [okEmbed(`No log channels configured.\nUse \`/logs add\` to get started.\nEvents: ${EVENTS.join(', ')}`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const grouped = {};
      for (const e of config.entries) (grouped[e.channel_id] ??= []).push(e.event);

      const embed = new EmbedBuilder().setColor(COLOR).setTitle('Log Configuration').setDescription('Events configured per channel:');
      for (const [channelId, events] of Object.entries(grouped)) {
        embed.addFields({ name: `<#${channelId}>`, value: events.map((e) => `\`${e}\``).join(', '), inline: false });
      }

      if (config.ignored.length) {
        const lines = config.ignored.map((id) =>
          interaction.guild.channels.cache.has(id) ? `<#${id}>` : `<@${id}>`,
        );
        embed.addFields({ name: 'Ignored', value: lines.join(', '), inline: false });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ── /logs add ──────────────────────────────────────────────────────────
    if (!group && sub === 'add') {
      const channel = interaction.options.getChannel('channel', true);
      const event = interaction.options.getString('event', true);

      if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageWebhooks)) {
        await interaction.reply({ embeds: [errEmbed('I need **Manage Webhooks** permission in that channel.')], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply();

      const config = await getLogConfig(guildId);
      if (config.entries.some((e) => e.channel_id === channel.id && e.event === event)) {
        await interaction.editReply({ embeds: [errEmbed(`\`${event}\` is already configured for <#${channel.id}>.`)] });
        return;
      }

      if (!config.webhooks.find((w) => w.channel_id === channel.id)) {
        const webhook = await channel
          .createWebhook({ name: 'Petto logs', avatar: interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }) })
          .catch((err) => {
            logger.error('Failed to create log webhook:', err);
            return null;
          });

        if (!webhook) {
          await interaction.editReply({ embeds: [errEmbed('Failed to create webhook. Check my **Manage Webhooks** permission.')] });
          return;
        }

        await upsertWebhook(guildId, channel.id, webhook.id, webhook.token);
      }

      await addEntry(guildId, channel.id, event);
      await interaction.editReply({ embeds: [okEmbed(`\`${event}\` logs will now be sent to <#${channel.id}>.`)] });
      return;
    }

    // ── /logs remove ───────────────────────────────────────────────────────
    if (!group && sub === 'remove') {
      const channel = interaction.options.getChannel('channel', true);
      const event = interaction.options.getString('event');

      await interaction.deferReply();
      await removeEntries(guildId, channel.id, event ?? null);

      const remaining = await getLogConfig(guildId);
      if (!remaining.entries.some((e) => e.channel_id === channel.id)) {
        await deleteWebhookForChannel(interaction.client, guildId, channel.id);
      }

      await interaction.editReply({
        embeds: [okEmbed(event ? `\`${event}\` logs removed from <#${channel.id}>.` : `All logs removed from <#${channel.id}>.`)],
      });
      return;
    }

    // ── /logs color set|list ───────────────────────────────────────────────
    if (group === 'color') {
      const channel = interaction.options.getChannel('channel', true);

      if (sub === 'list') {
        const config = await getLogConfig(guildId);
        const entries = config.entries.filter((e) => e.channel_id === channel.id);
        if (!entries.length) {
          await interaction.reply({ embeds: [errEmbed('No events configured for that channel.')], flags: MessageFlags.Ephemeral });
          return;
        }
        const lines = entries.map((e) => `\`${e.event}\`: ${e.color != null ? `\`#${e.color.toString(16).padStart(6, '0')}\`` : '*Default*'}`);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`Colors - <#${channel.id}>`).setDescription(lines.join('\n'))] });
        return;
      }

      // sub === 'set'
      const event = interaction.options.getString('event', true);
      const colorStr = interaction.options.getString('color', true);
      const color = parseColor(colorStr);

      if (color === null) {
        await interaction.reply({ embeds: [errEmbed('Invalid color. Use `#rrggbb` format.')], flags: MessageFlags.Ephemeral });
        return;
      }

      const updated = await setEntryColor(guildId, channel.id, event, color);
      if (!updated) {
        await interaction.reply({ embeds: [errEmbed(`\`${event}\` is not configured for <#${channel.id}>.`)], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ embeds: [okEmbed(`Color for \`${event}\` in <#${channel.id}> set to \`#${color.toString(16).padStart(6, '0')}\`.`)] });
      return;
    }

    // ── /logs ignore toggle|list ───────────────────────────────────────────
    if (group === 'ignore') {
      if (sub === 'list') {
        const config = await getLogConfig(guildId);
        if (!config.ignored.length) {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription('Nothing is being ignored.')] });
          return;
        }
        const lines = config.ignored.map((id) => (interaction.guild.channels.cache.has(id) ? `<#${id}> (\`${id}\`)` : `<@${id}> (\`${id}\`)`));
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Ignored').setDescription(lines.join('\n'))] });
        return;
      }

      // sub === 'toggle'
      const user = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel');

      if ((!user && !channel) || (user && channel)) {
        await interaction.reply({ embeds: [errEmbed('Provide exactly one of `user` or `channel`.')], flags: MessageFlags.Ephemeral });
        return;
      }

      const targetId = user?.id ?? channel.id;
      const tag = user ? `<@${targetId}>` : `<#${targetId}>`;
      const nowIgnored = await toggleIgnored(guildId, targetId);

      await interaction.reply({ embeds: [okEmbed(nowIgnored ? `${tag} will now be ignored in logs.` : `${tag} is no longer ignored in logs.`)] });
    }
  },
};
