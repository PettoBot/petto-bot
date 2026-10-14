const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/scamConfig');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

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
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (group === 'exempt') return exempt(interaction, sub);
    if (sub === 'set') return set(interaction);
    if (sub === 'log') return log(interaction);
    return status(interaction);
  },
};

const ACTION_TEXT = { alert: 'only alerts the staff', timeout: 'mutes the account', kick: 'kicks the account', ban: 'bans the account' };

async function status(interaction) {
  const c = await db.getConfig(interaction.guild.id);
  await reply(interaction, [
    `### Anti scam · ${c.enabled ? 'on' : 'off'}`,
    `${EMOJI.APPROVE} When it catches one it **${ACTION_TEXT[c.action]}**${c.action === 'timeout' ? ` for ${c.timeout_minutes} minutes` : ''}${c.delete_messages ? ` and takes down the last ${c.delete_minutes} minutes of its messages` : ''}.`,
    `**Same message in:** ${c.channels_threshold} channels within ${c.window_seconds}s`,
    `**Scam wording:** ${c.scan_text ? 'on' : 'off'} · **New accounts:** ${c.scan_new_accounts ? `on (under ${c.new_account_hours}h)` : 'off'} · **DM to the account:** ${c.dm_user ? 'on' : 'off'}`,
    `**Alerts:** ${c.alert_channel_id ? `<#${c.alert_channel_id}>` : 'the automod log'}${c.ping_role_id ? ` · pings <@&${c.ping_role_id}>` : ''}`,
    `**Caught so far:** ${c.caught}`,
    '-# It starts off and only alerting. Watch the alerts for a few days before it acts on its own.',
  ].join('\n'), c.enabled ? GREEN : GREY);
}

async function set(interaction) {
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
  if (!Object.keys(patch).length) return status(interaction);
  if ((patch.action === 'ban' || patch.action === 'kick' || patch.action === 'timeout') && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return reply(interaction, 'Letting it mute, kick or ban on its own needs **Administrator**.', RED);
  }
  await db.upsertConfig(interaction.guild.id, patch);
  return status(interaction);
}

async function exempt(interaction, sub) {
  const guildId = interaction.guild.id;
  const config = await db.getConfig(guildId);
  if (sub === 'list') {
    const roles = config.exempt_role_ids.map((id) => `<@&${id}>`);
    const channels = config.exempt_channel_ids.map((id) => `<#${id}>`);
    return reply(interaction, ['### Never checked', roles.length ? `**Roles:** ${roles.join(' ')}` : '**Roles:** none', channels.length ? `**Channels:** ${channels.join(' ')}` : '**Channels:** none'].join('\n'), GREY);
  }
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  if (!role && !channel) return reply(interaction, 'Pick a role or a channel.', RED);
  const toggle = (list, id) => (sub === 'add' ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const patch = {};
  if (role) patch.exempt_role_ids = toggle(config.exempt_role_ids, role.id);
  if (channel) patch.exempt_channel_ids = toggle(config.exempt_channel_ids, channel.id);
  await db.upsertConfig(guildId, patch);
  return reply(interaction, `${EMOJI.APPROVE} ${[role && `<@&${role.id}>`, channel && `<#${channel.id}>`].filter(Boolean).join(' and ')} ${sub === 'add' ? 'will not be checked' : 'will be checked again'}.`);
}

async function log(interaction) {
  const events = await db.listEvents(interaction.guild.id, 8);
  if (!events.length) return reply(interaction, 'It has not caught anything yet.', GREY);
  const lines = events.map((e) => `**#${e.id}** · <@${e.user_id}> · ${e.signal} · ${e.channels} channel(s) · ${e.deleted} deleted · ${e.action} · <t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>`);
  return reply(interaction, ['### Scams caught', ...lines].join('\n'), GREY);
}
