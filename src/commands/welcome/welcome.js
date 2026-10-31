const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { commandRef } = require('../../utils/commandRef');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig, welcomeWait } = require('../../db/memberEvents');
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
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off welcome messages.'))
    .addSubcommand((s) =>
      s
        .setName('second-setup')
        .setDescription('Set a second welcome: another channel and message, sent after the first one.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel the second welcome is posted to (for example the general chat)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_name})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('second-disable').setDescription('Turn off the second welcome.')),

  // `!welcome setup` and `!welcome second-setup` take an embed code as their message, with its line breaks and buttons.
  prefixCodeOptions: { setup: 'message', 'second-setup': 'message' },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'status') return status(interaction); 
    if (sub === 'test') return test(interaction);
    if (sub === 'second-setup') return setupSecond(interaction);
    if (sub === 'second-disable') return disableSecond(interaction);
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
    t(lang, 'welcome.welcome.status.wait', { value: t(lang, `welcome.welcome.wait.${welcomeWait(config)}`) }),
    t(lang, 'welcome.welcome.status.second', { value: secondSummary(config, lang) }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

/** What the second welcome is, in one line for the status. */
function secondSummary(config, lang) {
  if (!config?.welcome_second_enabled || !config.welcome_second_channel_id) return t(lang, 'welcome.welcome.status.secondOff');
  const what = config.welcome_second_embed_template ? `\`${config.welcome_second_embed_template}\`` : config.welcome_second_message ? shortMessage(localizeDefaultText('welcome', config.welcome_second_message, lang), 120) : t(lang, 'welcome.common.none.message');
  return `<#${config.welcome_second_channel_id}> · ${what}`;
}

async function setupSecond(interaction) {
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
  await upsertConfig(interaction.guild.id, { welcome_second_enabled: true, welcome_second_channel_id: channel.id, welcome_second_message: message ?? null, welcome_second_embed_template: embed ?? null });

  const detail = embed ? t(lang, 'welcome.common.embed', { name: embed }) : message ? describeMessage(message, lang) : t(lang, 'welcome.common.nothingYet', { emoji: EMOJI.ALERT });
  const text = `${t(lang, 'welcome.welcome.second.setup.done', { emoji: EMOJI.APPROVE, channel: `${channel}` })}\n${detail}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function disableSecond(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { welcome_second_enabled: false });
  await interaction.editReply({ components: [textCard(t(lang, 'welcome.welcome.second.disabled', { emoji: EMOJI.APPROVE }))], flags: MessageFlags.IsComponentsV2 });
}

/** Sends the welcome (and the second one when it is on) to the channel it is set for, as a member's own welcome. Answers where each went. */
async function test(interaction) {
  const lang = await languageOf(interaction);
  const config = await getConfig(interaction.guild.id);
  const main = config?.welcome_channel_id && (config.welcome_message || config.welcome_embed_template)
    ? { channelId: config.welcome_channel_id, message: config.welcome_message, template: config.welcome_embed_template } : null;
  const second = config?.welcome_second_enabled && config.welcome_second_channel_id && (config.welcome_second_message || config.welcome_second_embed_template)
    ? { channelId: config.welcome_second_channel_id, message: config.welcome_second_message, template: config.welcome_second_embed_template } : null;
  if (!main && !second) {
    await interaction.reply({ content: t(lang, 'welcome.welcome.notConfigured'), flags: MessageFlags.Ephemeral });
    return;
  }

  // The channels are looked at first: a welcome whose channel is gone is said before anything is sent.
  const targets = [];
  for (const [welcome, gone] of [[main, 'welcome.welcome.channelGone'], [second, 'welcome.welcome.second.channelGone']]) {
    if (!welcome) continue;
    const channel = await interaction.guild.channels.fetch(welcome.channelId).catch(() => null);
    if (!channel) {
      await interaction.reply({ content: t(lang, gone), flags: MessageFlags.Ephemeral });
      return;
    }
    targets.push({ welcome, channel });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  for (const { welcome, channel } of targets) {
    await sendMemberEvent({
      guild: interaction.guild,
      channel,
      kind: 'welcome',
      messageText: welcome.message,
      embedTemplateName: welcome.template,
      ctx: { member: interaction.member, guild: interaction.guild, channel },
      lang,
    });
  }
  const where = targets.map(({ channel }) => `${channel}`);
  await interaction.editReply({ content: where.length === 1 ? t(lang, 'welcome.welcome.testSent', { emoji: EMOJI.APPROVE, channel: where[0] }) : t(lang, 'welcome.welcome.testSentBoth', { emoji: EMOJI.APPROVE, channels: where.join(', ') }) });
}

async function disable(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { welcome_channel_id: null });
  await interaction.editReply({ components: [textCard(t(lang, 'welcome.welcome.disabled', { emoji: EMOJI.APPROVE }))], flags: MessageFlags.IsComponentsV2 });
}
