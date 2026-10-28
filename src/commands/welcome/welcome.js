const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { commandRef } = require('../../utils/commandRef');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent, localizeDefaultText, describeMessage, shortMessage } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['wc'],
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure the message sent when a member joins.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the welcome channel and message.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel welcome messages are posted to').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_name})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current welcome configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test welcome message using your own account.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off welcome messages.')),

  // `!welcome setup` takes an embed code as its message, with its line breaks and buttons.
  prefixCodeOptions: { setup: 'message' },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'status') return status(interaction); 
    if (sub === 'test') return test(interaction);
    return disable(interaction);
  },
};

async function setup(interaction) {
  const lang = await languageOf(interaction);
  const channel = interaction.options.getChannel('channel', true);
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');

  if (embed && !(await getTemplate(interaction.guild.id, embed))) {
    await interaction.reply({ content: t(lang, 'welcome.common.noEmbed', { name: embed, command: commandRef(interaction, 'embed create') }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { welcome_channel_id: channel.id, welcome_message: message ?? null, welcome_embed_template: embed ?? null });

  const detail = embed ? t(lang, 'welcome.common.embed', { name: embed }) : message ? describeMessage(message, lang) : t(lang, 'welcome.common.nothingYet', { emoji: EMOJI.ALERT });
  const text = `${t(lang, 'welcome.welcome.setup.done', { emoji: EMOJI.APPROVE, channel: `${channel}` })}\n${detail}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    t(lang, 'welcome.common.status.channel', { value: config?.welcome_channel_id ? `<#${config.welcome_channel_id}>` : t(lang, 'welcome.common.notSet') }),
    t(lang, 'welcome.common.status.embedTemplate', { value: config?.welcome_embed_template ? `\`${config.welcome_embed_template}\`` : t(lang, 'welcome.common.none.embed') }),
    t(lang, 'welcome.common.status.plainMessage', { value: config?.welcome_message ? shortMessage(localizeDefaultText('welcome', config.welcome_message, lang)) : t(lang, 'welcome.common.none.message') }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const lang = await languageOf(interaction);
  const config = await getConfig(interaction.guild.id);
  if (!config?.welcome_channel_id || (!config.welcome_message && !config.welcome_embed_template)) {
    await interaction.reply({ content: t(lang, 'welcome.welcome.notConfigured'), flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild.channels.fetch(config.welcome_channel_id).catch(() => null);
  if (!channel) {
    await interaction.reply({ content: t(lang, 'welcome.welcome.channelGone'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await sendMemberEvent({
    guild: interaction.guild,
    channel,
    kind: 'welcome',
    messageText: config.welcome_message,
    embedTemplateName: config.welcome_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel },
    lang,
  });
  await interaction.editReply({ content: t(lang, 'welcome.welcome.testSent', { emoji: EMOJI.APPROVE, channel: `${channel}` }) });
}

async function disable(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { welcome_channel_id: null });
  await interaction.editReply({ components: [textCard(t(lang, 'welcome.welcome.disabled', { emoji: EMOJI.APPROVE }))], flags: MessageFlags.IsComponentsV2 });
}
