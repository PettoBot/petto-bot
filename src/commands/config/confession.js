const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/confessions');
const confessions = require('../../utils/confessions');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const V2 = MessageFlags.IsComponentsV2;
const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const GREY = 0x4b4f59;
const reply = (interaction, text, color = GREY, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const idOption = (o) => o.setName('id').setDescription('The ID of the confession (like si2tr-foytm)').setRequired(true);

const SETTINGS = {
  review: { column: 'require_review', kind: 'boolean', label: 'The staff checks each confession before it shows' },
  command: { column: 'allow_command', kind: 'boolean', label: 'The confess command works' },
  images: { column: 'allow_images', kind: 'boolean', label: 'Confessions can have a picture' },
  replies: { column: 'allow_replies', kind: 'boolean', label: 'Anonymous replies in a thread' },
  keep_author: { column: 'keep_author', kind: 'boolean', label: 'Keep who confessed (only the staff can see it)' },
  webhook: { column: 'use_webhook', kind: 'boolean', label: 'Send through a webhook with its own name and picture' },
  webhook_name: { column: 'webhook_name', kind: 'text', label: 'Name it shows' },
  webhook_avatar: { column: 'webhook_avatar', kind: 'url', label: 'Picture it shows (a link, none for the bot picture)' },
  title: { column: 'title', kind: 'text', label: 'Title of each confession' },
  footer: { column: 'footer', kind: 'text', label: 'Small text under each confession (none removes it)' },
  color: { column: 'color', kind: 'color', label: 'Color of the confessions (a hex like a5ea7a)' },
  button: { column: 'button_label', kind: 'text', label: 'Text of the panel button' },
  reply_button: { column: 'reply_label', kind: 'text', label: 'Text of the reply button' },
  panel_text: { column: 'panel_text', kind: 'text', label: 'Text of the panel' },
  cooldown: { column: 'cooldown_seconds', kind: 'number', min: 0, max: 86400, label: 'Seconds to wait between confessions (0 = none)' },
  review_channel: { column: 'review_channel_id', kind: 'channel', label: 'Channel where the staff checks confessions' },
  log_channel: { column: 'log_channel_id', kind: 'channel', label: 'Channel where the staff actions are logged' },
  staff_role: { column: 'staff_role_id', kind: 'role', label: 'Role that can check confessions' },
  design: { column: 'embed_template', kind: 'design', label: 'Saved design of the confessions' },
};

const parseBool = (text) => (/^(true|on|yes|si|sí|1|enable|enabled)$/i.test(text) ? true : /^(false|off|no|0|disable|disabled)$/i.test(text) ? false : null);

module.exports = {
  aliases: ['confessions', 'cfs'],
  data: new SlashCommandBuilder()
    .setName('confession')
    .setDescription('Set up the confessions of this server and moderate them.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('setup').setDescription('Turn confessions on in a channel.').addChannelOption((o) => o.setName('channel').setDescription('Where the confessions go').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn confessions on.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn confessions off.'))
    .addSubcommand((s) => s.setName('config').setDescription('See how confessions are set up.'))
    .addSubcommand((s) => s
      .setName('set')
      .setDescription('Change one setting.')
      .addStringOption((o) => o.setName('setting').setDescription('What to change').setRequired(true).addChoices(...Object.entries(SETTINGS).map(([name, def]) => ({ name: `${name}: ${def.label}`.slice(0, 100), value: name }))))
      .addStringOption((o) => o.setName('value').setDescription('The new value: on or off, text, a number, a color, a channel, a role or a design (none removes it)').setRequired(true).setMaxLength(200)))
    .addSubcommand((s) => s.setName('panel').setDescription('Post a message with a button that opens the form to confess.').addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)))
    .addSubcommand((s) => s.setName('approve').setDescription('Approve a confession that waits for the staff.').addStringOption(idOption))
    .addSubcommand((s) => s.setName('reject').setDescription('Reject a confession that waits for the staff.').addStringOption(idOption))
    .addSubcommand((s) => s.setName('reveal').setDescription('See who made a confession (only who has Manage Server).').addStringOption(idOption))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a confession and its message.').addStringOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription('The latest confessions.').addStringOption((o) => o.setName('status').setDescription('Only the ones with this status').setRequired(false).addChoices({ name: 'pending', value: 'pending' }, { name: 'posted', value: 'posted' }, { name: 'rejected', value: 'rejected' })))
    .addSubcommand((s) => s.setName('block').setDescription('Stop a member from confessing.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(false)).addStringOption((o) => o.setName('id').setDescription('Or the ID of one of their confessions').setRequired(false)))
    .addSubcommand((s) => s.setName('unblock').setDescription('Let a member confess again.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const config = await db.getConfig(interaction.guild.id);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    const staffOnly = ['approve', 'reject', 'list'];
    if (staffOnly.includes(sub) && !confessions.isStaff(interaction.member, config)) return reply(interaction, `${EMOJI.DENY}  Only the staff can use this.`, RED, true);
    if (!staffOnly.includes(sub) && !manager) return reply(interaction, `${EMOJI.DENY}  You need the **Manage Server** permission.`, RED, true);

    switch (sub) {
      case 'setup': return setup(interaction);
      case 'enable': return toggle(interaction, config, true);
      case 'disable': return toggle(interaction, config, false);
      case 'config': return show(interaction, config);
      case 'set': return change(interaction);
      case 'panel': return panel(interaction, config);
      case 'approve': return decide(interaction, true);
      case 'reject': return decide(interaction, false);
      case 'reveal': return reveal(interaction);
      case 'delete': return erase(interaction, config);
      case 'list': return list(interaction);
      case 'block': return blocking(interaction, true);
      case 'unblock': return blocking(interaction, false);
      default: return reply(interaction, 'That is not something I can do.', RED, true);
    }
  },
};

async function setup(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const me = interaction.guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, `${EMOJI.DENY}  I need to see and write in ${channel}.`, RED, true);
  await db.updateConfig(interaction.guild.id, { channel_id: channel.id, enabled: true });
  return reply(interaction, `${EMOJI.APPROVE}  Confessions are on. They go to ${channel}. Members use \`confess\` or the panel (\`confession panel\`). Change how it looks and works in the dashboard (Confessions).`, GREEN);
}

async function toggle(interaction, config, enabled) {
  if (enabled && !config.channel_id) return reply(interaction, `${EMOJI.DENY}  Pick the channel first with \`confession setup\`.`, RED, true);
  await db.updateConfig(interaction.guild.id, { enabled });
  return reply(interaction, `${EMOJI.APPROVE}  Confessions are ${enabled ? 'on' : 'off'}.`, GREEN);
}

async function show(interaction, c) {
  const yes = (v) => (v ? 'on' : 'off');
  const lines = [
    `**Confessions** · ${c.enabled ? 'on' : 'off'}`,
    `Channel: ${c.channel_id ? `<#${c.channel_id}>` : 'none'} · checked by the staff first: ${yes(c.require_review)}${c.review_channel_id ? ` (in <#${c.review_channel_id}>)` : ''} · log: ${c.log_channel_id ? `<#${c.log_channel_id}>` : 'none'}`,
    `The confess command: ${yes(c.allow_command)} · pictures: ${yes(c.allow_images)} · anonymous replies: ${yes(c.allow_replies)}`,
    `Webhook: ${yes(c.use_webhook)}${c.use_webhook ? ` as **${c.webhook_name}**` : ''} · keep who confessed: ${yes(c.keep_author)} · wait: ${c.cooldown_seconds}s`,
    `Staff role: ${c.staff_role_id ? `<@&${c.staff_role_id}>` : 'only who has Manage Server'}`,
    `Design: ${c.embed_template ? `\`${c.embed_template}\`` : 'the usual one'}`,
  ];
  return reply(interaction, lines.join('\n'));
}

async function change(interaction) {
  const name = interaction.options.getString('setting', true);
  const raw = interaction.options.getString('value', true).trim();
  const def = SETTINGS[name];
  if (!def) return reply(interaction, `${EMOJI.DENY}  I do not know that setting.`, RED, true);
  const none = /^(none|off|no)$/i.test(raw);
  let value;
  if (def.kind === 'boolean') {
    value = parseBool(raw);
    if (value === null) return reply(interaction, `${EMOJI.DENY}  Write on or off.`, RED, true);
  } else if (def.kind === 'number') {
    value = Number(raw);
    if (!Number.isInteger(value) || value < def.min || value > def.max) return reply(interaction, `${EMOJI.DENY}  Write a whole number from ${def.min} to ${def.max}.`, RED, true);
  } else if (def.kind === 'color') {
    const hex = /^#?([0-9a-f]{6})$/i.exec(raw);
    if (!hex) return reply(interaction, `${EMOJI.DENY}  Write a color like a5ea7a.`, RED, true);
    value = parseInt(hex[1], 16);
  } else if (def.kind === 'url') {
    if (none) value = null;
    else {
      try { if (new URL(raw).protocol !== 'https:') throw new Error('http'); } catch { return reply(interaction, `${EMOJI.DENY}  Write a link that starts with https (or none).`, RED, true); }
      value = raw;
    }
  } else if (def.kind === 'role' || def.kind === 'channel') {
    if (none) value = null;
    else {
      const id = raw.replace(/\D/g, '');
      const found = def.kind === 'role' ? interaction.guild.roles.cache.has(id) : interaction.guild.channels.cache.has(id);
      if (!id || !found) return reply(interaction, `${EMOJI.DENY}  Mention a ${def.kind} of this server (or write none).`, RED, true);
      value = id;
    }
  } else if (def.kind === 'design') {
    if (none) value = null;
    else {
      if (!(await getTemplate(interaction.guild.id, raw))) return reply(interaction, `${EMOJI.DENY}  There is no saved design called \`${raw}\`. Make it in the dashboard (Embeds).`, RED, true);
      value = raw;
    }
  } else value = name === 'footer' && none ? '' : raw.slice(0, 200);
  await db.updateConfig(interaction.guild.id, { [def.column]: value });
  const shown = value === null || value === '' ? 'none' : typeof value === 'boolean' ? (value ? 'on' : 'off') : def.kind === 'color' ? `#${value.toString(16).padStart(6, '0')}` : value;
  return reply(interaction, `${EMOJI.APPROVE}  ${def.label}: **${shown}**.`, GREEN);
}

