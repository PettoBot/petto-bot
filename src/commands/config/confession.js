const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/confessions');
const confessions = require('../../utils/confessions');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const GREY = 0x4b4f59;
const reply = (interaction, text, color = GREY, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const idOption = (o) => o.setName('id').setDescription('The ID of the confession (like si2tr-foytm)').setRequired(true);

// The labels name the choices of the slash command (builder texts stay in English); the answers use `confessions.setting.<name>`.
const SETTINGS = {
  review: { column: 'require_review', kind: 'boolean', label: 'The staff checks each confession before it shows' }, // i18n-ignore: choice name of the builder
  command: { column: 'allow_command', kind: 'boolean', label: 'The confess command works' }, // i18n-ignore: choice name of the builder
  images: { column: 'allow_images', kind: 'boolean', label: 'Confessions can have a picture' }, // i18n-ignore: choice name of the builder
  replies: { column: 'allow_replies', kind: 'boolean', label: 'Anonymous replies in a thread' }, // i18n-ignore: choice name of the builder
  keep_author: { column: 'keep_author', kind: 'boolean', label: 'Keep who confessed (only the staff can see it)' }, // i18n-ignore: choice name of the builder
  webhook: { column: 'use_webhook', kind: 'boolean', label: 'Send through a webhook with its own name and picture' }, // i18n-ignore: choice name of the builder
  webhook_name: { column: 'webhook_name', kind: 'text', label: 'Name it shows' }, // i18n-ignore: choice name of the builder
  webhook_avatar: { column: 'webhook_avatar', kind: 'url', label: 'Picture it shows (a link, none for the bot picture)' }, // i18n-ignore: choice name of the builder
  title: { column: 'title', kind: 'text', label: 'Title of each confession' }, // i18n-ignore: choice name of the builder
  footer: { column: 'footer', kind: 'text', label: 'Small text under each confession (none removes it)' }, // i18n-ignore: choice name of the builder
  color: { column: 'color', kind: 'color', label: 'Color of the confessions (a hex like a5ea7a)' }, // i18n-ignore: choice name of the builder
  button: { column: 'button_label', kind: 'text', label: 'Text of the panel button' }, // i18n-ignore: choice name of the builder
  reply_button: { column: 'reply_label', kind: 'text', label: 'Text of the reply button' }, // i18n-ignore: choice name of the builder
  panel_text: { column: 'panel_text', kind: 'text', label: 'Text of the panel' }, // i18n-ignore: choice name of the builder
  cooldown: { column: 'cooldown_seconds', kind: 'number', min: 0, max: 86400, label: 'Seconds to wait between confessions (0 = none)' }, // i18n-ignore: choice name of the builder
  review_channel: { column: 'review_channel_id', kind: 'channel', label: 'Channel where the staff checks confessions' }, // i18n-ignore: choice name of the builder
  log_channel: { column: 'log_channel_id', kind: 'channel', label: 'Channel where the staff actions are logged' }, // i18n-ignore: choice name of the builder
  staff_role: { column: 'staff_role_id', kind: 'role', label: 'Role that can check confessions' }, // i18n-ignore: choice name of the builder
  design: { column: 'embed_template', kind: 'design', label: 'Saved design of the confessions' }, // i18n-ignore: choice name of the builder
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
    const lang = await languageOf(interaction);
    const config = await db.getConfig(interaction.guild.id);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    const staffOnly = ['approve', 'reject', 'list'];
    if (staffOnly.includes(sub) && !confessions.isStaff(interaction.member, config)) return reply(interaction, t(lang, 'confessions.onlyStaff', { emoji: EMOJI.DENY }), RED, true);
    if (!staffOnly.includes(sub) && !manager) return reply(interaction, t(lang, 'confessions.needManageServer', { emoji: EMOJI.DENY }), RED, true);

    switch (sub) {
      case 'setup': return setup(interaction, lang);
      case 'enable': return toggle(interaction, config, true, lang);
      case 'disable': return toggle(interaction, config, false, lang);
      case 'config': return show(interaction, config, lang);
      case 'set': return change(interaction, lang);
      case 'panel': return panel(interaction, config, lang);
      case 'approve': return decide(interaction, true, lang);
      case 'reject': return decide(interaction, false, lang);
      case 'reveal': return reveal(interaction, lang);
      case 'delete': return erase(interaction, config, lang);
      case 'list': return list(interaction, lang);
      case 'block': return blocking(interaction, true, lang);
      case 'unblock': return blocking(interaction, false, lang);
      default: return reply(interaction, t(lang, 'confessions.unknownAction'), RED, true);
    }
  },
};

