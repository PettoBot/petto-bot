const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/lockdown');
const { startLockdown, endLockdown, targetChannels } = require('../../utils/lockdown');
const { requireAdministrator } = require('../../utils/moderationCommand');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

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
    try {
      if (group === 'channel') return await channel(interaction, sub);
      if (sub === 'start') return await start(interaction);
      if (sub === 'end') return await end(interaction);
      if (sub === 'config') return await config(interaction);
      return await status(interaction);
    } catch (err) {
      if (err.userFacing) return reply(interaction, err.message, RED);
      throw err;
    }
  },
};

async function start(interaction) {
  const result = await startLockdown(interaction.guild, { startedBy: interaction.user.id, reason: interaction.options.getString('reason'), minutes: interaction.options.getInteger('minutes') });
  return reply(interaction, [`### ${EMOJI.ALERT} Lockdown on`, `**${result.locked}** channel(s) closed${result.failed ? ` (${result.failed} could not be)` : ''}${result.invitesDeleted ? `, ${result.invitesDeleted} invite(s) deleted` : ''}.`, result.endsInMinutes ? `It ends by itself in ${result.endsInMinutes} minutes.` : 'It stays until you end it with `lockdown end`.'].join('\n'), RED);
}

async function end(interaction) {
  const result = await endLockdown(interaction.guild, { endedBy: interaction.user.id });
  return reply(interaction, `${EMOJI.APPROVE} Lockdown ended. **${result.restored}** channel(s) reopened${result.failed ? `, ${result.failed} could not be` : ''}.`);
}

async function status(interaction) {
  const [active, c] = await Promise.all([db.getActive(interaction.guild.id), db.getConfig(interaction.guild.id)]);
  const scope = c.channel_ids.length ? c.channel_ids.map((id) => `<#${id}>`).join(' ') : `every text channel (${targetChannels(interaction.guild, c).length})`;
  const lines = [
    active ? `### ${EMOJI.ALERT} Lockdown on since <t:${Math.floor(new Date(active.started_at).getTime() / 1000)}:R>${active.ends_at ? ` · ends <t:${Math.floor(new Date(active.ends_at).getTime() / 1000)}:R>` : ''}` : '### Lockdown off',
    `**Closes:** ${scope}`,
    `**Pauses invites:** ${c.pause_invites ? 'yes' : 'no'} · **Raises verification:** ${c.raise_verification ? 'yes' : 'no'} · **Ends by itself:** ${c.auto_end_minutes ? `after ${c.auto_end_minutes} minutes` : 'no'}`,
    `**Notice:** ${c.announce_channel_id ? `<#${c.announce_channel_id}>` : 'no channel'}`,
    '-# Anti Raid can start it by itself: set its action to lockdown.',
  ];
  return reply(interaction, lines.join('\n'), active ? RED : GREY);
}

async function config(interaction) {
  const o = interaction.options;
  const patch = {};
  for (const [key, value] of [['pause_invites', o.getBoolean('pause_invites')], ['raise_verification', o.getBoolean('raise_verification')], ['auto_end_minutes', o.getInteger('auto_end_minutes')], ['message', o.getString('message')]]) {
    if (value !== null && value !== undefined) patch[key] = value;
  }
  const announce = o.getChannel('announce_channel');
  if (announce) patch.announce_channel_id = announce.id;
  if (Object.keys(patch).length) await db.upsertConfig(interaction.guild.id, patch);
  return status(interaction);
}

async function channel(interaction, sub) {
  const target = interaction.options.getChannel('channel', true);
  const c = await db.getConfig(interaction.guild.id);
  const ids = sub === 'add' ? [...new Set([...c.channel_ids, target.id])] : c.channel_ids.filter((id) => id !== target.id);
  await db.upsertConfig(interaction.guild.id, { channel_ids: ids });
  return reply(interaction, `${EMOJI.APPROVE} ${target} ${sub === 'add' ? 'will be closed' : 'will not be closed'} in a lockdown.${ids.length === 0 ? ' With no channels chosen, every text channel is closed.' : ''}`);
}
