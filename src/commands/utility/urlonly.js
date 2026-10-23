const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/mediaOnly');
const { parseNetworks } = require('../../utils/mediaOnly');
const { plainCard } = require('../../utils/plainCard');
const { EMOJI } = require('../../utils/emojis');
const { describe, botCanModerate, NETWORK_NAMES, NETWORK_IDS } = require('../../utils/mediaOnlyText');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const say = (interaction, text, ephemeral = false) => interaction.reply({ ...plainCard(text), flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

module.exports = {
  aliases: ['linkonly'],
  data: new SlashCommandBuilder()
    .setName('urlonly')
    .setDescription('Channels where only links (of the sites you choose) can be posted.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Make a channel links only.')
      .addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addStringOption((o) => o.setName('sites').setDescription('youtube, x, instagram, tiktok, pinterest, spotify... or any (default: any)').setMaxLength(200))
      .addBooleanOption((o) => o.setName('caption').setDescription('Allow text with the link (default: yes)')))
    .addSubcommand((s) => s.setName('remove').setDescription('Let a channel receive anything again.').addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(...TEXT_CHANNELS).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('The link channels of this server.'))
    .addSubcommand((s) => s.setName('sites').setDescription('The sites a link channel can allow.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (['add', 'remove'].includes(sub) && !manager) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.needManage')}`, true);

    if (sub === 'sites') return say(interaction, `${t(lang, 'mediaonly.sites.title')}\n${NETWORK_IDS.map((id) => `• ${NETWORK_NAMES[id]} (\`${id}\`)`).join('\n')}\n${t(lang, 'mediaonly.sites.any')}`);
    if (sub === 'list') {
      const rules = await db.getRules(interaction.guild.id);
      const lines = [...rules.entries()].filter(([, rule]) => rule.links_enabled).map(([id, rule]) => `<#${id}>: ${describe(lang, rule)}`);
      return say(interaction, lines.length ? `${t(lang, 'mediaonly.list.titleLinks')}\n${lines.join('\n')}` : t(lang, 'mediaonly.list.emptyLinks'));
    }

    const channel = interaction.options.getChannel('channel', true);
    const rules = await db.getRules(interaction.guild.id);
    const current = rules.get(channel.id);
    if (sub === 'remove') {
      if (!current?.links_enabled) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.url.notSet', { channel: `<#${channel.id}>` })}`, true);
      if (current.attachments_enabled) await db.upsertRule(interaction.guild.id, channel.id, { links_enabled: false, networks: [] });
      else await db.removeRule(interaction.guild.id, channel.id);
      return say(interaction, `${EMOJI.APPROVE}  ${t(lang, 'mediaonly.url.removed', { channel: `<#${channel.id}>` })}`);
    }

    const networks = parseNetworks(interaction.options.getString('sites') ?? '');
    if (networks === null) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.url.unknownSite')}`, true);
    if (!botCanModerate(interaction, channel)) return say(interaction, `${EMOJI.DENY}  ${t(lang, 'mediaonly.botNeeds', { channel: `<#${channel.id}>` })}`, true);
    const patch = { links_enabled: true, networks, allow_caption: interaction.options.getBoolean('caption') ?? current?.allow_caption ?? true };
    await db.upsertRule(interaction.guild.id, channel.id, patch);
    return say(interaction, `${EMOJI.APPROVE}  ${t(lang, 'mediaonly.url.added', { channel: `<#${channel.id}>`, rule: describe(lang, { ...db.DEFAULTS, ...current, ...patch }) })}`);
  },
};
