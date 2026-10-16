// Audit-log configuration and webhook management for a guild.
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
const { t, languageOf } = require('../../i18n');

const COLOR = 0x4b4f59;
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
            .addChoices({ name: 'all', value: 'all' }, ...EVENTS.map((e) => ({ name: e, value: e }))),
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
    const lang = await languageOf(interaction);
    const guildId = interaction.guild.id;
    await ensureGuild(guildId);

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (!group && sub === 'view') {
      const config = await getLogConfig(guildId);

      if (!config.entries.length) {
        await interaction.reply({
          embeds: [okEmbed(t(lang, 'config.logs.none', { events: EVENTS.join(', ') }))],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const grouped = {};
      for (const e of config.entries) (grouped[e.channel_id] ??= []).push(e.event);

      const embed = new EmbedBuilder().setColor(COLOR).setTitle(t(lang, 'config.logs.title')).setDescription(t(lang, 'config.logs.perChannel'));
      for (const [channelId, events] of Object.entries(grouped)) {
        embed.addFields({ name: `<#${channelId}>`, value: events.map((e) => `\`${e}\``).join(', '), inline: false });
      }

      if (config.ignored.length) {
        const lines = config.ignored.map((id) =>
          interaction.guild.channels.cache.has(id) ? `<#${id}>` : `<@${id}>`,
        );
        embed.addFields({ name: t(lang, 'config.logs.ignored'), value: lines.join(', '), inline: false });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }
    if (!group && sub === 'add') {
      const channel = interaction.options.getChannel('channel', true);
      const event = interaction.options.getString('event', true);

      if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageWebhooks)) {
        await interaction.reply({ embeds: [errEmbed(t(lang, 'config.logs.needWebhooks'))], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply();

      const config = await getLogConfig(guildId);
      // `all` sends every kind of event to the channel; the ones it already gets are left as they are.
      const wanted = event === 'all' ? EVENTS : [event];
      const missing = wanted.filter((name) => !config.entries.some((e) => e.channel_id === channel.id && e.event === name));
      if (!missing.length) {
        await interaction.editReply({ embeds: [errEmbed(t(lang, 'config.logs.already', { event, channel: `<#${channel.id}>` }))] });
        return;
      }

      if (!config.webhooks.find((w) => w.channel_id === channel.id)) {
        const webhook = await channel
          // i18n-ignore-next-line: the name of Petto's webhook, never translated
          .createWebhook({ name: 'Petto logs', avatar: interaction.client.user.displayAvatarURL({ extension: 'png', size: 256 }) })
          .catch((err) => {
            logger.error('Failed to create log webhook:', err);
            return null;
          });

        if (!webhook) {
          await interaction.editReply({ embeds: [errEmbed(t(lang, 'config.logs.webhookFailed'))] });
          return;
        }

        await upsertWebhook(guildId, channel.id, webhook.id, webhook.token);
      }

      for (const name of missing) await addEntry(guildId, channel.id, name);
      await interaction.editReply({ embeds: [okEmbed(t(lang, 'config.logs.added', { event, channel: `<#${channel.id}>` }))] });
      return;
    }
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
        embeds: [okEmbed(event ? t(lang, 'config.logs.removedEvent', { event, channel: `<#${channel.id}>` }) : t(lang, 'config.logs.removedAll', { channel: `<#${channel.id}>` }))],
      });
      return;
    }
    if (group === 'color') {
      const channel = interaction.options.getChannel('channel', true);

      if (sub === 'list') {
        const config = await getLogConfig(guildId);
        const entries = config.entries.filter((e) => e.channel_id === channel.id);
        if (!entries.length) {
          await interaction.reply({ embeds: [errEmbed(t(lang, 'config.logs.noEvents'))], flags: MessageFlags.Ephemeral });
          return;
        }
        const lines = entries.map((e) => `\`${e.event}\`: ${e.color != null ? `\`#${e.color.toString(16).padStart(6, '0')}\`` : t(lang, 'config.logs.defaultColor')}`);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(t(lang, 'config.logs.colorsTitle', { channel: `<#${channel.id}>` })).setDescription(lines.join('\n'))] });
        return;
      }

      // sub === 'set'
      const event = interaction.options.getString('event', true);
      const colorStr = interaction.options.getString('color', true);
      const color = parseColor(colorStr);

      if (color === null) {
        await interaction.reply({ embeds: [errEmbed(t(lang, 'config.logs.invalidColor'))], flags: MessageFlags.Ephemeral });
        return;
      }

      const updated = await setEntryColor(guildId, channel.id, event, color);
      if (!updated) {
        await interaction.reply({ embeds: [errEmbed(t(lang, 'config.logs.notConfigured', { event, channel: `<#${channel.id}>` }))], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ embeds: [okEmbed(t(lang, 'config.logs.colorSet', { event, channel: `<#${channel.id}>`, color: `#${color.toString(16).padStart(6, '0')}` }))] });
      return;
    }
    if (group === 'ignore') {
      if (sub === 'list') {
        const config = await getLogConfig(guildId);
        if (!config.ignored.length) {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(t(lang, 'config.logs.nothingIgnored'))] });
          return;
        }
        const lines = config.ignored.map((id) => (interaction.guild.channels.cache.has(id) ? `<#${id}> (\`${id}\`)` : `<@${id}> (\`${id}\`)`));
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(t(lang, 'config.logs.ignored')).setDescription(lines.join('\n'))] });
        return;
      }

      // sub === 'toggle'
      const user = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel');

      if ((!user && !channel) || (user && channel)) {
        await interaction.reply({ embeds: [errEmbed(t(lang, 'config.logs.exactlyOne'))], flags: MessageFlags.Ephemeral });
        return;
      }

      const targetId = user?.id ?? channel.id;
      const tag = user ? `<@${targetId}>` : `<#${targetId}>`;
      const nowIgnored = await toggleIgnored(guildId, targetId);

      await interaction.reply({ embeds: [okEmbed(t(lang, nowIgnored ? 'config.logs.nowIgnored' : 'config.logs.noLongerIgnored', { target: tag }))] });
    }
  },
};
