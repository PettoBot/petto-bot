const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/suggestions');
const suggestions = require('../../utils/suggestions');
const { buildPanel } = require('../../interactions/suggestions');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const V2 = MessageFlags.IsComponentsV2;
const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const GREY = 0x4b4f59;
const reply = (interaction, text, color = GREY, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const idOption = (o) => o.setName('id').setDescription('The ID of the suggestion (like si2tr-foytm)').setRequired(true);
const reasonOption = (o) => o.setName('reason').setDescription('Why (it is shown on the suggestion)').setMaxLength(1000).setRequired(false);

const SETTINGS = {
  listen: { column: 'listen_channel', kind: 'boolean', label: 'Every message in the channel is a suggestion' },
  command: { column: 'allow_command', kind: 'boolean', label: 'The suggest command works' },
  thread: { column: 'thread', kind: 'boolean', label: 'A thread for each suggestion' },
  self_vote: { column: 'self_vote', kind: 'boolean', label: 'The author can vote on their own suggestion' },
  dm: { column: 'dm_author', kind: 'boolean', label: 'A DM to the author when the staff answers' },
  anonymous: { column: 'anonymous', kind: 'boolean', label: 'Suggestions do not show who made them' },
  colors: { column: 'status_colors', kind: 'boolean', label: 'The suggestion is colored by its status' },
  up_emoji: { column: 'up_emoji', kind: 'emoji', label: 'Emoji of the vote in favor' },
  down_emoji: { column: 'down_emoji', kind: 'emoji', label: 'Emoji of the vote against' },
  thread_name: { column: 'thread_name', kind: 'text', label: 'Name of the threads' },
  staff_role: { column: 'staff_role_id', kind: 'role', label: 'Role that can answer suggestions' },
  design: { column: 'embed_template', kind: 'design', label: 'Saved design of the suggestions' },
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
    const config = await db.getConfig(interaction.guild.id);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    const staff = suggestions.isStaff(interaction.member, config);
    const staffOnly = ['approve', 'deny', 'consider', 'implement', 'reopen', 'delete', 'view', 'votes', 'list', 'block', 'unblock', 'config'];
    if (staffOnly.includes(sub) && !staff) return reply(interaction, `${EMOJI.DENY}  Only the staff can use this.`, RED, true);
    if (!staffOnly.includes(sub) && !manager) return reply(interaction, `${EMOJI.DENY}  You need the **Manage Server** permission.`, RED, true);

    switch (sub) {
      case 'setup': return setup(interaction, config);
      case 'enable': return toggle(interaction, config, true);
      case 'disable': return toggle(interaction, config, false);
      case 'config': return show(interaction, config);
      case 'set': return change(interaction);
      case 'approve': return respond(interaction, 'approved');
      case 'deny': return respond(interaction, 'denied');
      case 'consider': return respond(interaction, 'considering');
      case 'implement': return respond(interaction, 'implemented');
      case 'reopen': return respond(interaction, 'pending');
      case 'delete': return erase(interaction);
      case 'view': return view(interaction, config);
      case 'votes': return whoVoted(interaction);
      case 'list': return list(interaction);
      case 'block': return blocking(interaction, true);
      case 'unblock': return blocking(interaction, false);
      case 'panel': return panel(interaction, config);
      default: return reply(interaction, 'That is not something I can do.', RED, true);
    }
  },
};

async function setup(interaction, config) {
  const channel = interaction.options.getChannel('channel', true);
  const me = interaction.guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, `${EMOJI.DENY}  I need to see and write in ${channel}.`, RED, true);
  await db.updateConfig(interaction.guild.id, { channel_id: channel.id, enabled: true });
  require('../../events/messageCreateSuggestion').forget(interaction.guild.id);
  const how = [config.allow_command ? '`suggest <text>`' : null, config.listen_channel ? `writing in ${channel}` : null].filter(Boolean).join(' or ') || 'the panel (`suggestion panel`)';
  return reply(interaction, `${EMOJI.APPROVE}  Suggestions are on. They go to ${channel}, and members make them with ${how}. Change how it looks and works in the dashboard (Suggestions).`, GREEN);
}

async function toggle(interaction, config, enabled) {
  if (enabled && !config.channel_id) return reply(interaction, `${EMOJI.DENY}  Pick the channel first with \`suggestion setup\`.`, RED, true);
  await db.updateConfig(interaction.guild.id, { enabled });
  require('../../events/messageCreateSuggestion').forget(interaction.guild.id);
  return reply(interaction, `${EMOJI.APPROVE}  Suggestions are ${enabled ? 'on' : 'off'}.`, GREEN);
}

