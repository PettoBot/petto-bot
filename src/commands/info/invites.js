const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { applyRewards } = require('../../utils/inviteRewards');
const inviteTrackingDb = require('../../db/inviteTracking');
const { readSettingsPatch } = require('../../db/inviteTrackingRules');
const { INFO_ACCENT, infoPayload, noticePayload, line } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, tn, languageOf } = require('../../i18n');

/** A refusal or a mistake of the member: red, and told in private (the channel does not need to see it). */
const refusal = (text) => ({ ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

const SOURCES = ['invite', 'vanity', 'unknown', 'bot'];

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['invs'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite tracker: who invited whom, with fake and bonus invites.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('user').setDescription('Invites of a member (default: you).').addUserOption((o) => o.setName('user').setDescription('User').setRequired(false)))
    .addSubcommand((s) => s.setName('top').setDescription('Invite leaderboard for this server.')
      .addStringOption((o) => o.setName('period').setDescription('All time (default), this week or this month').setRequired(false).addChoices({ name: 'All time', value: 'all' }, { name: 'This week', value: 'week' }, { name: 'This month', value: 'month' })))
    .addSubcommand((s) => s.setName('who').setDescription('Who invited a member, and how.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('The last members someone invited.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('codes').setDescription('The invite links a member has made and how much each was used.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('bonus').setDescription('Add or take away bonus invites (needs Manage Server).')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many (negative takes away)').setMinValue(-10000).setMaxValue(10000).setRequired(true)))
    .addSubcommand((s) => s.setName('config').setDescription('Show the invite settings, or change them (Manage Server).')
      .addIntegerOption((o) => o.setName('fake_days').setDescription('Accounts younger than this many days are fake joins (0 turns it off; default 3)').setMinValue(0).setMaxValue(365).setRequired(false))
      .addIntegerOption((o) => o.setName('quick_leave_minutes').setDescription('Leaving within this many minutes of joining counts as a fake join (0 is off; default 0)').setMinValue(0).setMaxValue(1440).setRequired(false))
      .addBooleanOption((o) => o.setName('ignore_bots').setDescription('Do not credit bot accounts to anybody (default off)').setRequired(false))
      .addBooleanOption((o) => o.setName('subtract_leaves').setDescription('Take the members who left off the total of invites (default on)').setRequired(false)))
    .addSubcommandGroup((g) => g.setName('reward').setDescription('Roles given for reaching a number of invites (needs Manage Server).')
      .addSubcommand((s) => s.setName('add').setDescription('Give a role to whoever reaches a number of invites.')
        .addIntegerOption((o) => o.setName('invites').setDescription('How many invites').setMinValue(1).setMaxValue(100000).setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Stop giving a role.').addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('The roles given for invites.')))
    .addSubcommand((s) => s.setName('reset').setDescription('Put the invites of a member back to zero (needs Administrator).').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const group = interaction.options.getSubcommandGroup?.(false);
    if (group === 'reward') return rewardCmd(interaction, lang);
    const sub = interaction.options.getSubcommand();
    if (sub === 'config') return configCmd(interaction, lang);
    if (sub === 'top') return topCmd(interaction, lang);
    if (sub === 'who') return whoCmd(interaction, lang);
    if (sub === 'list') return listCmd(interaction, lang);
    if (sub === 'codes') return codesCmd(interaction, lang);
    if (sub === 'bonus') return bonusCmd(interaction, lang);
    if (sub === 'reset') return resetCmd(interaction, lang);
    return userCmd(interaction, lang);
  },
};

const net = (stats) => stats.total;
const unixOf = (date) => Math.floor(new Date(date).getTime() / 1000);

async function userCmd(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const stats = await inviteTrackingDb.getStats(interaction.guild.id, user.id);

  await interaction.reply(infoPayload({
    accent: interaction.guild.members.cache.get(user.id)?.displayColor || INFO_ACCENT,
    title: t(lang, 'info.invites.user.title', { name: user.globalName ?? user.username }),
    thumbnail: user.displayAvatarURL({ size: 256 }),
    subtitle: [tn(lang, 'info.invites.user.total', net(stats), { count: net(stats) })],
    sections: [{ lines: [
      line(t(lang, 'info.invites.label.joined'), stats.joins),
      line(t(lang, 'info.invites.label.left'), stats.leaves),
      line(t(lang, 'info.invites.label.fake'), stats.fake),
      line(t(lang, 'info.invites.label.bonus'), stats.bonus),
    ] }],
    footer: t(lang, 'info.invites.user.footer'),
  }));
}

async function topCmd(interaction, lang) {
  const period = interaction.options.getString('period') ?? 'all';
  const rows = period === 'all' ? await inviteTrackingDb.getLeaderboard(interaction.guild.id, 10) : await inviteTrackingDb.getPeriodLeaderboard(interaction.guild.id, period, 10);
  if (!rows.length) {
    await interaction.reply(noticePayload(t(lang, 'info.invites.top.none')));
    return;
  }

  const lines = rows.map((r, i) => {
    const values = { rank: i + 1, user: `<@${r.inviter_id}>`, net: r.net, joins: r.joins, leaves: r.leaves };
    return r.bonus
      ? t(lang, 'info.invites.top.lineBonus', { ...values, bonus: `${r.bonus > 0 ? '+' : ''}${r.bonus}` })
      : t(lang, 'info.invites.top.line', values);
  });
  await interaction.reply(infoPayload({
    title: t(lang, period === 'week' ? 'info.invites.top.titleWeek' : period === 'month' ? 'info.invites.top.titleMonth' : 'info.invites.top.title'),
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    subtitle: [interaction.guild.name],
    sections: [{ lines }],
    footer: t(lang, period === 'all' ? 'info.invites.top.footer' : 'info.invites.top.footerPeriod'),
  }));
}

async function whoCmd(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const row = await inviteTrackingDb.getInviter(interaction.guild.id, user.id);
  if (!row) {
    await interaction.reply(noticePayload(t(lang, 'info.invites.who.none')));
    return;
  }
  await interaction.reply(infoPayload({
    title: t(lang, 'info.invites.who.title', { name: user.globalName ?? user.username }),
    thumbnail: user.displayAvatarURL({ size: 256 }),
    sections: [{
      lines: [
        line(t(lang, 'info.invites.who.invitedBy'), row.inviter_id ? `<@${row.inviter_id}>` : t(lang, 'info.unknown')),
        line(t(lang, 'info.invites.who.through'), SOURCES.includes(row.source) ? t(lang, `info.invites.source.${row.source}`) : row.source),
        line(t(lang, 'info.label.code'), row.invite_code ? `\`${row.invite_code}\`` : null),
        line(t(lang, 'info.label.joined'), `<t:${unixOf(row.joined_at)}:R>`),
        line(t(lang, 'info.invites.who.counted'), t(lang, row.fake ? 'info.invites.who.fake' : 'info.card.yes')),
      ],
    }],
    footer: t(lang, 'info.card.id', { id: user.id }),
  }));
}

async function listCmd(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const rows = await inviteTrackingDb.listInvited(interaction.guild.id, user.id, 15);
  if (!rows.length) {
    await interaction.reply(noticePayload(t(lang, 'info.invites.list.none', { name: user.globalName ?? user.username })));
    return;
  }
  const lines = rows.map((r) => [
    `<@${r.user_id}>`,
    `<t:${unixOf(r.joined_at)}:R>`,
    r.left_at ? t(lang, 'info.invites.list.left') : null,
    r.fake ? t(lang, 'info.invites.list.fake') : null,
  ].filter(Boolean).join(' · '));
  await interaction.reply(infoPayload({
    title: t(lang, 'info.invites.list.title', { name: user.globalName ?? user.username }),
    thumbnail: user.displayAvatarURL({ size: 256 }),
    sections: [{ lines }],
    footer: t(lang, 'info.invites.list.footer'),
  }));
}

async function codesCmd(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(refusal(t(lang, 'info.invites.codes.needPermission')));
    return;
  }
  const invites = await interaction.guild.invites.fetch().catch(() => null);
  if (!invites) {
    await interaction.reply(refusal(t(lang, 'info.invites.codes.unreadable')));
    return;
  }
  const own = [...invites.values()].filter((i) => i.inviter?.id === user.id).sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0)).slice(0, 15);
  if (!own.length) {
    await interaction.reply(noticePayload(t(lang, 'info.invites.codes.none', { name: user.globalName ?? user.username })));
    return;
  }
  const lines = own.map((i) => [
    `\`${i.code}\``,
    `<#${i.channelId}>`,
    i.maxUses
      ? tn(lang, 'info.invites.codes.usesOf', i.uses ?? 0, { count: i.uses ?? 0, max: i.maxUses })
      : tn(lang, 'info.invites.codes.uses', i.uses ?? 0, { count: i.uses ?? 0 }),
    i.expiresTimestamp ? t(lang, 'info.invites.codes.ends', { when: `<t:${Math.floor(i.expiresTimestamp / 1000)}:R>` }) : null,
  ].filter(Boolean).join(' · '));
  await interaction.reply(infoPayload({ title: t(lang, 'info.invites.codes.title', { name: user.globalName ?? user.username }), thumbnail: user.displayAvatarURL({ size: 256 }), sections: [{ lines }] }));
}

async function bonusCmd(interaction, lang) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(refusal(t(lang, 'info.invites.needManageGuild')));
    return;
  }
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  if (amount === 0) {
    await interaction.reply(noticePayload(t(lang, 'info.invites.bonus.zero')));
    return;
  }
  const stats = await inviteTrackingDb.addBonus(interaction.guild.id, user.id, amount);
  await applyRewards(interaction.guild, user.id);
  await interaction.reply(noticePayload(t(lang, amount > 0 ? 'info.invites.bonus.added' : 'info.invites.bonus.removed', { amount: Math.abs(amount), user: `<@${user.id}>`, total: net(stats) })));
}

