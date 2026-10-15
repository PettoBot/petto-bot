const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/scamConfig');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf, formatList } = require('../../i18n');

const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const RED = 0xff6b6b;
const reply = (interaction, text, color = GREEN) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

module.exports = {
  aliases: ['scam', 'mrbeast'],
  prefixDefaultSubcommand: 'status',
  data: new SlashCommandBuilder()
    .setName('antiscam')
    .setDescription('Catch hijacked accounts that spam the MrBeast giveaway scam, fake withdrawals and casino promos.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('status').setDescription('See how the anti scam is set.'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Turn it on or off and tune it.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the anti scam on or off'))
        .addStringOption((o) => o.setName('action').setDescription('What to do to the account (starts as only alert)').addChoices({ name: 'only alert', value: 'alert' }, { name: 'mute (timeout)', value: 'timeout' }, { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }))
        .addIntegerOption((o) => o.setName('mute_minutes').setDescription('Minutes of mute when the action is mute (default 120)').setMinValue(1).setMaxValue(40320))
        .addBooleanOption((o) => o.setName('delete_messages').setDescription('Take down what the account sent lately in every channel'))
        .addIntegerOption((o) => o.setName('delete_minutes').setDescription('How far back to take messages down (default 15)').setMinValue(1).setMaxValue(120))
        .addIntegerOption((o) => o.setName('channels').setDescription('Channels with the same message that count as a scam (default 3)').setMinValue(2).setMaxValue(10))
        .addIntegerOption((o) => o.setName('window_seconds').setDescription('In how many seconds (default 30)').setMinValue(5).setMaxValue(300))
        .addBooleanOption((o) => o.setName('scan_text').setDescription('Also look for the scam wording'))
        .addBooleanOption((o) => o.setName('scan_new_accounts').setDescription('Also be stricter with new accounts'))
        .addBooleanOption((o) => o.setName('dm_user').setDescription('Send the account a DM that it may be hacked'))
        .addChannelOption((o) => o.setName('alert_channel').setDescription('Where the alert with buttons goes').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('ping_role').setDescription('A role to ping with each alert')),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('exempt')
        .setDescription('Roles and channels the anti scam never checks.')
        .addSubcommand((sub) => sub.setName('add').setDescription('Never check a role or a channel.').addRoleOption((o) => o.setName('role').setDescription('Role')).addChannelOption((o) => o.setName('channel').setDescription('Channel')))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Check a role or a channel again.').addRoleOption((o) => o.setName('role').setDescription('Role')).addChannelOption((o) => o.setName('channel').setDescription('Channel')))
        .addSubcommand((sub) => sub.setName('list').setDescription('See what is never checked.')),
    )
    .addSubcommand((sub) => sub.setName('log').setDescription('The last scams it caught.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (group === 'exempt') return exempt(interaction, sub, lang);
    if (sub === 'set') return set(interaction, lang);
    if (sub === 'log') return log(interaction, lang);
    return status(interaction, lang);
  },
};

const ACTIONS = ['alert', 'timeout', 'kick', 'ban'];

/** A saved value (an action, a signal) as the replies name it; an unknown value as it is. */
function word(key, value, lang) {
  const text = t(lang, key);
  return text === key ? String(value) : text;
}

async function status(interaction, lang) {
  const c = await db.getConfig(interaction.guild.id);
  const onOff = (value) => t(lang, value ? 'security.antiscam.status.on' : 'security.antiscam.status.off');
  const action = ACTIONS.includes(c.action) ? t(lang, `security.antiscam.status.action.${c.action}`) : undefined;
  const duration = c.action === 'timeout' ? tn(lang, 'security.antiscam.status.duration', c.timeout_minutes, { count: c.timeout_minutes }) : '';
  const cleanup = c.delete_messages ? tn(lang, 'security.antiscam.status.cleanup', c.delete_minutes, { count: c.delete_minutes }) : '';
  const where = c.alert_channel_id ? `<#${c.alert_channel_id}>` : t(lang, 'security.antiscam.status.automodLog');
  await reply(interaction, [
    t(lang, c.enabled ? 'security.antiscam.status.titleOn' : 'security.antiscam.status.titleOff'),
    t(lang, 'security.antiscam.status.when', { emoji: EMOJI.APPROVE, action, duration, cleanup }),
    t(lang, 'security.antiscam.status.sameMessage', { channels: c.channels_threshold, seconds: c.window_seconds }),
    t(lang, 'security.antiscam.status.checks', {
      wording: onOff(c.scan_text),
      newAccounts: c.scan_new_accounts ? t(lang, 'security.antiscam.status.newAccountsOn', { hours: c.new_account_hours }) : onOff(false),
      dm: onOff(c.dm_user),
    }),
    c.ping_role_id ? t(lang, 'security.antiscam.status.alertsPing', { where, role: `<@&${c.ping_role_id}>` }) : t(lang, 'security.antiscam.status.alerts', { where }),
    t(lang, 'security.antiscam.status.caught', { count: c.caught }),
    t(lang, 'security.antiscam.status.footer'),
  ].join('\n'), c.enabled ? GREEN : GREY);
}

