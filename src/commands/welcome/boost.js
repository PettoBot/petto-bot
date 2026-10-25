const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['bst'],
  data: new SlashCommandBuilder()
    .setName('boost')
    .setDescription('Configure server boost announcement messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the channel and message sent for every individual boost.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel boost messages are posted to').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_boostcount})').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('level-up')
        .setDescription('Set the message sent when the server reaches a new boost level.')
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports {server_boostlevel}, {server_boostcount})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current boost configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test boost message using your own account.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off boost announcements.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'level-up') return levelUp(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'test') return test(interaction);
    return disable(interaction);
  },
};

async function validateEmbed(interaction, embed, lang) {
  if (!embed) return true;
  if (await getTemplate(interaction.guild.id, embed)) return true;
  await interaction.reply({ content: t(lang, 'welcome.common.noEmbed', { name: embed, command: '!embed create' }), flags: MessageFlags.Ephemeral });
  return false;
}

async function setup(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel', true);
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');
  if (!(await validateEmbed(interaction, embed, lang))) return;

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { boost_channel_id: channel.id, boost_message: message ?? null, boost_embed_template: embed ?? null });

  const detail = embed ? t(lang, 'welcome.common.embed', { name: embed }) : message ? t(lang, 'welcome.common.message', { message }) : t(lang, 'welcome.common.nothingYet', { emoji: EMOJI.ALERT });
  const text = `${t(lang, 'welcome.boost.setup.done', { emoji: EMOJI.APPROVE, channel: `${channel}` })}\n${detail}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function levelUp(interaction) {
  const lang = await languageOf(interaction);
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');
  if (!(await validateEmbed(interaction, embed, lang))) return;

  const existing = await getConfig(interaction.guild.id);
  if (!existing?.boost_channel_id) {
    await interaction.reply({ content: t(lang, 'welcome.boost.levelUp.needChannel'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await upsertConfig(interaction.guild.id, { boost_level_message: message ?? null, boost_level_embed_template: embed ?? null });

  const detail = embed ? t(lang, 'welcome.common.embed', { name: embed }) : message ? t(lang, 'welcome.common.message', { message }) : t(lang, 'welcome.boost.levelUp.nothing', { emoji: EMOJI.ALERT });
  const text = `${t(lang, 'welcome.boost.levelUp.done', { emoji: EMOJI.APPROVE, channel: `<#${existing.boost_channel_id}>` })}\n${detail}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    t(lang, 'welcome.common.status.channel', { value: config?.boost_channel_id ? `<#${config.boost_channel_id}>` : t(lang, 'welcome.common.notSet') }),
    t(lang, 'welcome.boost.status.perBoostEmbed', { value: config?.boost_embed_template ? `\`${config.boost_embed_template}\`` : t(lang, 'welcome.common.none.embed') }),
    t(lang, 'welcome.boost.status.perBoostMessage', { value: config?.boost_message ? config.boost_message : t(lang, 'welcome.common.none.message') }),
    t(lang, 'welcome.boost.status.levelUpEmbed', { value: config?.boost_level_embed_template ? `\`${config.boost_level_embed_template}\`` : t(lang, 'welcome.common.none.embed') }),
    t(lang, 'welcome.boost.status.levelUpMessage', { value: config?.boost_level_message ? config.boost_level_message : t(lang, 'welcome.common.none.message') }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const lang = await languageOf(interaction);
  const config = await getConfig(interaction.guild.id);
  if (!config?.boost_channel_id || (!config.boost_message && !config.boost_embed_template)) {
    await interaction.reply({ content: t(lang, 'welcome.boost.notConfigured'), flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild.channels.fetch(config.boost_channel_id).catch(() => null);
  if (!channel) {
    await interaction.reply({ content: t(lang, 'welcome.boost.channelGone'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await sendMemberEvent({
    guild: interaction.guild,
    channel,
    kind: 'boost',
    messageText: config.boost_message,
    embedTemplateName: config.boost_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel },
    lang,
  });
  await interaction.editReply({ content: t(lang, 'welcome.boost.testSent', { emoji: EMOJI.APPROVE, channel: `${channel}` }) });
}

async function disable(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { boost_channel_id: null });
  await interaction.editReply({ components: [textCard(t(lang, 'welcome.boost.disabled', { emoji: EMOJI.APPROVE }))], flags: MessageFlags.IsComponentsV2 });
}