async function resetCmd(interaction, lang) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply(refusal(t(lang, 'info.invites.needAdministrator')));
    return;
  }
  const user = interaction.options.getUser('user', true);
  await inviteTrackingDb.resetUser(interaction.guild.id, user.id);
  await applyRewards(interaction.guild, user.id);
  await interaction.reply(noticePayload(t(lang, 'info.invites.reset.done', { user: `<@${user.id}>` })));
}

function needManageGuild(interaction, lang) {
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return false;
  interaction.reply(refusal(t(lang, 'info.invites.needManageGuild')));
  return true;
}

const onOff = (lang, value) => t(lang, value ? 'info.invites.config.on' : 'info.invites.config.off');

async function configCmd(interaction, lang) {
  const options = interaction.options;
  const patch = {
    fakeDays: options.getInteger('fake_days'),
    quickLeaveMinutes: options.getInteger('quick_leave_minutes'),
    ignoreBots: options.getBoolean('ignore_bots'),
    subtractLeaves: options.getBoolean('subtract_leaves'),
  };
  const given = Object.entries(patch).filter(([, value]) => value !== null && value !== undefined);
  const guildId = interaction.guild.id;
  if (given.length) {
    if (needManageGuild(interaction, lang)) return;
    const { values, error } = readSettingsPatch(Object.fromEntries(given));
    if (error) {
      await interaction.reply(refusal(t(lang, 'info.invites.config.invalid')));
      return;
    }
    await inviteTrackingDb.setSettings(guildId, values);
    const lines = [];
    if (values.fakeDays !== undefined) lines.push(values.fakeDays ? tn(lang, 'info.invites.config.fakeDaysSet', values.fakeDays, { count: values.fakeDays }) : t(lang, 'info.invites.config.fakeDaysOff'));
    if (values.quickLeaveMinutes !== undefined) lines.push(values.quickLeaveMinutes ? tn(lang, 'info.invites.config.quickLeaveSet', values.quickLeaveMinutes, { count: values.quickLeaveMinutes }) : t(lang, 'info.invites.config.quickLeaveOff'));
    if (values.ignoreBots !== undefined) lines.push(t(lang, values.ignoreBots ? 'info.invites.config.ignoreBotsOn' : 'info.invites.config.ignoreBotsOff'));
    if (values.subtractLeaves !== undefined) lines.push(t(lang, values.subtractLeaves ? 'info.invites.config.subtractOn' : 'info.invites.config.subtractOff'));
    await interaction.reply(noticePayload(lines.join('\n')));
    return;
  }
  const settings = await inviteTrackingDb.getSettings(guildId);
  const rewards = await inviteTrackingDb.listRewards(guildId);
  await interaction.reply(infoPayload({
    title: t(lang, 'info.invites.config.title'),
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    sections: [{ lines: [
      line(t(lang, 'info.invites.config.fakeJoins'), settings.fakeDays ? tn(lang, 'info.invites.config.fakeAccounts', settings.fakeDays, { count: settings.fakeDays }) : t(lang, 'info.invites.config.onlyReturning')),
      line(t(lang, 'info.invites.config.quickLeave'), settings.quickLeaveMinutes ? tn(lang, 'info.invites.config.quickLeaveValue', settings.quickLeaveMinutes, { count: settings.quickLeaveMinutes }) : t(lang, 'info.invites.config.off')),
      line(t(lang, 'info.invites.config.ignoreBots'), onOff(lang, settings.ignoreBots)),
      line(t(lang, 'info.invites.config.subtractLeaves'), onOff(lang, settings.subtractLeaves)),
      line(t(lang, 'info.invites.config.rewards'), rewards.length ? String(rewards.length) : t(lang, 'info.invites.config.noRewards')),
    ] }],
    footer: t(lang, 'info.invites.config.footer'),
  }));
}

