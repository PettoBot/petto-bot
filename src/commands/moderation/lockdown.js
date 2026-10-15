const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/lockdown');
const { startLockdown, endLockdown, targetChannels } = require('../../utils/lockdown');
const { requireAdministrator } = require('../../utils/moderationCommand');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const RED = 0xff6b6b;
const reply = (interaction, text, color = GREEN) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

module.exports = {
  aliases: ['raidmode', 'lock'],
  prefixDefaultSubcommand: 'status',
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Close the channels, pause the invites and raise the verification while a raid lasts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start a lockdown now.')
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(300))
        .addIntegerOption((o) => o.setName('minutes').setDescription('Minutes until it ends by itself (0 or empty uses the server setting)').setMinValue(1).setMaxValue(10080)),
    )
    .addSubcommand((sub) => sub.setName('end').setDescription('End the lockdown and put everything back.'))
    .addSubcommand((sub) => sub.setName('status').setDescription('See if a lockdown is on and how it is set.'))
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Choose what a lockdown does.')
        .addBooleanOption((o) => o.setName('pause_invites').setDescription('Delete the invites and block new ones (default on)'))
        .addBooleanOption((o) => o.setName('raise_verification').setDescription('Raise the verification level of the server to High while it lasts'))
        .addIntegerOption((o) => o.setName('auto_end_minutes').setDescription('Minutes until a lockdown ends by itself (0 so it stays until you end it)').setMinValue(0).setMaxValue(10080))
        .addChannelOption((o) => o.setName('announce_channel').setDescription('Channel where the notice is posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('message').setDescription('The notice').setMaxLength(500)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('channel')
        .setDescription('Which channels a lockdown closes. With none chosen it closes every text channel.')
        .addSubcommand((sub) => sub.setName('add').setDescription('Close this channel in a lockdown.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Stop closing this channel.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true))),
    ),

  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    try {
      if (group === 'channel') return await channel(interaction, sub, lang);
      if (sub === 'start') return await start(interaction, lang);
      if (sub === 'end') return await end(interaction, lang);
      if (sub === 'config') return await config(interaction, lang);
      return await status(interaction, lang);
    } catch (err) {
      if (err.userFacing) return reply(interaction, err.message, RED);
      throw err;
    }
  },
};

async function start(interaction, lang) {
  const result = await startLockdown(interaction.guild, { startedBy: interaction.user.id, reason: interaction.options.getString('reason'), minutes: interaction.options.getInteger('minutes') });
  const closed = [
    tn(lang, 'moderation.lockdown.started.closed', result.locked, { count: result.locked }),
    result.failed ? t(lang, 'moderation.lockdown.started.failed', { count: result.failed }) : '',
    result.invitesDeleted ? tn(lang, 'moderation.lockdown.started.invites', result.invitesDeleted, { count: result.invitesDeleted }) : '',
    '.',
  ].join('');
  const ends = result.endsInMinutes ? tn(lang, 'moderation.lockdown.started.endsIn', result.endsInMinutes, { count: result.endsInMinutes }) : t(lang, 'moderation.lockdown.started.staysOn');
  return reply(interaction, [t(lang, 'moderation.lockdown.started.title', { emoji: EMOJI.ALERT }), closed, ends].join('\n'), RED);
}

async function end(interaction, lang) {
  const result = await endLockdown(interaction.guild, { endedBy: interaction.user.id });
  return reply(interaction, tn(lang, 'moderation.lockdown.ended', result.restored, { emoji: EMOJI.APPROVE, count: result.restored, failed: result.failed ? t(lang, 'moderation.lockdown.endedFailed', { count: result.failed }) : '' }));
}

async function status(interaction, lang) {
  const [active, c] = await Promise.all([db.getActive(interaction.guild.id), db.getConfig(interaction.guild.id)]);
  const scope = c.channel_ids.length ? c.channel_ids.map((id) => `<#${id}>`).join(' ') : t(lang, 'moderation.lockdown.status.everyChannel', { count: targetChannels(interaction.guild, c).length });
  const yesNo = (value) => t(lang, value ? 'moderation.lockdown.status.yes' : 'moderation.lockdown.status.no');
  const lines = [
    active
      ? t(lang, active.ends_at ? 'moderation.lockdown.status.onUntil' : 'moderation.lockdown.status.on', { emoji: EMOJI.ALERT, since: `<t:${Math.floor(new Date(active.started_at).getTime() / 1000)}:R>`, ends: active.ends_at ? `<t:${Math.floor(new Date(active.ends_at).getTime() / 1000)}:R>` : '' })
      : t(lang, 'moderation.lockdown.status.off'),
    t(lang, 'moderation.lockdown.status.closes', { scope }),
    t(lang, 'moderation.lockdown.status.settings', {
      invites: yesNo(c.pause_invites),
      verification: yesNo(c.raise_verification),
      ends: c.auto_end_minutes ? tn(lang, 'moderation.lockdown.status.after', c.auto_end_minutes, { count: c.auto_end_minutes }) : yesNo(false),
    }),
    t(lang, 'moderation.lockdown.status.notice', { channel: c.announce_channel_id ? `<#${c.announce_channel_id}>` : t(lang, 'moderation.lockdown.status.noChannel') }),
    t(lang, 'moderation.lockdown.status.antiRaid'),
  ];
  return reply(interaction, lines.join('\n'), active ? RED : GREY);
}

async function config(interaction, lang) {
  const o = interaction.options;
  const patch = {};
  for (const [key, value] of [['pause_invites', o.getBoolean('pause_invites')], ['raise_verification', o.getBoolean('raise_verification')], ['auto_end_minutes', o.getInteger('auto_end_minutes')], ['message', o.getString('message')]]) {
    if (value !== null && value !== undefined) patch[key] = value;
  }
  const announce = o.getChannel('announce_channel');
  if (announce) patch.announce_channel_id = announce.id;
  if (Object.keys(patch).length) await db.upsertConfig(interaction.guild.id, patch);
  return status(interaction, lang);
}

async function channel(interaction, sub, lang) {
  const target = interaction.options.getChannel('channel', true);
  const c = await db.getConfig(interaction.guild.id);
  const ids = sub === 'add' ? [...new Set([...c.channel_ids, target.id])] : c.channel_ids.filter((id) => id !== target.id);
  await db.upsertConfig(interaction.guild.id, { channel_ids: ids });
  const done = t(lang, sub === 'add' ? 'moderation.lockdown.channel.added' : 'moderation.lockdown.channel.removed', { emoji: EMOJI.APPROVE, channel: `${target}` });
  return reply(interaction, `${done}${ids.length === 0 ? t(lang, 'moderation.lockdown.channel.noneChosen') : ''}`);
}
