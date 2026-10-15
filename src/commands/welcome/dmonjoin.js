const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { commandRef } = require('../../utils/commandRef');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent, localizeDefaultText } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dmonjoin')
    .setDescription('DM new members a message when they join (separate from the /welcome channel message).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the direct message new members get when they join.')
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_name})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current join-DM configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('DM yourself a preview.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off the join DM.')),
  aliases: ['dmjoin'],

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
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');

  if (embed && !(await getTemplate(interaction.guild.id, embed))) {
    await interaction.reply({ content: t(lang, 'welcome.common.noEmbed', { name: embed, command: commandRef(interaction, 'embed create') }), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!message && !embed) {
    await interaction.reply({ content: t(lang, 'welcome.dmonjoin.needContent'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { dm_join_message: message ?? null, dm_join_embed_template: embed ?? null });

  const detail = embed ? t(lang, 'welcome.common.embed', { name: embed }) : t(lang, 'welcome.common.message', { message });
  const text = `${t(lang, 'welcome.dmonjoin.setup.done', { emoji: EMOJI.APPROVE })}\n${detail}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    t(lang, 'welcome.common.status.embedTemplate', { value: config?.dm_join_embed_template ? `\`${config.dm_join_embed_template}\`` : t(lang, 'welcome.common.none.embed') }),
    t(lang, 'welcome.common.status.plainMessage', { value: config?.dm_join_message ? localizeDefaultText('welcome', config.dm_join_message, lang) : t(lang, 'welcome.common.none.message') }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const lang = await languageOf(interaction);
  const config = await getConfig(interaction.guild.id);
  if (!config?.dm_join_message && !config?.dm_join_embed_template) {
    await interaction.reply({ content: t(lang, 'welcome.dmonjoin.notConfigured'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) {
    await interaction.editReply({ content: t(lang, 'welcome.dmonjoin.noDm') });
    return;
  }

  await sendMemberEvent({
    guild: interaction.guild,
    channel: dm,
    kind: 'welcome',
    messageText: config.dm_join_message,
    embedTemplateName: config.dm_join_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel: dm },
    lang,
  });
  await interaction.editReply({ content: t(lang, 'welcome.dmonjoin.previewSent', { emoji: EMOJI.APPROVE }) });
}

async function disable(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { dm_join_message: null, dm_join_embed_template: null });
  await interaction.editReply({ components: [textCard(t(lang, 'welcome.dmonjoin.disabled', { emoji: EMOJI.APPROVE }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