async function rewardCmd(interaction, lang) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === 'list') {
    const rewards = await inviteTrackingDb.listRewards(guild.id);
    await interaction.reply(rewards.length
      ? infoPayload({ title: t(lang, 'info.invites.reward.title'), sections: [{ lines: rewards.map((r) => tn(lang, 'info.invites.reward.line', r.invites, { count: r.invites, role: `<@&${r.role_id}>` })) }], footer: t(lang, 'info.invites.reward.footer') })
      : noticePayload(t(lang, 'info.invites.reward.none')));
    return;
  }
  if (needManageGuild(interaction, lang)) return;
  const role = interaction.options.getRole('role', true);
  if (sub === 'remove') {
    const removed = await inviteTrackingDb.removeReward(guild.id, role.id);
    await interaction.reply(noticePayload(removed ? t(lang, 'info.invites.reward.removed', { role: `<@&${role.id}>` }) : t(lang, 'info.invites.reward.notReward')));
    return;
  }
  const invites = interaction.options.getInteger('invites', true);
  const me = guild.members.me;
  if (role.managed || role.id === guild.id || role.position >= me.roles.highest.position) {
    await interaction.reply(refusal(t(lang, 'info.invites.reward.cannotGive', { everyone: '@everyone' })));
    return;
  }
  if (interaction.member.id !== guild.ownerId && role.position >= interaction.member.roles.highest.position) {
    await interaction.reply(refusal(t(lang, 'info.invites.reward.aboveYours')));
    return;
  }
  await inviteTrackingDb.addReward(guild.id, invites, role.id);
  await interaction.reply(noticePayload(tn(lang, 'info.invites.reward.added', invites, { count: invites, role: `<@&${role.id}>` })));
  for (const inviterId of await inviteTrackingDb.listInviterIds(guild.id)) await applyRewards(guild, inviterId);
}
