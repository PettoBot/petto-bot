const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/counting');
const { plainCard } = require('../../utils/plainCard');
const { EMOJI } = require('../../utils/emojis');

const V2 = MessageFlags.IsComponentsV2;
const reply = (interaction, text, ephemeral = false) => interaction.reply({ ...plainCard(text), flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const no = (interaction, text) => reply(interaction, `${EMOJI.DENY}  ${text}`, true);
const yes = (interaction, text) => reply(interaction, `${EMOJI.APPROVE}  ${text}`);

const SETTINGS = {
  double: { column: 'allow_double', kind: 'boolean', label: 'The same person can count twice in a row' },
  math: { column: 'math', kind: 'boolean', label: 'Sums such as 2*3+1 count as a number' },
  reset: { column: 'reset_on_wrong', kind: 'boolean', label: 'A mistake sends the count back to the start' },
  delete: { column: 'delete_wrong', kind: 'boolean', label: 'Wrong numbers are deleted' },
  edits: { column: 'announce_edits', kind: 'boolean', label: 'Say when the last number is edited or deleted' },
  ok_emoji: { column: 'react_ok', kind: 'emoji', label: 'Reaction of a right number' },
  bad_emoji: { column: 'react_bad', kind: 'emoji', label: 'Reaction of a wrong number' },
  record_emoji: { column: 'react_record', kind: 'emoji', label: 'Reaction of a new record' },
  saves: { column: 'saves_max', kind: 'number', min: 0, max: 5, label: 'Saves the server can keep (a save forgives one mistake)' },
  save_every: { column: 'save_every', kind: 'number', min: 10, max: 10000, label: 'A save is earned every this many numbers' },
  milestone: { column: 'milestone_every', kind: 'number', min: 0, max: 100000, label: 'A message every this many numbers (0 for none)' },
  start: { column: 'start_number', kind: 'number', min: 0, max: 1000000, label: 'The number the count starts after (0 = starts at 1)' },
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
      .addStringOption((o) => o.setName('value').setDescription('on or off, an emoji, or a number').setRequired(true).setMaxLength(64)))
    .addSubcommand((s) => s.setName('number').setDescription('Set the number the count is at now.').addIntegerOption((o) => o.setName('value').setDescription('The last number counted (the next one is this plus 1)').setMinValue(0).setMaxValue(1000000).setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Send the count back to the start and clear who counted.').addBooleanOption((o) => o.setName('clear_scores').setDescription('Also clear the scores of everyone').setRequired(false)))
    .addSubcommand((s) => s.setName('next').setDescription('See which number comes next.'))
    .addSubcommand((s) => s.setName('stats').setDescription('The numbers of a member in the counting game.').addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Who has counted the most.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (['setup', 'disable', 'set', 'number', 'reset'].includes(sub) && !manager) return no(interaction, 'You need the **Manage Server** permission.');
    const config = await db.getConfig(interaction.guild.id);

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions])) return no(interaction, `I need to see, write and react in ${channel}.`);
      await db.updateConfig(interaction.guild.id, { enabled: true, channel_id: channel.id, ...(config.channel_id === channel.id ? {} : { current_number: Number(config.start_number ?? 0), last_user_id: null, last_message_id: null }) });
      return yes(interaction, `The counting game is on in ${channel}. The first number is **${Number(config.start_number ?? 0) + 1}**.`);
    }
    if (sub === 'disable') {
      await db.updateConfig(interaction.guild.id, { enabled: false });
      return yes(interaction, 'The counting game is off. The numbers are kept.');
    }
    if (sub === 'config') {
      const on = (v) => (v ? 'on' : 'off');
      return reply(interaction, [
        `**Counting** · ${config.enabled ? 'on' : 'off'}`,
        `Channel: ${config.channel_id ? `<#${config.channel_id}>` : 'none'} · now at **${config.current_number}** · record **${config.high_score}**`,
        `The same person twice: ${on(config.allow_double)} · sums: ${on(config.math)} · a mistake resets: ${on(config.reset_on_wrong)} · wrong numbers deleted: ${on(config.delete_wrong)}`,
        `Saves: ${config.saves}/${config.saves_max}${config.saves_max ? ` (one more every ${config.save_every})` : ''} · message every ${config.milestone_every || 'never'} · starts after ${config.start_number}`,
        `Reactions: ${config.react_ok} ${config.react_bad} ${config.react_record}`,
      ].join('\n'));
    }
    if (sub === 'set') {
      const name = interaction.options.getString('setting', true);
      const raw = interaction.options.getString('value', true).trim();
      const def = SETTINGS[name];
      if (!def) return no(interaction, 'I do not know that setting.');
      let value;
      if (def.kind === 'boolean') { value = parseBool(raw); if (value === null) return no(interaction, 'Write on or off.'); }
      else if (def.kind === 'number') {
        value = Number(raw);
        if (!Number.isInteger(value) || value < def.min || value > def.max) return no(interaction, `Write a whole number from ${def.min} to ${def.max}.`);
      } else { if (!raw || raw.length > 64) return no(interaction, 'Write one emoji.'); value = raw; }
      const patch = { [def.column]: value };
      if (name === 'saves') patch.saves = Math.min(config.saves, value);
      await db.updateConfig(interaction.guild.id, patch);
      return yes(interaction, `${def.label}: **${typeof value === 'boolean' ? (value ? 'on' : 'off') : value}**.`);
    }
    if (sub === 'number') {
      const value = interaction.options.getInteger('value', true);
      await db.updateConfig(interaction.guild.id, { current_number: value, last_user_id: null, last_message_id: null, high_score: Math.max(config.high_score, value) });
      return yes(interaction, `The count is at **${value}**. The next number is **${value + 1}**.`);
    }
    if (sub === 'reset') {
      await db.updateConfig(interaction.guild.id, { current_number: Number(config.start_number ?? 0), last_user_id: null, last_message_id: null });
      if (interaction.options.getBoolean('clear_scores')) await db.resetUsers(interaction.guild.id);
      return yes(interaction, `The count starts again. The next number is **${Number(config.start_number ?? 0) + 1}**.`);
    }
    if (sub === 'next') {
      if (!config.enabled) return no(interaction, 'The counting game is not on in this server.');
      return reply(interaction, `The next number is **${Number(config.current_number) + 1}**${config.channel_id ? ` in <#${config.channel_id}>` : ''}. Record: **${config.high_score}**.`);
    }
    if (sub === 'stats') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const row = await db.userStats(interaction.guild.id, user.id);
      const total = row.correct + row.wrong;
      return reply(interaction, `**${user.username}** in the counting game\nRight: **${row.correct}** · wrong: **${row.wrong}**${total ? ` · ${Math.round((row.correct / total) * 100)}% right` : ''}\nHighest number: **${row.best}**`);
    }
    const top = await db.topUsers(interaction.guild.id, 10);
    if (!top.length) return reply(interaction, 'Nobody has counted yet.');
    return reply(interaction, ['**Counting leaderboard**', ...top.map((row, index) => `${index + 1}. <@${row.user_id}> · **${row.correct}** right · highest **${row.best}**`)].join('\n'));
  },
};