async function set(interaction, lang) {
  const o = interaction.options;
  const patch = {};
  const map = [
    ['enabled', o.getBoolean('enabled')], ['action', o.getString('action')], ['timeout_minutes', o.getInteger('mute_minutes')],
    ['delete_messages', o.getBoolean('delete_messages')], ['delete_minutes', o.getInteger('delete_minutes')], ['channels_threshold', o.getInteger('channels')],
    ['window_seconds', o.getInteger('window_seconds')], ['scan_text', o.getBoolean('scan_text')], ['scan_new_accounts', o.getBoolean('scan_new_accounts')], ['dm_user', o.getBoolean('dm_user')],
  ];
  for (const [key, value] of map) if (value !== null && value !== undefined) patch[key] = value;
  const channel = o.getChannel('alert_channel');
  if (channel) patch.alert_channel_id = channel.id;
  const role = o.getRole('ping_role');
  if (role) patch.ping_role_id = role.id;
  if (!Object.keys(patch).length) return status(interaction, lang);
  if ((patch.action === 'ban' || patch.action === 'kick' || patch.action === 'timeout') && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return reply(interaction, t(lang, 'security.antiscam.needsAdmin'), RED);
  }
  await db.upsertConfig(interaction.guild.id, patch);
  return status(interaction, lang);
}

async function exempt(interaction, sub, lang) {
  const guildId = interaction.guild.id;
  const config = await db.getConfig(guildId);
  if (sub === 'list') {
    const roles = config.exempt_role_ids.map((id) => `<@&${id}>`);
    const channels = config.exempt_channel_ids.map((id) => `<#${id}>`);
    return reply(interaction, [
      t(lang, 'security.antiscam.exempt.title'),
      roles.length ? t(lang, 'security.list.roles', { list: roles.join(' ') }) : t(lang, 'security.list.rolesNone'),
      channels.length ? t(lang, 'security.list.channels', { list: channels.join(' ') }) : t(lang, 'security.list.channelsNone'),
    ].join('\n'), GREY);
  }
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  if (!role && !channel) return reply(interaction, t(lang, 'security.antiscam.exempt.pick'), RED);
  const toggle = (list, id) => (sub === 'add' ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const patch = {};
  if (role) patch.exempt_role_ids = toggle(config.exempt_role_ids, role.id);
  if (channel) patch.exempt_channel_ids = toggle(config.exempt_channel_ids, channel.id);
  await db.upsertConfig(guildId, patch);
  const what = formatList(lang, [role && `<@&${role.id}>`, channel && `<#${channel.id}>`].filter(Boolean));
  return reply(interaction, t(lang, sub === 'add' ? 'security.antiscam.exempt.added' : 'security.antiscam.exempt.removed', { emoji: EMOJI.APPROVE, what }));
}

const SIGNAL_KEYS = { 'multi-channel': 'multiChannel', wording: 'wording', 'new-account': 'newAccount' };

async function log(interaction, lang) {
  const events = await db.listEvents(interaction.guild.id, 8);
  if (!events.length) return reply(interaction, t(lang, 'security.antiscam.log.empty'), GREY);
  const lines = events.map((e) => t(lang, 'security.antiscam.log.line', {
    id: e.id,
    user: `<@${e.user_id}>`,
    signal: SIGNAL_KEYS[e.signal] ? t(lang, `security.antiscam.log.signal.${SIGNAL_KEYS[e.signal]}`) : e.signal,
    channels: e.channels,
    deleted: e.deleted,
    action: word(`security.action.${e.action}`, e.action, lang),
    time: `<t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>`,
  }));
  return reply(interaction, [t(lang, 'security.antiscam.log.title'), ...lines].join('\n'), GREY);
}