async function show(interaction, c) {
  const yes = (v) => (v ? 'on' : 'off');
  const lines = [
    `**Suggestions** · ${c.enabled ? 'on' : 'off'}`,
    `Channel: ${c.channel_id ? `<#${c.channel_id}>` : 'none'}`,
    `Votes: ${c.up_emoji} / ${c.down_emoji} · the author can vote: ${yes(c.self_vote)}`,
    `The suggest command: ${yes(c.allow_command)} · every message in the channel: ${yes(c.listen_channel)}`,
    `Thread: ${yes(c.thread)}${c.thread ? ` (${c.thread_name})` : ''} · DM to the author: ${yes(c.dm_author)} · anonymous: ${yes(c.anonymous)}`,
    `Staff role: ${c.staff_role_id ? `<@&${c.staff_role_id}>` : 'only who has Manage Server'}`,
    `Design: ${c.embed_template ? `\`${c.embed_template}\`` : 'the usual one'}`,
    '',
    '**How to answer** (the ID is under each suggestion, like `si2tr-foytm`):',
    '`suggestion approve <id> [reason]` · `deny` · `consider` · `implement` · `reopen`',
    '`suggestion votes <id>` (who voted) · `view <id>` · `list [status]` · `delete <id>` · `block <user>` · `unblock <user>`',
    'Also in the dashboard: **Suggestions**, with a button for each answer.',
  ];
  return reply(interaction, lines.join('\n'));
}

async function change(interaction) {
  const name = interaction.options.getString('setting', true);
  const raw = interaction.options.getString('value', true).trim();
  const def = SETTINGS[name];
  if (!def) return reply(interaction, `${EMOJI.DENY}  I do not know that setting.`, RED, true);
  let value;
  if (def.kind === 'boolean') {
    value = parseBool(raw);
    if (value === null) return reply(interaction, `${EMOJI.DENY}  Write on or off.`, RED, true);
  } else if (def.kind === 'emoji') {
    if (!raw || raw.length > 64) return reply(interaction, `${EMOJI.DENY}  Write one emoji.`, RED, true);
    value = raw;
  } else if (def.kind === 'role') {
    if (/^(none|off|no)$/i.test(raw)) value = null;
    else {
      const id = raw.replace(/\D/g, '');
      if (!id || !interaction.guild.roles.cache.has(id)) return reply(interaction, `${EMOJI.DENY}  Mention a role of this server (or write none).`, RED, true);
      value = id;
    }
  } else if (def.kind === 'design') {
    if (/^(none|off|no)$/i.test(raw)) value = null;
    else {
      if (!(await getTemplate(interaction.guild.id, raw))) return reply(interaction, `${EMOJI.DENY}  There is no saved design called \`${raw}\`. Make it in the dashboard (Embeds).`, RED, true);
      value = raw;
    }
  } else value = raw.slice(0, 100);
  await db.updateConfig(interaction.guild.id, { [def.column]: value });
  require('../../events/messageCreateSuggestion').forget(interaction.guild.id);
  return reply(interaction, `${EMOJI.APPROVE}  ${def.label}: **${value === null ? 'none' : typeof value === 'boolean' ? (value ? 'on' : 'off') : value}**.`, GREEN);
}

async function respond(interaction, status) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const reason = interaction.options.getString('reason');
  const result = await suggestions.answer({ guild: interaction.guild, member: interaction.member, id, status, reason });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  return reply(interaction, `${EMOJI.APPROVE}  The suggestion \`${id}\` is now **${suggestions.STATUSES[status].label.toLowerCase()}**.`, GREEN);
}

async function erase(interaction) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const result = await suggestions.remove({ guild: interaction.guild, member: interaction.member, id });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  return reply(interaction, `${EMOJI.APPROVE}  Deleted the suggestion \`${id}\`.`, GREEN);
}

const short = (row) => `\`${row.id}\` · #${row.number} · ${suggestions.STATUSES[row.status].label} · ${String(row.content).replace(/\s+/g, ' ').slice(0, 70)}`;

async function view(interaction) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const row = await db.getSuggestion(interaction.guild.id, id);
  if (!row) return reply(interaction, `${EMOJI.DENY}  There is no suggestion with the ID \`${id}\`.`, RED, true);
  const tally = await db.tally(id);
  const link = row.message_id ? `https://discord.com/channels/${interaction.guild.id}/${row.channel_id}/${row.message_id}` : '';
  return reply(interaction, [`**Suggestion #${row.number}** · \`${row.id}\` · ${suggestions.STATUSES[row.status].label}`, `By <@${row.author_id}> · ${config_up(tally)}`, row.content.slice(0, 900), row.status_reason ? `Reason: ${row.status_reason}` : '', link].filter(Boolean).join('\n'));
}
const config_up = (tally) => `${tally.up} in favor · ${tally.down} against`;

async function whoVoted(interaction) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const result = await suggestions.voters({ guild: interaction.guild, member: interaction.member, id });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  const config = await db.getConfig(interaction.guild.id);
  const names = (ids) => (ids.length ? ids.slice(0, 40).map((userId) => `<@${userId}>`).join(' ') + (ids.length > 40 ? ` and ${ids.length - 40} more` : '') : 'nobody');
  const text = [`**Votes of #${result.row.number}** · \`${result.row.id}\``, `${config.up_emoji} **${result.up.length}** in favor: ${names(result.up)}`, `${config.down_emoji} **${result.down.length}** against: ${names(result.down)}`].join('\n');
  return reply(interaction, text, GREY, true);
}

async function list(interaction) {
  const status = interaction.options.getString('status');
  const rows = await db.listSuggestions(interaction.guild.id, { status, limit: 10 });
  if (!rows.length) return reply(interaction, 'There are no suggestions yet.');
  return reply(interaction, rows.map(short).join('\n'));
}

async function blocking(interaction, on) {
  const user = interaction.options.getUser('user', true);
  if (on) await db.block(interaction.guild.id, user.id, interaction.user.id);
  else if (!(await db.unblock(interaction.guild.id, user.id))) return reply(interaction, `${EMOJI.DENY}  ${user} was not blocked.`, RED, true);
  return reply(interaction, `${EMOJI.APPROVE}  ${user} ${on ? 'cannot make suggestions now' : 'can make suggestions again'}.`, GREEN);
}

async function panel(interaction, config) {
  if (!config.enabled) return reply(interaction, `${EMOJI.DENY}  Turn suggestions on first with \`suggestion setup\`.`, RED, true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, `${EMOJI.DENY}  I cannot write in ${channel}.`, RED, true);
  await channel.send(buildPanel(interaction.guild, config));
  return reply(interaction, `${EMOJI.APPROVE}  The panel is in ${channel}.`, GREEN, true);
}
