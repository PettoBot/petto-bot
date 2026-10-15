const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig, addBlock, removeBlock, getBlock } = require('../../db/report');
const { buildConfigPanel } = require('../../interactions/reportConfigPanel');
const { buildReceipt } = require('../../interactions/reportModal');
const { REPORT_CATEGORIES, DEFAULT_CATEGORY } = require('../../utils/reportCategories');
const { submitReport, isReportStaff } = require('../../utils/reportService');
const {
  buildReportListPayload,
  buildReportViewPayload,
  buildReportStatsPayload,
  buildBlocklistPayload,
} = require('../../utils/reportViews');
const { noticePayload } = require('../../utils/infoCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

const PRIVATE = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function privately(payload) {
  return { ...payload, flags: PRIVATE };
}

function notice(text, color = COLORS.DEFAULT) {
  return privately(noticePayload(text, color));
}

module.exports = {
  aliases: ['rpt'],
  registerSlash: true,
  hiddenPrefixSubcommands: ['config'],
  // A multi-word reason works without quotes; the other options are given as --category, --ping and --anonymous.
  prefixGreedyStringOptions: { send: 'reason', block: 'reason' },
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a member to the staff team.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('send')
      .setDescription('Report a member for staff to review.')
      .addUserOption((opt) => opt.setName('user').setDescription('The user you are reporting').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('What happened?').setRequired(false).setMaxLength(500))
      .addStringOption((opt) => opt
        .setName('category')
        .setDescription('What kind of problem is it?')
        .setRequired(false)
        .addChoices(...REPORT_CATEGORIES.map((category) => ({ name: category.label, value: category.value }))))
      .addBooleanOption((opt) => opt.setName('ping').setDescription('Ask staff to review this urgently.').setRequired(false))
      .addBooleanOption((opt) => opt.setName('anonymous').setDescription('Hide your identity from the report.').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('config')
      .setDescription('(Staff) Open the report settings panel.'))
    .addSubcommand((sub) => sub
      .setName('disable')
      .setDescription('(Staff) Turn off member reports without deleting the configuration.'))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('(Staff) Browse submitted reports.')
      .addStringOption((opt) => opt
        .setName('status')
        .setDescription('Which reports to show (default: open)')
        .setRequired(false)
        .addChoices({ name: 'Open', value: 'open' }, { name: 'Being handled', value: 'claimed' }, { name: 'Resolved', value: 'resolved' }, { name: 'Dismissed', value: 'dismissed' }, { name: 'All', value: 'all' }))
      .addUserOption((opt) => opt.setName('user').setDescription('Only reports about this member').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('view')
      .setDescription('(Staff) Show one report.')
      .addIntegerOption((opt) => opt.setName('number').setDescription('Report number').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('stats').setDescription('(Staff) Show report statistics for this server.'))
    .addSubcommand((sub) => sub
      .setName('block')
      .setDescription('(Staff) Stop a member from sending reports.')
      .addUserOption((opt) => opt.setName('user').setDescription('The member to block').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Why they are blocked').setRequired(false).setMaxLength(200)))
    .addSubcommand((sub) => sub
      .setName('unblock')
      .setDescription('(Staff) Let a blocked member send reports again.')
      .addUserOption((opt) => opt.setName('user').setDescription('The member to unblock').setRequired(true)))
    .addSubcommand((sub) => sub.setName('blocklist').setDescription('(Staff) List members blocked from reporting.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'send') return send(interaction, lang);

    // Everything below is for staff: settings need Manage Server, the rest any moderator-level permission.
    const needsManageServer = sub === 'config' || sub === 'disable';
    const allowed = needsManageServer ? interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) : isReportStaff(interaction.member);
    if (!allowed) {
      await interaction.reply(notice(t(lang, needsManageServer ? 'reports.command.needsManageServer' : 'reports.command.staffOnly'), COLORS.RED));
      return;
    }

    if (sub === 'config') return showConfig(interaction, lang);
    if (sub === 'disable') return disable(interaction, lang);
    if (sub === 'list') return list(interaction, lang);
    if (sub === 'view') return view(interaction, lang);
    if (sub === 'stats') return stats(interaction, lang);
    if (sub === 'block') return block(interaction, lang);
    if (sub === 'unblock') return unblock(interaction, lang);
    return blocklist(interaction, lang);
  },
};

async function send(interaction, lang) {
  await interaction.deferReply({ flags: PRIVATE });
  await ensureGuild(interaction.guild.id);

  const config = await getConfig(interaction.guild.id).catch(() => null);
  const result = await submitReport({
    guild: interaction.guild,
    reporter: interaction.user,
    reportedUser: interaction.options.getUser('user', true),
    category: interaction.options.getString('category') ?? DEFAULT_CATEGORY,
    reason: interaction.options.getString('reason'),
    sourceChannel: interaction.channel,
    urgent: interaction.options.getBoolean('ping') === true,
    anonymous: interaction.options.getBoolean('anonymous') === true,
    lang,
  });

  await interaction.editReply(result.ok ? buildReceipt(result, config ?? {}, lang) : noticePayload(result.message, COLORS.RED));
}

async function showConfig(interaction, lang) {
  // The panel holds settings and is only meant for the person who opened it, which prefix commands cannot guarantee.
  if (interaction.rawMessage) {
    await interaction.reply(notice(t(lang, 'reports.command.configSlashOnly'), COLORS.RED));
    return;
  }

  await ensureGuild(interaction.guild.id);
  const config = await getConfig(interaction.guild.id).catch(() => null);
  await interaction.reply(privately(buildConfigPanel(interaction.guild, config, { lang })));
}

async function disable(interaction, lang) {
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { enabled: false });
  await interaction.reply(notice(t(lang, 'reports.command.disabled', { emoji: EMOJI.APPROVE })));
}

async function list(interaction, lang) {
  await interaction.deferReply({ flags: PRIVATE });
  const status = interaction.options.getString('status') ?? 'open';
  const user = interaction.options.getUser('user');
  await interaction.editReply(await buildReportListPayload(interaction.guild, { status, reportedUserId: user?.id ?? null, lang }));
}

async function view(interaction, lang) {
  await interaction.deferReply({ flags: PRIVATE });
  await interaction.editReply(await buildReportViewPayload(interaction.guild, interaction.options.getInteger('number', true), lang));
}

async function stats(interaction, lang) {
  await interaction.deferReply({ flags: PRIVATE });
  await interaction.editReply(await buildReportStatsPayload(interaction.guild, lang));
}

async function block(interaction, lang) {
  const user = interaction.options.getUser('user', true);
  if (user.id === interaction.user.id) {
    await interaction.reply(notice(t(lang, 'reports.command.blockSelf'), COLORS.RED));
    return;
  }
  if (user.bot) {
    await interaction.reply(notice(t(lang, 'reports.command.blockBot'), COLORS.RED));
    return;
  }

  await ensureGuild(interaction.guild.id);
  if (await getBlock(interaction.guild.id, user.id)) {
    await interaction.reply(notice(t(lang, 'reports.command.alreadyBlocked', { user: `${user}` })));
    return;
  }

  await addBlock(interaction.guild.id, user.id, interaction.user.id, interaction.options.getString('reason'));
  await interaction.reply(notice(t(lang, 'reports.command.blocked', { emoji: EMOJI.APPROVE, user: `${user}` }), COLORS.GREEN));
}

async function unblock(interaction, lang) {
  const user = interaction.options.getUser('user', true);
  const removed = await removeBlock(interaction.guild.id, user.id);
  await interaction.reply(removed
    ? notice(t(lang, 'reports.command.unblocked', { emoji: EMOJI.APPROVE, user: `${user}` }), COLORS.GREEN)
    : notice(t(lang, 'reports.command.notBlocked', { user: `${user}` })));
}

async function blocklist(interaction, lang) {
  await interaction.deferReply({ flags: PRIVATE });
  await interaction.editReply(await buildBlocklistPayload(interaction.guild, lang));
}
