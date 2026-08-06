const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { createBackup, listBackups, getBackup } = require('../../db/backups');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['backups', 'serverbackup'],
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Create and export a safe snapshot of this server configuration.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('create').setDescription('Save roles, channels, permissions, emojis and server settings.').addStringOption((opt) => opt.setName('label').setDescription('Optional name for this backup').setMaxLength(80).setRequired(false)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List the latest saved backups.'))
    .addSubcommand((sub) => sub.setName('export').setDescription('Download a backup as a JSON file.').addIntegerOption((opt) => opt.setName('id').setDescription('Backup ID, or omit it for the latest one').setMinValue(1).setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction);
    if (sub === 'export') return exportBackup(interaction);
    return list(interaction);
  },
};

async function create(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const snapshot = buildSnapshot(guild);
  const label = interaction.options.getString('label')?.trim() || null;
  const saved = await createBackup(guild.id, interaction.user.id, label, snapshot);

  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setTitle('Backup saved')
    .setDescription(`Backup **#${saved.id}** is ready. It contains configuration only, never bot tokens or secrets.`)
    .addFields(
      { name: 'Roles', value: String(snapshot.roles.length), inline: true },
      { name: 'Channels', value: String(snapshot.channels.length), inline: true },
      { name: 'Emojis', value: String(snapshot.emojis.length), inline: true },
    )
    .setFooter({ text: 'Use !backup export id to download it.' });
  await interaction.editReply({ embeds: [embed] });
}

async function list(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await listBackups(interaction.guild.id);
  const description = rows.length
    ? rows.map((row) => `**#${row.id}** ${row.label || 'Manual backup'} · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`).join('\n')
    : 'No backups saved yet. Use `!backup create` to create one.';
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.DEFAULT).setTitle(`Backups · ${interaction.guild.name}`).setDescription(description)] });
}

async function exportBackup(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger('id');
  const backup = await getBackup(interaction.guild.id, id);
  if (!backup) {
    await interaction.editReply({ content: id ? `Backup #${id} was not found.` : 'No backups saved yet. Use `!backup create` first.' });
    return;
  }

  const body = JSON.stringify(backup.snapshot, null, 2);
  const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: `petto-backup-${interaction.guild.id}-${backup.id}.json` });
  await interaction.editReply({ content: `Backup **#${backup.id}** · ${backup.label || 'Manual backup'}`, files: [file] });
}

function buildSnapshot(guild) {
  return {
    format: 'petto-server-backup',
    version: 1,
    capturedAt: new Date().toISOString(),
    guild: {
      id: guild.id,
      name: guild.name,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      afkTimeout: guild.afkTimeout,
      afkChannelId: guild.afkChannelId,
      systemChannelId: guild.systemChannelId,
    },
    roles: [...guild.roles.cache.values()]
      .filter((role) => !role.managed)
      .sort((a, b) => a.position - b.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        position: role.position,
        permissions: role.permissions.bitfield.toString(),
      })),
    channels: [...guild.channels.cache.values()]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.position,
        topic: 'topic' in channel ? channel.topic : null,
        nsfw: 'nsfw' in channel ? channel.nsfw : false,
        rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0,
        bitrate: 'bitrate' in channel ? channel.bitrate : null,
        userLimit: 'userLimit' in channel ? channel.userLimit : null,
        permissionOverwrites: channel.permissionOverwrites?.cache.map((overwrite) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() })) ?? [],
      })),
    emojis: [...guild.emojis.cache.values()].map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated })),
  };
}

module.exports.buildSnapshot = buildSnapshot;
