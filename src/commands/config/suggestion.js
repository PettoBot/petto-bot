const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/suggestions');
const suggestions = require('../../utils/suggestions');
const { buildPanel } = require('../../interactions/suggestions');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const GREY = 0x4b4f59;
const reply = (interaction, text, color = GREY, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const idOption = (o) => o.setName('id').setDescription('The ID of the suggestion (like si2tr-foytm)').setRequired(true);
const reasonOption = (o) => o.setName('reason').setDescription('Why (it is shown on the suggestion)').setMaxLength(1000).setRequired(false);

// The labels name the choices of the slash command (builder texts stay in English); the answers use `suggestions.setting.<name>`.
const SETTINGS = {
  listen: { column: 'listen_channel', kind: 'boolean', label: 'Every message in the channel is a suggestion' }, // i18n-ignore: choice name of the builder
  command: { column: 'allow_command', kind: 'boolean', label: 'The suggest command works' }, // i18n-ignore: choice name of the builder
  thread: { column: 'thread', kind: 'boolean', label: 'A thread for each suggestion' }, // i18n-ignore: choice name of the builder
  self_vote: { column: 'self_vote', kind: 'boolean', label: 'The author can vote on their own suggestion' }, // i18n-ignore: choice name of the builder
  dm: { column: 'dm_author', kind: 'boolean', label: 'A DM to the author when the staff answers' }, // i18n-ignore: choice name of the builder
  anonymous: { column: 'anonymous', kind: 'boolean', label: 'Suggestions do not show who made them' }, // i18n-ignore: choice name of the builder
  colors: { column: 'status_colors', kind: 'boolean', label: 'The suggestion is colored by its status' }, // i18n-ignore: choice name of the builder
  up_emoji: { column: 'up_emoji', kind: 'emoji', label: 'Emoji of the vote in favor' }, // i18n-ignore: choice name of the builder
  down_emoji: { column: 'down_emoji', kind: 'emoji', label: 'Emoji of the vote against' }, // i18n-ignore: choice name of the builder
  thread_name: { column: 'thread_name', kind: 'text', label: 'Name of the threads' }, // i18n-ignore: choice name of the builder
  staff_role: { column: 'staff_role_id', kind: 'role', label: 'Role that can answer suggestions' }, // i18n-ignore: choice name of the builder
  design: { column: 'embed_template', kind: 'design', label: 'Saved design of the suggestions' }, // i18n-ignore: choice name of the builder
};

const parseBool = (text) => (/^(true|on|yes|si|sí|1|enable|enabled)$/i.test(text) ? true : /^(false|off|no|0|disable|disabled)$/i.test(text) ? false : null);

module.exports = {
  aliases: ['suggestions', 'sg'],
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Set up suggestions and answer them: approve, deny, consider, implement (with the ID).')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('setup').setDescription('Turn suggestions on in a channel.').addChannelOption((o) => o.setName('channel').setDescription('Where the suggestions go').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn suggestions on.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn suggestions off.'))
    .addSubcommand((s) => s.setName('config').setDescription('See how suggestions are set up.'))
    .addSubcommand((s) => s
      .setName('set')
      .setDescription('Change one setting.')
      .addStringOption((o) => o.setName('setting').setDescription('What to change').setRequired(true).addChoices(...Object.entries(SETTINGS).map(([name, def]) => ({ name: `${name}: ${def.label}`.slice(0, 100), value: name }))))
      .addStringOption((o) => o.setName('value').setDescription('The new value: on or off, an emoji, text, a role or the name of a saved design (none removes it)').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('approve').setDescription('Approve a suggestion by its ID, with a reason if you want.').addStringOption(idOption).addStringOption(reasonOption))
    .addSubcommand((s) => s.setName('deny').setDescription('Deny a suggestion by its ID, with a reason if you want.').addStringOption(idOption).addStringOption(reasonOption))
    .addSubcommand((s) => s.setName('consider').setDescription('Mark a suggestion by its ID as under consideration.').addStringOption(idOption).addStringOption(reasonOption))
    .addSubcommand((s) => s.setName('implement').setDescription('Mark a suggestion by its ID as implemented.').addStringOption(idOption).addStringOption(reasonOption))
    .addSubcommand((s) => s.setName('reopen').setDescription('Take a suggestion by its ID back to pending (open to votes again).').addStringOption(idOption))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a suggestion, its message and its thread.').addStringOption(idOption))
    .addSubcommand((s) => s.setName('view').setDescription('See a suggestion.').addStringOption(idOption))
    .addSubcommand((s) => s.setName('votes').setDescription('See who voted a suggestion, in favor and against (by its ID).').addStringOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription('The latest suggestions.').addStringOption((o) => o.setName('status').setDescription('Only the ones with this status').setRequired(false).addChoices(...Object.keys(suggestions.STATUSES).map((value) => ({ name: value, value })))))
    .addSubcommand((s) => s.setName('block').setDescription('Stop a member from making suggestions.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
    .addSubcommand((s) => s.setName('unblock').setDescription('Let a member make suggestions again.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
    .addSubcommand((s) => s.setName('panel').setDescription('Post a message with a button that opens the form to suggest.').addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const config = await db.getConfig(interaction.guild.id);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    const staff = suggestions.isStaff(interaction.member, config);
    const staffOnly = ['approve', 'deny', 'consider', 'implement', 'reopen', 'delete', 'view', 'votes', 'list', 'block', 'unblock', 'config'];
    if (staffOnly.includes(sub) && !staff) return reply(interaction, t(lang, 'suggestions.onlyStaff', { emoji: EMOJI.DENY }), RED, true);
    if (!staffOnly.includes(sub) && !manager) return reply(interaction, t(lang, 'suggestions.needManageServer', { emoji: EMOJI.DENY }), RED, true);

    switch (sub) {
      case 'setup': return setup(interaction, config, lang);
      case 'enable': return toggle(interaction, config, true, lang);
      case 'disable': return toggle(interaction, config, false, lang);
      case 'config': return show(interaction, config, lang);
      case 'set': return change(interaction, lang);
      case 'approve': return respond(interaction, 'approved', lang);
      case 'deny': return respond(interaction, 'denied', lang);
      case 'consider': return respond(interaction, 'considering', lang);
      case 'implement': return respond(interaction, 'implemented', lang);
      case 'reopen': return respond(interaction, 'pending', lang);
      case 'delete': return erase(interaction, lang);
      case 'view': return view(interaction, lang);
      case 'votes': return whoVoted(interaction, lang);
      case 'list': return list(interaction, lang);
      case 'block': return blocking(interaction, true, lang);
      case 'unblock': return blocking(interaction, false, lang);
      case 'panel': return panel(interaction, config, lang);
      default: return reply(interaction, t(lang, 'suggestions.unknownAction'), RED, true);
    }
  },
};

const onOff = (lang, value) => t(lang, value ? 'suggestions.on' : 'suggestions.off');

async function setup(interaction, config, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const me = interaction.guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, t(lang, 'suggestions.setup.cannotWrite', { emoji: EMOJI.DENY, channel: `${channel}` }), RED, true);
  await db.updateConfig(interaction.guild.id, { channel_id: channel.id, enabled: true });
  require('../../events/messageCreateSuggestion').forget(interaction.guild.id);
  const how = config.allow_command ? (config.listen_channel ? 'both' : 'command') : config.listen_channel ? 'listen' : 'panel';
  return reply(interaction, t(lang, `suggestions.setup.done.${how}`, { emoji: EMOJI.APPROVE, channel: `${channel}` }), GREEN);
}

async function toggle(interaction, config, enabled, lang) {
  if (enabled && !config.channel_id) return reply(interaction, t(lang, 'suggestions.toggle.pickChannel', { emoji: EMOJI.DENY }), RED, true);
  await db.updateConfig(interaction.guild.id, { enabled });
  require('../../events/messageCreateSuggestion').forget(interaction.guild.id);
  return reply(interaction, t(lang, enabled ? 'suggestions.toggle.on' : 'suggestions.toggle.off', { emoji: EMOJI.APPROVE }), GREEN);
}

async function show(interaction, c, lang) {
  const yes = (v) => onOff(lang, v);
  const threadName = c.thread_name === t('en', 'suggestions.thread.name') ? t(lang, 'suggestions.thread.name') : c.thread_name;
  const lines = [
    t(lang, 'suggestions.config.title', { state: onOff(lang, c.enabled) }),
    t(lang, 'suggestions.config.channel', { channel: c.channel_id ? `<#${c.channel_id}>` : t(lang, 'suggestions.none') }),
    t(lang, 'suggestions.config.votes', { up: c.up_emoji, down: c.down_emoji, selfVote: yes(c.self_vote) }),
    t(lang, 'suggestions.config.ways', { command: yes(c.allow_command), listen: yes(c.listen_channel) }),
    t(lang, 'suggestions.config.thread', { thread: `${yes(c.thread)}${c.thread ? ` (${threadName})` : ''}`, dm: yes(c.dm_author), anonymous: yes(c.anonymous) }),
    t(lang, 'suggestions.config.staffRole', { role: c.staff_role_id ? `<@&${c.staff_role_id}>` : t(lang, 'suggestions.config.managers') }),
    t(lang, 'suggestions.config.design', { design: c.embed_template ? `\`${c.embed_template}\`` : t(lang, 'suggestions.config.usualDesign') }),
    '',
    t(lang, 'suggestions.config.howTitle'),
    t(lang, 'suggestions.config.howAnswer'),
    t(lang, 'suggestions.config.howMore'),
    t(lang, 'suggestions.config.howDashboard'),
  ];
  return reply(interaction, lines.join('\n'));
}

async function change(interaction, lang) {
  const name = interaction.options.getString('setting', true);
  const raw = interaction.options.getString('value', true).trim();
  const def = SETTINGS[name];
  if (!def) return reply(interaction, t(lang, 'suggestions.set.unknown', { emoji: EMOJI.DENY }), RED, true);
  let value;
  if (def.kind === 'boolean') {
    value = parseBool(raw);
    if (value === null) return reply(interaction, t(lang, 'suggestions.set.onOff', { emoji: EMOJI.DENY }), RED, true);
  } else if (def.kind === 'emoji') {
    if (!raw || raw.length > 64) return reply(interaction, t(lang, 'suggestions.set.emoji', { emoji: EMOJI.DENY }), RED, true);
    value = raw;
  } else if (def.kind === 'role') {
    if (/^(none|off|no)$/i.test(raw)) value = null;
    else {
      const id = raw.replace(/\D/g, '');
      if (!id || !interaction.guild.roles.cache.has(id)) return reply(interaction, t(lang, 'suggestions.set.role', { emoji: EMOJI.DENY }), RED, true);
      value = id;
    }
  } else if (def.kind === 'design') {
    if (/^(none|off|no)$/i.test(raw)) value = null;
    else {
      if (!(await getTemplate(interaction.guild.id, raw))) return reply(interaction, t(lang, 'suggestions.set.noDesign', { emoji: EMOJI.DENY, name: raw }), RED, true);
      value = raw;
    }
  } else value = raw.slice(0, 100);
  await db.updateConfig(interaction.guild.id, { [def.column]: value });
  require('../../events/messageCreateSuggestion').forget(interaction.guild.id);
  const shown = value === null ? t(lang, 'suggestions.none') : typeof value === 'boolean' ? onOff(lang, value) : value;
  return reply(interaction, t(lang, 'suggestions.set.done', { emoji: EMOJI.APPROVE, setting: t(lang, `suggestions.setting.${name.replace(/_([a-z])/g, (m, c) => c.toUpperCase())}`), value: shown }), GREEN);
}

async function respond(interaction, status, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const reason = interaction.options.getString('reason');
  const result = await suggestions.answer({ guild: interaction.guild, member: interaction.member, id, status, reason });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  return reply(interaction, t(lang, 'suggestions.answered', { emoji: EMOJI.APPROVE, id, status: suggestions.statusLabel(status, lang).toLocaleLowerCase(lang) }), GREEN);
}

async function erase(interaction, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const result = await suggestions.remove({ guild: interaction.guild, member: interaction.member, id });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  return reply(interaction, t(lang, 'suggestions.deleted', { emoji: EMOJI.APPROVE, id }), GREEN);
}

const short = (row, lang) => `\`${row.id}\` · #${row.number} · ${suggestions.statusLabel(row.status, lang)} · ${String(row.content).replace(/\s+/g, ' ').slice(0, 70)}`;

async function view(interaction, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const row = await db.getSuggestion(interaction.guild.id, id);
  if (!row) return reply(interaction, t(lang, 'suggestions.view.notFound', { emoji: EMOJI.DENY, id }), RED, true);
  const tally = await db.tally(id);
  const link = row.message_id ? `https://discord.com/channels/${interaction.guild.id}/${row.channel_id}/${row.message_id}` : '';
  return reply(interaction, [
    t(lang, 'suggestions.view.title', { number: row.number, id: row.id, status: suggestions.statusLabel(row.status, lang) }),
    t(lang, 'suggestions.view.by', { author: `<@${row.author_id}>`, up: tally.up, down: tally.down }),
    row.content.slice(0, 900),
    row.status_reason ? t(lang, 'suggestions.view.reason', { reason: row.status_reason }) : '',
    link,
  ].filter(Boolean).join('\n'));
}

async function whoVoted(interaction, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const result = await suggestions.voters({ guild: interaction.guild, member: interaction.member, id });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  const config = await db.getConfig(interaction.guild.id);
  const names = (ids) => {
    if (!ids.length) return t(lang, 'suggestions.votes.nobody');
    const shown = ids.slice(0, 40).map((userId) => `<@${userId}>`).join(' ');
    return ids.length > 40 ? t(lang, 'suggestions.votes.more', { list: shown, count: ids.length - 40 }) : shown;
  };
  const text = [
    t(lang, 'suggestions.votes.title', { number: result.row.number, id: result.row.id }),
    t(lang, 'suggestions.votes.up', { emoji: config.up_emoji, count: result.up.length, names: names(result.up) }),
    t(lang, 'suggestions.votes.down', { emoji: config.down_emoji, count: result.down.length, names: names(result.down) }),
  ].join('\n');
  return reply(interaction, text, GREY, true);
}

async function list(interaction, lang) {
  const status = interaction.options.getString('status');
  const rows = await db.listSuggestions(interaction.guild.id, { status, limit: 10 });
  if (!rows.length) return reply(interaction, t(lang, 'suggestions.list.empty'));
  return reply(interaction, rows.map((row) => short(row, lang)).join('\n'));
}

async function blocking(interaction, on, lang) {
  const user = interaction.options.getUser('user', true);
  if (on) await db.block(interaction.guild.id, user.id, interaction.user.id);
  else if (!(await db.unblock(interaction.guild.id, user.id))) return reply(interaction, t(lang, 'suggestions.block.notBlocked', { emoji: EMOJI.DENY, user: `${user}` }), RED, true);
  return reply(interaction, t(lang, on ? 'suggestions.block.blocked' : 'suggestions.block.unblocked', { emoji: EMOJI.APPROVE, user: `${user}` }), GREEN);
}

async function panel(interaction, config, lang) {
  if (!config.enabled) return reply(interaction, t(lang, 'suggestions.panel.turnOnFirst', { emoji: EMOJI.DENY }), RED, true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, t(lang, 'suggestions.panel.cannotWrite', { emoji: EMOJI.DENY, channel: `${channel}` }), RED, true);
  await channel.send(buildPanel(interaction.guild, config, lang));
  return reply(interaction, t(lang, 'suggestions.panel.posted', { emoji: EMOJI.APPROVE, channel: `${channel}` }), GREEN, true);
}
