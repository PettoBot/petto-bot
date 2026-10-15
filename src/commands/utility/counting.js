const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/counting');
const { plainCard } = require('../../utils/plainCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const reply = (interaction, text, ephemeral = false) => interaction.reply({ ...plainCard(text), flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const no = (interaction, text) => reply(interaction, `${EMOJI.DENY}  ${text}`, true);
const yes = (interaction, text) => reply(interaction, `${EMOJI.APPROVE}  ${text}`);

// The labels name the choices of the slash command (builder texts stay in English); the answers use `counting.setting.<name>`.
const SETTINGS = {
  double: { column: 'allow_double', kind: 'boolean', label: 'The same person can count twice in a row' }, // i18n-ignore: choice name of the builder
  math: { column: 'math', kind: 'boolean', label: 'Sums such as 2*3+1 count as a number' }, // i18n-ignore: choice name of the builder
  reset: { column: 'reset_on_wrong', kind: 'boolean', label: 'A mistake sends the count back to the start' }, // i18n-ignore: choice name of the builder
  delete: { column: 'delete_wrong', kind: 'boolean', label: 'Wrong numbers are deleted' }, // i18n-ignore: choice name of the builder
  edits: { column: 'announce_edits', kind: 'boolean', label: 'Say when the last number is edited or deleted' }, // i18n-ignore: choice name of the builder
  ok_emoji: { column: 'react_ok', kind: 'emoji', label: 'Reaction of a right number' }, // i18n-ignore: choice name of the builder
  bad_emoji: { column: 'react_bad', kind: 'emoji', label: 'Reaction of a wrong number' }, // i18n-ignore: choice name of the builder
  record_emoji: { column: 'react_record', kind: 'emoji', label: 'Reaction of a new record' }, // i18n-ignore: choice name of the builder
  saves: { column: 'saves_max', kind: 'number', min: 0, max: 5, label: 'Saves the server can keep (a save forgives one mistake)' }, // i18n-ignore: choice name of the builder
  save_every: { column: 'save_every', kind: 'number', min: 10, max: 10000, label: 'A save is earned every this many numbers' }, // i18n-ignore: choice name of the builder
  milestone: { column: 'milestone_every', kind: 'number', min: 0, max: 100000, label: 'A message every this many numbers (0 for none)' }, // i18n-ignore: choice name of the builder
  record_every: { column: 'record_every', kind: 'number', min: 0, max: 100000, label: 'The record reaction is given every this many numbers (0 = never)' }, // i18n-ignore: choice name of the builder
  wrong_role: { column: 'wrong_role_id', kind: 'role', label: 'Role given to who gets a number wrong (none removes it)' }, // i18n-ignore: choice name of the builder
  wrong_role_time: { column: 'wrong_role_minutes', kind: 'number', min: 0, max: 10080, label: 'Minutes the mistake role lasts (0 = until their next right number)' }, // i18n-ignore: choice name of the builder
  top_role: { column: 'top_role_id', kind: 'role', label: 'Role of the best counter (none removes it)' }, // i18n-ignore: choice name of the builder
  alert_time: { column: 'alert_seconds', kind: 'number', min: 0, max: 3600, label: 'Seconds until the alerts of a mistake delete themselves (0 = never)' }, // i18n-ignore: choice name of the builder
  start: { column: 'start_number', kind: 'number', min: 0, max: 1000000, label: 'The number the count starts after (0 = starts at 1)' }, // i18n-ignore: choice name of the builder
};
const parseBool = (text) => (/^(true|on|yes|si|sí|1|enable|enabled)$/i.test(text) ? true : /^(false|off|no|0|disable|disabled)$/i.test(text) ? false : null);

module.exports = {
  aliases: ['count'],
  data: new SlashCommandBuilder()
    .setName('counting')
    .setDescription('A channel where members count one number after the other.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('setup').setDescription('Start the counting game in a channel.').addChannelOption((o) => o.setName('channel').setDescription('Where to count').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('disable').setDescription('Stop the counting game (the numbers are kept).'))
    .addSubcommand((s) => s.setName('config').setDescription('See how the counting game is set up.'))
    .addSubcommand((s) => s
      .setName('set')
      .setDescription('Change one setting.')
      .addStringOption((o) => o.setName('setting').setDescription('What to change').setRequired(true).addChoices(...Object.entries(SETTINGS).map(([name, def]) => ({ name: `${name}: ${def.label}`.slice(0, 100), value: name }))))
      .addStringOption((o) => o.setName('value').setDescription('on or off, an emoji, a number or a role').setRequired(true).setMaxLength(64)))
    .addSubcommand((s) => s.setName('number').setDescription('Set the number the count is at now.').addIntegerOption((o) => o.setName('value').setDescription('The last number counted (the next one is this plus 1)').setMinValue(0).setMaxValue(1000000).setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Send the count back to the start and clear who counted.').addBooleanOption((o) => o.setName('clear_scores').setDescription('Also clear the scores of everyone').setRequired(false)))
    .addSubcommand((s) => s.setName('next').setDescription('See which number comes next.'))
    .addSubcommand((s) => s.setName('stats').setDescription('The numbers of a member in the counting game.').addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Who has counted the most.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (['setup', 'disable', 'set', 'number', 'reset'].includes(sub) && !manager) return no(interaction, t(lang, 'counting.needManageServer'));
    const config = await db.getConfig(interaction.guild.id);
    const never = t(lang, 'counting.never');

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions])) return no(interaction, t(lang, 'counting.setup.cannot', { channel: `${channel}` }));
      await db.updateConfig(interaction.guild.id, { enabled: true, channel_id: channel.id, ...(config.channel_id === channel.id ? {} : { current_number: Number(config.start_number ?? 0), last_user_id: null, last_message_id: null }) });
      return yes(interaction, t(lang, 'counting.setup.done', { channel: `${channel}`, number: Number(config.start_number ?? 0) + 1 }));
    }
    if (sub === 'disable') {
      await db.updateConfig(interaction.guild.id, { enabled: false });
      return yes(interaction, t(lang, 'counting.disabled'));
    }
    if (sub === 'config') {
      const on = (v) => t(lang, v ? 'counting.on' : 'counting.off');
      const none = t(lang, 'counting.none');
      const wrongRole = !config.wrong_role_id ? none : config.wrong_role_minutes
        ? t(lang, 'counting.config.roleFor', { role: `<@&${config.wrong_role_id}>`, minutes: config.wrong_role_minutes })
        : t(lang, 'counting.config.roleUntil', { role: `<@&${config.wrong_role_id}>` });
      return reply(interaction, [
        t(lang, 'counting.config.title', { state: on(config.enabled) }),
        t(lang, 'counting.config.channel', { channel: config.channel_id ? `<#${config.channel_id}>` : none, current: config.current_number, record: config.high_score }),
        t(lang, 'counting.config.rules', { double: on(config.allow_double), math: on(config.math), reset: on(config.reset_on_wrong), deleted: on(config.delete_wrong) }),
        t(lang, 'counting.config.saves', { saves: config.saves, max: config.saves_max, more: config.saves_max ? t(lang, 'counting.config.saveEvery', { every: config.save_every }) : '', milestone: config.milestone_every || never, start: config.start_number }),
        t(lang, 'counting.config.reactions', { ok: config.react_ok, bad: config.react_bad, record: config.react_record, note: config.record_every ? t(lang, 'counting.config.recordEvery', { every: config.record_every }) : t(lang, 'counting.config.recordOff') }),
        t(lang, 'counting.config.roles', { wrongRole, topRole: config.top_role_id ? `<@&${config.top_role_id}>` : none, alerts: config.alert_seconds ? t(lang, 'counting.config.seconds', { seconds: config.alert_seconds }) : never }),
      ].join('\n'));
    }
    if (sub === 'set') {
      const name = interaction.options.getString('setting', true);
      const raw = interaction.options.getString('value', true).trim();
      const def = SETTINGS[name];
      if (!def) return no(interaction, t(lang, 'counting.set.unknown'));
      let value;
      if (def.kind === 'boolean') { value = parseBool(raw); if (value === null) return no(interaction, t(lang, 'counting.set.onOff')); }
      else if (def.kind === 'number') {
        value = Number(raw);
        if (!Number.isInteger(value) || value < def.min || value > def.max) return no(interaction, t(lang, 'counting.set.number', { min: def.min, max: def.max }));
      } else if (def.kind === 'role') {
        if (/^(none|off|no)$/i.test(raw)) value = null;
        else {
          const roleId = raw.replace(/\D/g, '');
          const role = roleId && interaction.guild.roles.cache.get(roleId);
          if (!role) return no(interaction, t(lang, 'counting.set.role'));
          if (!role.editable) return no(interaction, t(lang, 'counting.set.roleNotEditable'));
          value = role.id;
        }
      } else { if (!raw || raw.length > 64) return no(interaction, t(lang, 'counting.set.emoji')); value = raw; }
      const patch = { [def.column]: value };
      if (name === 'saves') patch.saves = Math.min(config.saves, value);
      await db.updateConfig(interaction.guild.id, patch);
      const shown = value === null ? t(lang, 'counting.none') : typeof value === 'boolean' ? t(lang, value ? 'counting.on' : 'counting.off') : def.kind === 'role' ? `<@&${value}>` : value;
      return yes(interaction, t(lang, 'counting.set.done', { setting: t(lang, `counting.setting.${name.replace(/_([a-z])/g, (m, c) => c.toUpperCase())}`), value: shown }));
    }
    if (sub === 'number') {
      const value = interaction.options.getInteger('value', true);
      await db.updateConfig(interaction.guild.id, { current_number: value, last_user_id: null, last_message_id: null, high_score: Math.max(config.high_score, value) });
      return yes(interaction, t(lang, 'counting.numberSet', { value, next: value + 1 }));
    }
    if (sub === 'reset') {
      await db.updateConfig(interaction.guild.id, { current_number: Number(config.start_number ?? 0), last_user_id: null, last_message_id: null });
      if (interaction.options.getBoolean('clear_scores')) await db.resetUsers(interaction.guild.id);
      return yes(interaction, t(lang, 'counting.resetDone', { next: Number(config.start_number ?? 0) + 1 }));
    }
    if (sub === 'next') {
      if (!config.enabled) return no(interaction, t(lang, 'counting.notOn'));
      const vars = { next: Number(config.current_number) + 1, channel: `<#${config.channel_id}>`, record: config.high_score };
      return reply(interaction, t(lang, config.channel_id ? 'counting.next.in' : 'counting.next.plain', vars));
    }
    if (sub === 'stats') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const row = await db.userStats(interaction.guild.id, user.id);
      const total = row.correct + row.wrong;
      const vars = { name: user.username, correct: row.correct, wrong: row.wrong, percent: total ? Math.round((row.correct / total) * 100) : 0, best: row.best };
      return reply(interaction, t(lang, total ? 'counting.stats.percent' : 'counting.stats.plain', vars));
    }
    const top = await db.topUsers(interaction.guild.id, 10);
    if (!top.length) return reply(interaction, t(lang, 'counting.leaderboard.empty'));
    return reply(interaction, [t(lang, 'counting.leaderboard.title'), ...top.map((row, index) => t(lang, 'counting.leaderboard.line', { rank: index + 1, user: `<@${row.user_id}>`, correct: row.correct, best: row.best }))].join('\n'));
  },
};
