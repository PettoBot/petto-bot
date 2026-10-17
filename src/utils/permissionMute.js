// Image mute (!imute) and reaction mute (!rmute): a role that takes away only some permissions in every channel, so the member
// can still talk. The role is made the first time it is needed, like the mute role, and new channels get its overwrite too.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { canModerate } = require('./permissions');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const { failureDetail } = require('./moderationCommand');
const logger = require('./logger');
const { t, guildLanguage, languageOf } = require('../i18n');

const KINDS = {
  image: { column: 'image_mute_role_id', overwrite: { AttachFiles: false, EmbedLinks: false }, color: 0x5865f2, logOn: 'imuted', logOff: 'iunmuted' },
  reaction: { column: 'reaction_mute_role_id', overwrite: { AddReactions: false, UseExternalEmojis: false, UseExternalStickers: false }, color: 0xeb459e, logOn: 'rmuted', logOff: 'runmuted' },
};
const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildCategory];

/** The role of the kind for the server, made (with its overwrite in every channel) when it does not exist yet. */
async function ensureRole(guild, kind, guildConfig) {
  const spec = KINDS[kind];
  const existing = guildConfig?.[spec.column] ? guild.roles.cache.get(guildConfig[spec.column]) : null;
  if (existing) return existing;

  const lang = await guildLanguage(guild.id);
  const role = await guild.roles.create({ name: t(lang, `moderation.pmute.${kind}.roleName`), color: spec.color, permissions: [], reason: t(lang, 'moderation.pmute.audit.created') });
  for (const channel of guild.channels.cache.values()) {
    if (!CHANNEL_TYPES.includes(channel.type)) continue;
    await channel.permissionOverwrites.edit(role, spec.overwrite, { reason: t(lang, 'moderation.pmute.audit.setup') }).catch((err) => {
      logger.warn(`Could not set the ${kind} mute overwrite in ${channel.id}: ${err.message}`);
    });
  }
  await updateGuild(guild.id, { [spec.column]: role.id });
  return role;
}

/** Gives a new channel the overwrites of the image and reaction mute roles of its server. */
async function applyToNewChannel(channel, guildConfig) {
  if (!CHANNEL_TYPES.includes(channel.type)) return;
  const lang = await guildLanguage(channel.guild.id);
  for (const spec of Object.values(KINDS)) {
    const role = guildConfig?.[spec.column] ? channel.guild.roles.cache.get(guildConfig[spec.column]) : null;
    if (role) await channel.permissionOverwrites.edit(role, spec.overwrite, { reason: t(lang, 'moderation.pmute.audit.setup') });
  }
}

/** The command of one kind: `user` (default) gives the role, `remove` takes it away. */
function createPermissionMuteCommand(kind, { name, aliases, description, userText, removeText }) {
  return {
    aliases,
    prefixDefaultSubcommand: 'user',
    prefixSubcommandAliases: { off: 'remove', undo: 'remove' },
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addSubcommand((sub) => sub.setName('user').setDescription(userText).addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason (shown in the audit log)')))
      .addSubcommand((sub) => sub.setName('remove').setDescription(removeText).addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason (shown in the audit log)'))),

    async execute(interaction) {
      return run(interaction, kind, interaction.options.getSubcommand() !== 'remove');
    },
  };
}

async function run(interaction, kind, muting) {
  const lang = await languageOf(interaction);
  const spec = KINDS[kind];
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }
  const check = canModerate(interaction, member, PermissionFlagsBits.ModerateMembers, { hierarchy: 'none' });
  if (!check.ok) {
    await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild.members.me.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) {
    await interaction.reply({ content: t(lang, 'moderation.pmute.iNeed'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const reply = (text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  const guildConfig = await ensureGuild(interaction.guild.id);

  let role;
  try {
    role = muting ? await ensureRole(interaction.guild, kind, guildConfig) : interaction.guild.roles.cache.get(guildConfig[spec.column]) ?? null;
  } catch (err) {
    logger.error(`Could not set up the ${kind} mute role:`, err);
    return reply(t(lang, 'moderation.pmute.roleFailed', { detail: failureDetail(err, lang) }), 0xfe6465);
  }
  const has = Boolean(role && member.roles.cache.has(role.id));
  if (muting === has) return reply(t(lang, `moderation.pmute.${kind}.${muting ? 'already' : 'notMuted'}`, { emoji: EMOJI.DENY, user: `${user}` }), 0x4b4f59);

  const audit = reason ?? t(lang, muting ? 'moderation.pmute.audit.on' : 'moderation.pmute.audit.off', { user: interaction.user.tag });
  try {
    if (muting) await member.roles.add(role, audit);
    else await member.roles.remove(role, audit);
  } catch (err) {
    logger.warn(`${kind} mute ${muting ? 'add' : 'remove'} failed for ${member.id}: ${err.message}`);
    return reply(t(lang, 'moderation.role.changeFailed'), 0xfe6465);
  }
  // Loaded here: the logs need the whole logging layer, which the checks of this file do without.
  require('../logging/moreLog').handleStaffAction(muting ? spec.logOn : spec.logOff, interaction.client, interaction.guild, { moderator: interaction.user, user, note: reason }).catch(() => {});
  const lines = [t(lang, `moderation.pmute.${kind}.${muting ? 'done' : 'undone'}`, { emoji: muting ? EMOJI.ALERT : EMOJI.APPROVE, user: `${user}` })];
  if (reason) lines.push(t(lang, 'moderation.common.reason', { reason }));
  return reply(lines.join('\n'), muting ? 0xfed53c : 0xa5ea7a);
}

module.exports = { KINDS, ensureRole, applyToNewChannel, createPermissionMuteCommand };