async function panel(interaction, config) {
  if (!config.enabled) return reply(interaction, `${EMOJI.DENY}  Turn confessions on first with \`confession setup\`.`, RED, true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, `${EMOJI.DENY}  I cannot write in ${channel}.`, RED, true);
  const result = await confessions.postPanel(interaction.guild, config, channel.id);
  if (!result.ok) return reply(interaction, `${EMOJI.DENY}  ${result.message}`, RED, true);
  return reply(interaction, `${EMOJI.APPROVE}  The panel is in ${channel}, at the bottom. It goes back down after each confession.`, GREEN, true);
}

async function decide(interaction, approve) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const result = await confessions.decide({ guild: interaction.guild, member: interaction.member, id, approve });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  return reply(interaction, `${EMOJI.APPROVE}  The confession \`${id}\` was ${approve ? 'approved and posted' : 'rejected'}.`, GREEN);
}

async function reveal(interaction) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const row = await db.getById(id);
  if (!row || row.guild_id !== interaction.guild.id) return reply(interaction, `${EMOJI.DENY}  There is no confession with the ID \`${id}\`.`, RED, true);
  if (!row.author_id) return reply(interaction, `${EMOJI.DENY}  This server does not keep who confessed, so it cannot be known.`, RED, true);
  await confessions.logAction(interaction.guild, await db.getConfig(interaction.guild.id), `${interaction.user} looked at who made the confession \`${row.id}\` (#${row.number}).`, 0xffd563);
  return reply(interaction, `**Confession #${row.number}** · \`${row.id}\`\nBy <@${row.author_id}> (${row.author_id})\n${String(row.content).slice(0, 400)}`, GREY, true);
}

