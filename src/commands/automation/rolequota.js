const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const quotasDb = require('../../db/roleQuotas');
const { ensureGuild } = require('../../db/guilds');
const { validateRule, validateChannels, membersBelow, MAX_MESSAGES, MAX_PERIOD_DAYS, MAX_STRIKES, MAX_EXCUSE_DAYS, MAX_REMIND_HOURS, MAX_CHANNELS, DAY_MS } = require('../../utils/roleQuotas');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

// Administrator only (except `status` for yourself): a quota takes a role away by itself, so changing it is for who runs the server.
module.exports = {
  aliases: ['rqt', 'rquota', 'quota'],
  // Also a slash command: any member looks at their own count with `/rolequota status`; the rest is for administrators.
  registerSlash: true,
  data: new SlashCommandBuilder()
    .setName('rolequota')
    .setDescription('Ask a role for a number of messages each period; take it away from who misses it too often.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('set')
      .setDescription('Set the quota of a role (replaces the one it had; the period starts now).')
      .addRoleOption((o) => o.setName('role').setDescription('The role that has the quota').setRequired(true))
      .addIntegerOption((o) => o.setName('messages').setDescription('Messages each member must send in every period').setMinValue(1).setMaxValue(MAX_MESSAGES).setRequired(true))
      .addIntegerOption((o) => o.setName('days').setDescription('Days in each period (default 7)').setMinValue(1).setMaxValue(MAX_PERIOD_DAYS).setRequired(false))
      .addIntegerOption((o) => o.setName('strikes').setDescription('Periods in a row below the quota before the role goes (default 3)').setMinValue(1).setMaxValue(MAX_STRIKES).setRequired(false))
      .addBooleanOption((o) => o.setName('dm').setDescription('Tell members by DM when they fall short (default yes)').setRequired(false))
      .addChannelOption((o) => o.setName('report').setDescription('A channel for the result of each period').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Remove the quota of a role.')
      .addRoleOption((o) => o.setName('role').setDescription('The role of the quota').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List the role quotas of this server.'))
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('See how many messages a member has and their strikes (yourself by default).')
      .addUserOption((o) => o.setName('user').setDescription('The member (only administrators can look at others)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('channels')
      .setDescription('Choose where the messages count: every channel, only some, or all but some.')
      .addRoleOption((o) => o.setName('role').setDescription('The role of the quota').setRequired(true))
      .addStringOption((o) => o.setName('mode').setDescription('Where they count').setRequired(true).addChoices({ name: 'every channel', value: 'all' }, { name: 'only these channels', value: 'only' }, { name: 'all but these channels', value: 'except' }))
      .addStringOption((o) => o.setName('channels').setDescription('Channels or categories (mentions or ids), for "only" and "all but"').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remind')
      .setDescription('Tell the members who are below the quota some hours before the period ends.')
      .addRoleOption((o) => o.setName('role').setDescription('The role of the quota').setRequired(true))
      .addIntegerOption((o) => o.setName('hours').setDescription('Hours before the end (0 turns it off)').setMinValue(0).setMaxValue(MAX_REMIND_HOURS).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('progress')
      .setDescription('See who is below the quota right now, and their strikes.')
      .addRoleOption((o) => o.setName('role').setDescription('Only this role (default: every role with a quota)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('excuse')
      .setDescription('Give a member time off: the periods that end before then do not count.')
      .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
      .addIntegerOption((o) => o.setName('days').setDescription('Days of time off').setMinValue(1).setMaxValue(MAX_EXCUSE_DAYS).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('unexcuse')
      .setDescription('End the time off of a member.')
      .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const isAdmin = Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator));
    const askedUser = sub === 'status' ? interaction.options.getUser('user') : null;
    // Everyone can look at their own count; the rest (also looking at someone else) is for administrators.
    if (!isAdmin && !(sub === 'status' && (!askedUser || askedUser.id === interaction.user.id))) {
      await interaction.reply({ content: t(lang, 'automation.rolequota.needsAdmin'), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const guild = interaction.guild;
    const show = (text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    const GREEN = 0xa5ea7a;
    const RED = 0xfe6465;

    if (sub === 'list') {
      const rules = await quotasDb.listRules(guild.id);
      if (!rules.length) return show(t(lang, 'automation.rolequota.none'));
      const lines = rules.map((rule) => t(lang, 'automation.rolequota.line', {
        role: `<@&${rule.role_id}>`, min: rule.min_messages, days: rule.period_days, max: rule.max_strikes,
        extras: `${rule.notify_dm ? '' : t(lang, 'automation.rolequota.line.noDm')}${rule.report_channel_id ? t(lang, 'automation.rolequota.line.report', { channel: `<#${rule.report_channel_id}>` }) : ''}${rule.channel_mode && rule.channel_mode !== 'all' ? t(lang, `automation.rolequota.line.${rule.channel_mode}`, { channels: (rule.channel_ids ?? []).map((id) => `<#${id}>`).join(' ') }) : ''}${rule.remind_hours > 0 ? t(lang, 'automation.rolequota.line.remind', { hours: rule.remind_hours }) : ''}`,
      }));
      return show([...lines, ...coverage(guild, rules.map((rule) => rule.role_id), lang)].join('\n'));
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role', true);
      const removed = await quotasDb.removeRule(guild.id, role.id);
      return show(t(lang, removed ? 'automation.rolequota.removed' : 'automation.rolequota.notFound', { emoji: EMOJI.APPROVE, role: `<@&${role.id}>` }), removed ? GREEN : 0x4b4f59);
    }

    if (sub === 'status') {
      const target = askedUser ?? interaction.user;
      const [rules, rows] = await Promise.all([quotasDb.listRules(guild.id), quotasDb.listMembersOfUser(guild.id, target.id)]);
      const member = await guild.members.fetch(target.id).catch(() => null);
      const mine = rules.filter((rule) => member?.roles.cache.has(rule.role_id));
      if (!mine.length) return show(t(lang, target.id === interaction.user.id ? 'automation.rolequota.status.none' : 'automation.rolequota.status.noneOther'));
      const byRole = new Map(rows.map((row) => [row.role_id, row]));
      const lines = mine.map((rule) => {
        const row = byRole.get(rule.role_id);
        const end = Math.floor((new Date(rule.period_started_at).getTime() + rule.period_days * DAY_MS) / 1000);
        const excused = row?.excused_until && new Date(row.excused_until).getTime() > Date.now();
        const fresh = row?.since && new Date(row.since).getTime() > new Date(rule.period_started_at).getTime();
        const note = excused ? t(lang, 'automation.rolequota.status.excused', { until: `<t:${Math.floor(new Date(row.excused_until).getTime() / 1000)}:D>` }) : fresh ? t(lang, 'automation.rolequota.status.fresh') : '';
        return t(lang, 'automation.rolequota.status.line', { role: `<@&${rule.role_id}>`, messages: row?.messages ?? 0, min: rule.min_messages, end: `<t:${end}:R>`, strikes: row?.strikes ?? 0, max: rule.max_strikes, note });
      });
      return show(lines.join('\n'));
    }

    if (sub === 'channels') {
      const role = interaction.options.getRole('role', true);
      const mode = interaction.options.getString('mode', true);
      const { ids, missing } = readChannelIds(interaction, interaction.options.getString('channels'));
      if (missing.length) return show(t(lang, 'automation.rolequota.noChannel', { emoji: EMOJI.DENY, channels: missing.map((word) => `\`${word}\``).join(' ') }), RED);
      const checked = validateChannels(mode, ids);
      if (!checked.ok) return show(t(lang, `automation.rolequota.error.${checked.error}`, { max: MAX_CHANNELS }), RED);
      const saved = await quotasDb.setChannels(guild.id, role.id, checked.mode, checked.ids);
      if (!saved) return show(t(lang, 'automation.rolequota.notFound', { emoji: EMOJI.APPROVE, role: `<@&${role.id}>` }), 0x4b4f59);
      const key = checked.mode === 'all' ? 'automation.rolequota.channels.all' : `automation.rolequota.channels.${checked.mode}`;
      return show(t(lang, key, { emoji: EMOJI.APPROVE, role: `<@&${role.id}>`, channels: checked.ids.map((id) => `<#${id}>`).join(' ') }), GREEN);
    }

    if (sub === 'remind') {
      const role = interaction.options.getRole('role', true);
      const hours = interaction.options.getInteger('hours', true);
      const saved = await quotasDb.setReminder(guild.id, role.id, hours);
      if (!saved) return show(t(lang, 'automation.rolequota.notFound', { emoji: EMOJI.APPROVE, role: `<@&${role.id}>` }), 0x4b4f59);
      return show(t(lang, hours ? 'automation.rolequota.remind.on' : 'automation.rolequota.remind.off', { emoji: EMOJI.APPROVE, role: `<@&${role.id}>`, hours }), GREEN);
    }

    if (sub === 'progress') {
      const only = interaction.options.getRole('role');
      const rules = (await quotasDb.listRules(guild.id)).filter((rule) => !only || rule.role_id === only.id);
      if (!rules.length) return show(t(lang, only ? 'automation.rolequota.notFound' : 'automation.rolequota.none', { emoji: EMOJI.APPROVE, role: only ? `<@&${only.id}>` : '' }), 0x4b4f59);
      const blocks = [];
      for (const rule of rules.slice(0, 5)) {
        const result = await membersBelow(guild, rule);
        const end = Math.floor((new Date(rule.period_started_at).getTime() + rule.period_days * DAY_MS) / 1000);
        const head = t(lang, 'automation.rolequota.progress.head', { role: `<@&${rule.role_id}>`, min: rule.min_messages, end: `<t:${end}:R>`, below: result.below.length, total: result.total });
        const lines = result.below.slice(0, 15).map((entry) => t(lang, 'automation.rolequota.progress.line', { user: `<@${entry.member.id}>`, messages: entry.messages, min: rule.min_messages, strikes: entry.strikes, max: rule.max_strikes }));
        if (result.below.length > 15) lines.push(t(lang, 'automation.rolequota.progress.more', { count: result.below.length - 15 }));
        if (!result.below.length) lines.push(t(lang, 'automation.rolequota.progress.nobody'));
        const notes = [result.excused ? t(lang, 'automation.rolequota.progress.excused', { count: result.excused }) : '', result.fresh ? t(lang, 'automation.rolequota.progress.fresh', { count: result.fresh }) : ''].filter(Boolean).join(' · ');
        blocks.push([head, ...lines, notes ? `-# ${notes}` : ''].filter(Boolean).join('\n'));
      }
      if (rules.length > 5) blocks.push(t(lang, 'automation.rolequota.progress.rolesMore', { count: rules.length - 5 }));
      return show(blocks.join('\n\n'));
    }

    if (sub === 'excuse' || sub === 'unexcuse') {
      const target = interaction.options.getUser('user', true);
      const [rules, member] = await Promise.all([quotasDb.listRules(guild.id), guild.members.fetch(target.id).catch(() => null)]);
      const mine = rules.filter((rule) => member?.roles.cache.has(rule.role_id));
      if (!mine.length) return show(t(lang, 'automation.rolequota.excuse.noRoles'), 0x4b4f59);
      const days = sub === 'excuse' ? interaction.options.getInteger('days', true) : 0;
      await quotasDb.setExcuse(guild.id, mine.map((rule) => rule.role_id), target.id, sub === 'excuse' ? new Date(Date.now() + days * DAY_MS) : null);
      const roles = mine.map((rule) => `<@&${rule.role_id}>`).join(' ');
      return show(t(lang, sub === 'excuse' ? 'automation.rolequota.excuse.saved' : 'automation.rolequota.excuse.cleared', { emoji: EMOJI.APPROVE, user: `<@${target.id}>`, days, roles }), GREEN);
    }

    // set
    const role = interaction.options.getRole('role', true);
    const rules = await quotasDb.listRules(guild.id);
    const report = interaction.options.getChannel('report');
    const checked = validateRule({
      role,
      guildId: guild.id,
      messages: interaction.options.getInteger('messages', true),
      periodDays: interaction.options.getInteger('days') ?? 7,
      strikes: interaction.options.getInteger('strikes') ?? 3,
      notifyDm: interaction.options.getBoolean('dm') ?? true,
      reportChannelId: report?.id ?? null,
      existingRoleIds: rules.map((rule) => rule.role_id),
    });
    if (!checked.ok) return show(t(lang, `automation.rolequota.error.${checked.error}`, { max: checked.error === 'tooMany' ? 25 : checked.error === 'badMessages' ? MAX_MESSAGES : checked.error === 'badPeriod' ? MAX_PERIOD_DAYS : checked.error === 'badRemind' ? MAX_REMIND_HOURS : checked.error === 'tooManyChannels' ? MAX_CHANNELS : MAX_STRIKES }), RED);
    await ensureGuild(guild.id);
    // Where the messages count and the reminder are changed with their own commands (and the dashboard): saving the quota again keeps them.
    const { channelMode, channelIds, remindHours, ...base } = checked.rule;
    const saved = await quotasDb.upsertRule(guild.id, base);
    return show([t(lang, 'automation.rolequota.saved', { emoji: EMOJI.APPROVE, role: `<@&${role.id}>`, min: saved.min_messages, days: saved.period_days, max: saved.max_strikes }), ...coverage(guild, [role.id], lang)].join('\n'), GREEN);
  },
};

/** The channels written for `channels`: mentions, ids or #names, read from the text. `missing` are the words that are not a channel of this server. */
function readChannelIds(interaction, text) {
  const words = String(text ?? '').split(/[\s,]+/).filter(Boolean);
  const cache = interaction.guild?.channels?.cache;
  const ids = [];
  const missing = [];
  for (const word of words) {
    const mention = /^<#(\d{15,25})>$/.exec(word)?.[1] ?? (/^\d{15,25}$/.test(word) ? word : null);
    const channel = mention ? cache?.get(mention) : cache?.find((each) => each.name?.toLowerCase() === word.replace(/^#/, '').toLowerCase());
    if (channel) { if (!ids.includes(channel.id)) ids.push(channel.id); } else missing.push(word);
  }
  return { ids, missing };
}

/** What would stop Petto from taking a role away: it lacks Manage Roles, or the role is above its highest role. */
function coverage(guild, roleIds, lang) {
  const me = guild.members.me;
  if (!me) return [];
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return [t(lang, 'automation.rolequota.coverage.noPermission', { emoji: EMOJI.ALERT })];
  return roleIds
    .map((id) => guild.roles.cache.get(id))
    .filter((role) => role && me.roles.highest.comparePositionTo(role) <= 0)
    .map((role) => t(lang, 'automation.rolequota.coverage.hierarchy', { emoji: EMOJI.ALERT, role: `<@&${role.id}>` }));
}