const onOff = (lang, value) => t(lang, value ? 'confessions.on' : 'confessions.off');

async function setup(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const me = interaction.guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, t(lang, 'confessions.setup.cannotWrite', { emoji: EMOJI.DENY, channel: `${channel}` }), RED, true);
  await db.updateConfig(interaction.guild.id, { channel_id: channel.id, enabled: true });
  return reply(interaction, t(lang, 'confessions.setup.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }), GREEN);
}

async function toggle(interaction, config, enabled, lang) {
  if (enabled && !config.channel_id) return reply(interaction, t(lang, 'confessions.toggle.pickChannel', { emoji: EMOJI.DENY }), RED, true);
  await db.updateConfig(interaction.guild.id, { enabled });
  return reply(interaction, t(lang, enabled ? 'confessions.toggle.on' : 'confessions.toggle.off', { emoji: EMOJI.APPROVE }), GREEN);
}

async function show(interaction, c, lang) {
  const yes = (v) => onOff(lang, v);
  const webhookName = c.webhook_name === t('en', 'confessions.default.webhookName') ? t(lang, 'confessions.default.webhookName') : c.webhook_name;
  const lines = [
    t(lang, 'confessions.config.title', { state: onOff(lang, c.enabled) }),
    t(lang, 'confessions.config.channel', {
      channel: c.channel_id ? `<#${c.channel_id}>` : t(lang, 'confessions.none'),
      review: `${yes(c.require_review)}${c.review_channel_id ? t(lang, 'confessions.config.reviewIn', { channel: `<#${c.review_channel_id}>` }) : ''}`,
      log: c.log_channel_id ? `<#${c.log_channel_id}>` : t(lang, 'confessions.none'),
    }),
    t(lang, 'confessions.config.ways', { command: yes(c.allow_command), images: yes(c.allow_images), replies: yes(c.allow_replies) }),
    t(lang, 'confessions.config.webhook', { webhook: `${yes(c.use_webhook)}${c.use_webhook ? t(lang, 'confessions.config.webhookAs', { name: webhookName }) : ''}`, keep: yes(c.keep_author), seconds: c.cooldown_seconds }),
    t(lang, 'confessions.config.staffRole', { role: c.staff_role_id ? `<@&${c.staff_role_id}>` : t(lang, 'confessions.config.managers') }),
    t(lang, 'confessions.config.design', { design: c.embed_template ? `\`${c.embed_template}\`` : t(lang, 'confessions.config.usualDesign') }),
  ];
  return reply(interaction, lines.join('\n'));
}

async function change(interaction, lang) {
  const name = interaction.options.getString('setting', true);
  const raw = interaction.options.getString('value', true).trim();
  const def = SETTINGS[name];
  if (!def) return reply(interaction, t(lang, 'confessions.set.unknown', { emoji: EMOJI.DENY }), RED, true);
  const none = /^(none|off|no)$/i.test(raw);
  let value;
  if (def.kind === 'boolean') {
    value = parseBool(raw);
    if (value === null) return reply(interaction, t(lang, 'confessions.set.onOff', { emoji: EMOJI.DENY }), RED, true);
  } else if (def.kind === 'number') {
    value = Number(raw);
    if (!Number.isInteger(value) || value < def.min || value > def.max) return reply(interaction, t(lang, 'confessions.set.number', { emoji: EMOJI.DENY, min: def.min, max: def.max }), RED, true);
  } else if (def.kind === 'color') {
    const hex = /^#?([0-9a-f]{6})$/i.exec(raw);
    if (!hex) return reply(interaction, t(lang, 'confessions.set.color', { emoji: EMOJI.DENY }), RED, true);
    value = parseInt(hex[1], 16);
  } else if (def.kind === 'url') {
    if (none) value = null;
    else {
      try { if (new URL(raw).protocol !== 'https:') throw new Error('http'); } catch { return reply(interaction, t(lang, 'confessions.set.url', { emoji: EMOJI.DENY }), RED, true); }
      value = raw;
    }
  } else if (def.kind === 'role' || def.kind === 'channel') {
    if (none) value = null;
    else {
      const id = raw.replace(/\D/g, '');
      const found = def.kind === 'role' ? interaction.guild.roles.cache.has(id) : interaction.guild.channels.cache.has(id);
      if (!id || !found) return reply(interaction, t(lang, def.kind === 'role' ? 'confessions.set.role' : 'confessions.set.channel', { emoji: EMOJI.DENY }), RED, true);
      value = id;
    }
  } else if (def.kind === 'design') {
    if (none) value = null;
    else {
      if (!(await getTemplate(interaction.guild.id, raw))) return reply(interaction, t(lang, 'confessions.set.noDesign', { emoji: EMOJI.DENY, name: raw }), RED, true);
      value = raw;
    }
  } else value = name === 'footer' && none ? '' : raw.slice(0, 200);
  await db.updateConfig(interaction.guild.id, { [def.column]: value });
  const shown = value === null || value === '' ? t(lang, 'confessions.none') : typeof value === 'boolean' ? onOff(lang, value) : def.kind === 'color' ? `#${value.toString(16).padStart(6, '0')}` : value;
  return reply(interaction, t(lang, 'confessions.set.done', { emoji: EMOJI.APPROVE, setting: t(lang, `confessions.setting.${name.replace(/_([a-z])/g, (m, c) => c.toUpperCase())}`), value: shown }), GREEN);
}

async function panel(interaction, config, lang) {
  if (!config.enabled) return reply(interaction, t(lang, 'confessions.panelCmd.turnOnFirst', { emoji: EMOJI.DENY }), RED, true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return reply(interaction, t(lang, 'confessions.panelCmd.cannotWrite', { emoji: EMOJI.DENY, channel: `${channel}` }), RED, true);
  const result = await confessions.postPanel(interaction.guild, config, channel.id);
  if (!result.ok) return reply(interaction, `${EMOJI.DENY}  ${result.message}`, RED, true);
  return reply(interaction, t(lang, 'confessions.panelCmd.posted', { emoji: EMOJI.APPROVE, channel: `${channel}` }), GREEN, true);
}

async function decide(interaction, approve, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const result = await confessions.decide({ guild: interaction.guild, member: interaction.member, id, approve });
  if (result.error) return reply(interaction, `${EMOJI.DENY}  ${result.error}`, RED, true);
  return reply(interaction, t(lang, approve ? 'confessions.decided.approved' : 'confessions.decided.rejected', { emoji: EMOJI.APPROVE, id }), GREEN);
}

async function reveal(interaction, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const row = await db.getById(id);
  if (!row || row.guild_id !== interaction.guild.id) return reply(interaction, t(lang, 'confessions.notFound', { emoji: EMOJI.DENY, id }), RED, true);
  if (!row.author_id) return reply(interaction, t(lang, 'confessions.notKept', { emoji: EMOJI.DENY }), RED, true);
  await confessions.logAction(interaction.guild, await db.getConfig(interaction.guild.id), t(lang, 'confessions.log.revealed', { staff: `${interaction.user}`, id: row.id, number: row.number }), 0xffd563);
  return reply(interaction, t(lang, 'confessions.reveal', { number: row.number, id: row.id, author: `<@${row.author_id}>`, authorId: row.author_id, content: String(row.content).slice(0, 400) }), GREY, true);
}

async function erase(interaction, config, lang) {
  const id = interaction.options.getString('id', true).trim().toLowerCase();
  const row = await db.getById(id);
  if (!row || row.guild_id !== interaction.guild.id) return reply(interaction, t(lang, 'confessions.notFound', { emoji: EMOJI.DENY, id }), RED, true);
  if (row.channel_id && row.message_id) {
    const channel = await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    await message?.delete().catch(() => {});
  }
  if (row.thread_id) await (await interaction.guild.channels.fetch(row.thread_id).catch(() => null))?.delete().catch(() => {});
  await db.remove(interaction.guild.id, id);
  await confessions.logAction(interaction.guild, config, t(lang, 'confessions.log.deleted', { staff: `${interaction.user}`, id, number: row.number }), 0xff6b6b);
  return reply(interaction, t(lang, 'confessions.deleted', { emoji: EMOJI.APPROVE, id }), GREEN);
}

// The status of a confession as people read it (the stored value is `pending`, `posted` or `rejected`).
const statusName = (lang, status) => (['pending', 'posted', 'rejected'].includes(status) ? t(lang, `confessions.status.${status}`) : status);

async function list(interaction, lang) {
  const status = interaction.options.getString('status');
  const rows = (await db.list(interaction.guild.id, { status, limit: 10 })).filter((row) => !row.reply_to);
  if (!rows.length) return reply(interaction, t(lang, 'confessions.list.empty'));
  return reply(interaction, rows.map((row) => `\`${row.id}\` · #${row.number} · ${statusName(lang, row.status)} · ${String(row.content).replace(/\s+/g, ' ').slice(0, 70)}`).join('\n'), GREY, true);
}

async function blocking(interaction, on, lang) {
  let user = interaction.options.getUser('user');
  const id = interaction.options.getString?.('id');
  if (!user && on && id) {
    const row = await db.getById(id.trim().toLowerCase());
    if (!row || row.guild_id !== interaction.guild.id) return reply(interaction, t(lang, 'confessions.block.noId', { emoji: EMOJI.DENY }), RED, true);
    if (!row.author_id) return reply(interaction, t(lang, 'confessions.notKept', { emoji: EMOJI.DENY }), RED, true);
    await db.block(interaction.guild.id, row.author_id, interaction.user.id);
    await confessions.logAction(interaction.guild, await db.getConfig(interaction.guild.id), t(lang, 'confessions.log.blockedAuthor', { staff: `${interaction.user}`, id: row.id }), 0xff6b6b);
    return reply(interaction, t(lang, 'confessions.block.authorBlocked', { emoji: EMOJI.APPROVE, id: row.id }), GREEN, true);
  }
  if (!user) return reply(interaction, t(lang, on ? 'confessions.block.pickOrId' : 'confessions.block.pick', { emoji: EMOJI.DENY }), RED, true);
  if (on) await db.block(interaction.guild.id, user.id, interaction.user.id);
  else if (!(await db.unblock(interaction.guild.id, user.id))) return reply(interaction, t(lang, 'confessions.block.notBlocked', { emoji: EMOJI.DENY, user: `${user}` }), RED, true);
  await confessions.logAction(interaction.guild, await db.getConfig(interaction.guild.id), t(lang, on ? 'confessions.log.blocked' : 'confessions.log.unblocked', { staff: `${interaction.user}`, user: `${user}` }), on ? 0xff6b6b : 0xa5ea7a);
  return reply(interaction, t(lang, on ? 'confessions.block.blocked' : 'confessions.block.unblocked', { emoji: EMOJI.APPROVE, user: `${user}` }), GREEN, true);
}