async function erase(interaction, config) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const row = await db.getById(id);
  if (!row || row.guild_id !== interaction.guild.id) return reply(interaction, `${EMOJI.DENY}  There is no confession with the ID \`${id}\`.`, RED, true);
  if (row.channel_id && row.message_id) {
    const channel = await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    await message?.delete().catch(() => {});
  }
  if (row.thread_id) await (await interaction.guild.channels.fetch(row.thread_id).catch(() => null))?.delete().catch(() => {});
  await db.remove(interaction.guild.id, id);
  await confessions.logAction(interaction.guild, config, `${interaction.user} deleted the confession \`${id}\` (#${row.number}).`, 0xff6b6b);
  return reply(interaction, `${EMOJI.APPROVE}  Deleted the confession \`${id}\`.`, GREEN);
}

async function list(interaction) {
  const status = interaction.options.getString('status');
  const rows = (await db.list(interaction.guild.id, { status, limit: 10 })).filter((row) => !row.reply_to);
  if (!rows.length) return reply(interaction, 'There are no confessions yet.');
  return reply(interaction, rows.map((row) => `\`${row.id}\` · #${row.number} · ${row.status} · ${String(row.content).replace(/\s+/g, ' ').slice(0, 70)}`).join('\n'), GREY, true);
}

async function blocking(interaction, on) {
  let user = interaction.options.getUser('user');
  const id = interaction.options.getString?.('id');
  if (!user && on && id) {
    const row = await db.getById(id.trim().toLowerCase());
    if (!row || row.guild_id !== interaction.guild.id) return reply(interaction, `${EMOJI.DENY}  There is no confession with that ID.`, RED, true);
    if (!row.author_id) return reply(interaction, `${EMOJI.DENY}  This server does not keep who confessed, so it cannot be known.`, RED, true);
    await db.block(interaction.guild.id, row.author_id, interaction.user.id);
    await confessions.logAction(interaction.guild, await db.getConfig(interaction.guild.id), `${interaction.user} blocked the author of the confession \`${row.id}\`.`, 0xff6b6b);
    return reply(interaction, `${EMOJI.APPROVE}  The author of \`${row.id}\` cannot confess now.`, GREEN, true);
  }
  if (!user) return reply(interaction, `${EMOJI.DENY}  Pick a member${on ? ' or give the ID of one of their confessions' : ''}.`, RED, true);
  if (on) await db.block(interaction.guild.id, user.id, interaction.user.id);
  else if (!(await db.unblock(interaction.guild.id, user.id))) return reply(interaction, `${EMOJI.DENY}  ${user} was not blocked.`, RED, true);
  await confessions.logAction(interaction.guild, await db.getConfig(interaction.guild.id), `${interaction.user} ${on ? 'blocked' : 'unblocked'} ${user} ${on ? 'from' : 'to'} confess${on ? '' : 'ing again'}.`, on ? 0xff6b6b : 0xa5ea7a);
  return reply(interaction, `${EMOJI.APPROVE}  ${user} ${on ? 'cannot confess now' : 'can confess again'}.`, GREEN, true);
}
