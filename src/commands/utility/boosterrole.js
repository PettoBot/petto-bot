// Booster-role self-service and administrator configuration.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration: parseLength } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/boosterRole');
const actions = require('../../utils/boosterRoleActions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const COOLDOWN_CONFIG_FIELD = { color: 'color_cooldown_ms', icon: 'icon_cooldown_ms', rename: 'rename_cooldown_ms' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boosterrole')
    .setDescription('Custom colored role for server boosters — create your own, or share it with friends.')
    .setDMPermission(false)

    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create your booster role. Requires boosting.')
        .addStringOption((o) => o.setName('name').setDescription('Role name').setRequired(true))
        .addStringOption((o) => o.setName('hex').setDescription('#RRGGBB').setRequired(false))
        .addStringOption((o) => o.setName('hex2').setDescription('Second #RRGGBB for a gradient').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('color')
        .setDescription('Create/update your booster role color. Requires boosting.')
        .addStringOption((o) => o.setName('hex').setDescription('#RRGGBB').setRequired(true))
        .addStringOption((o) => o.setName('hex2').setDescription('Second #RRGGBB for a gradient').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('rename').setDescription('Rename your booster role. Requires boosting.').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((s) => s.setName('icon').setDescription('Set your booster role icon. Requires boosting.').addStringOption((o) => o.setName('input').setDescription('Image URL, custom emoji, or sticker ID (or just attach an image)').setRequired(false)))
    .addSubcommand((s) => s.setName('random').setDescription('Set your booster role to a random color. Requires boosting.'))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete your booster role.'))
    .addSubcommand((s) => s.setName('share').setDescription('Share your booster role with another member.').addUserOption((o) => o.setName('user').setDescription('Member to share with').setRequired(true)))
    .addSubcommand((s) => s.setName('unshare').setDescription('Stop sharing your booster role with a member.').addUserOption((o) => o.setName('user').setDescription('Member to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('shared').setDescription('See who your booster role is shared with.'))

    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('(Staff) Directly manage any member\'s booster role, and server-wide settings.')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Create/update a member\'s booster role directly (bypasses their cooldowns/limit).')
            .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
            .addStringOption((o) => o.setName('hex').setDescription('#RRGGBB').setRequired(false))
            .addStringOption((o) => o.setName('hex2').setDescription('Second #RRGGBB for a gradient').setRequired(false))
            .addStringOption((o) => o.setName('name').setDescription('Role name').setRequired(false)),
        )
        .addSubcommand((s) => s.setName('rename').setDescription('Rename a member\'s booster role.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
        .addSubcommand((s) => s.setName('icon').setDescription('Set a member\'s booster role icon.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('input').setDescription('Image URL, custom emoji, or sticker ID (or just attach an image)').setRequired(false)))
        .addSubcommand((s) => s.setName('remove').setDescription('Delete a member\'s booster role.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List every booster role in this server.'))
        .addSubcommand((s) => s.setName('link').setDescription('Associate an existing role with a member as their booster role.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('cleanup').setDescription('Delete booster roles belonging to members who are no longer boosting.'))
        .addSubcommand((s) => s.setName('base').setDescription('New booster roles are placed just above this role.').addRoleOption((o) => o.setName('role').setDescription('Base role').setRequired(true)))
        .addSubcommand((s) => s.setName('limit').setDescription('Max booster roles per member (0 = unlimited).').addIntegerOption((o) => o.setName('count').setDescription('Limit').setRequired(true).setMinValue(0)))
        .addSubcommand((s) =>
          s
            .setName('cooldown')
            .setDescription('Set how often boosters can change their role.')
            .addStringOption((o) => o.setName('type').setDescription('Which cooldown').setRequired(true).addChoices({ name: 'color', value: 'color' }, { name: 'icon', value: 'icon' }, { name: 'rename', value: 'rename' }))
            .addStringOption((o) => o.setName('duration').setDescription('e.g. 30s, 5m, 2h, 24h, or 0 to disable').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('share-limit').setDescription('Max members one booster role can be shared with (0 = unlimited).').addIntegerOption((o) => o.setName('count').setDescription('Limit').setRequired(true).setMinValue(0))),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('filter')
        .setDescription('(Staff) Words not allowed in booster role names.')
        .addSubcommand((s) => s.setName('add').setDescription('Block a word from booster role names.').addStringOption((o) => o.setName('word').setDescription('Word or phrase').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Allow a word again in booster role names.').addStringOption((o) => o.setName('word').setDescription('Word or phrase').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List filtered words.')),
    ),

  aliases: ['br'],

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'admin') return adminCmd(interaction, sub);
    if (group === 'filter') return filterCmd(interaction, sub);

    switch (sub) {
      case 'create':
        return selfCreate(interaction);
      case 'color':
        return selfColor(interaction);
      case 'rename':
        return selfRename(interaction);
      case 'icon':
        return selfIcon(interaction);
      case 'random':
        return selfRandom(interaction);
      case 'remove':
        return selfRemove(interaction);
      case 'share':
        return selfShare(interaction);
      case 'unshare':
        return selfUnshare(interaction);
      default:
        return selfShared(interaction);
    }
  },
};

function isBoosting(member) {
  return Boolean(member.premiumSince);
}

async function requireBotCanManageRoles(interaction) {
  const lang = await languageOf(interaction);
  if (interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) return true;
  await interaction.reply({ content: t(lang, 'core.moderate.iNeed', { permission: t(lang, 'core.perm.ManageRoles') }), flags: MessageFlags.Ephemeral });
  return false;
}

async function selfCreate(interaction) {
  const lang = await languageOf(interaction);
  if (!isBoosting(interaction.member)) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.notBooster'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await requireBotCanManageRoles(interaction))) return;

  const name = interaction.options.getString('name', true);
  const hex1Raw = interaction.options.getString('hex');
  const hex2Raw = interaction.options.getString('hex2');

  const hex1 = hex1Raw ? actions.parseHex(hex1Raw) : null;
  if (hex1Raw && !hex1) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.badHex'), flags: MessageFlags.Ephemeral });
    return;
  }
  const hex2 = hex2Raw ? actions.parseHex(hex2Raw) : null;
  if (hex2Raw && !hex2) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.badHex2'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (existing && interaction.guild.roles.cache.has(existing.role_id)) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.alreadyHave'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const result = await actions.applyRole({ guild: interaction.guild, member: interaction.member, colorInt: hex1?.int, color2Int: hex2?.int, name, lang });
  if (result.error) {
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  ${result.error}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (hex1) await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { role_id: result.role.id, color: hex1.hex, color2: hex2?.hex ?? null });

  const text = t(lang, 'utility.boosterrole.created', { emoji: EMOJI.APPROVE, role: `${result.role}` });
  await interaction.editReply({ components: [textCard(text, hex1?.int ?? 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function selfColor(interaction) {
  const lang = await languageOf(interaction);
  if (!isBoosting(interaction.member)) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.notBooster'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await requireBotCanManageRoles(interaction))) return;

  const hex1 = actions.parseHex(interaction.options.getString('hex', true));
  const hex2Raw = interaction.options.getString('hex2');
  if (!hex1) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.badHex'), flags: MessageFlags.Ephemeral });
    return;
  }
  const hex2 = hex2Raw ? actions.parseHex(hex2Raw) : null;
  if (hex2Raw && !hex2) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.badHex2'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const config = await db.ensureConfig(interaction.guild.id);
  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  const remaining = actions.getRemainingCooldown(existing?.color_cooldown_at, config.color_cooldown_ms);
  if (remaining > 0) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.cooldown.color', { duration: actions.formatDuration(remaining) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const result = await actions.applyRole({ guild: interaction.guild, member: interaction.member, colorInt: hex1.int, color2Int: hex2?.int, lang });
  if (result.error) {
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  ${result.error}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { role_id: result.role.id, color: hex1.hex, color2: hex2?.hex ?? null, color_cooldown_at: new Date().toISOString() });

  const colorText = hex2 ? `\`${hex1.hex}\` + \`${hex2.hex}\`` : `\`${hex1.hex}\``;
  const text = t(lang, result.updated ? 'utility.boosterrole.colorUpdated' : 'utility.boosterrole.colorCreated', { emoji: EMOJI.APPROVE, role: `${result.role}`, color: colorText });
  await interaction.editReply({ components: [textCard(text, hex1.int)], flags: MessageFlags.IsComponentsV2 });
}

async function selfRename(interaction) {
  const lang = await languageOf(interaction);
  if (!isBoosting(interaction.member)) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.notBooster'), flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const config = await db.ensureConfig(interaction.guild.id);
  if (actions.filterCheck(name, config.filtered_words)) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.filteredName'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.noneUseColor'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const remaining = actions.getRemainingCooldown(existing.rename_cooldown_at, config.rename_cooldown_ms);
  if (remaining > 0) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.cooldown.rename', { duration: actions.formatDuration(remaining) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (!role) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.gone'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await role.setName(name).catch((err) => logger.warn('Booster role rename failed:', err.message));
  await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { rename_cooldown_at: new Date().toISOString() });

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.renamed', { emoji: EMOJI.APPROVE, name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function selfIcon(interaction) {
  const lang = await languageOf(interaction);
  if (!isBoosting(interaction.member)) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.notBooster'), flags: MessageFlags.Ephemeral });
    return;
  }

  const input = interaction.options.getString('input') ?? interaction.rawMessage?.attachments?.first()?.url;
  if (!input) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.icon.needInput'), flags: MessageFlags.Ephemeral });
    return;
  }
  const resolved = actions.resolveIconInput(input, lang);
  if (resolved.error) {
    await interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const config = await db.ensureConfig(interaction.guild.id);
  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.noneUseColor'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const remaining = actions.getRemainingCooldown(existing.icon_cooldown_at, config.icon_cooldown_ms);
  if (remaining > 0) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.cooldown.icon', { duration: actions.formatDuration(remaining) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (!role) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.gone'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  try {
    await role.setIcon(resolved.url);
  } catch (err) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.icon.failed', { emoji: EMOJI.DENY, error: err.message }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { icon_cooldown_at: new Date().toISOString() });
  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.icon.updated', { emoji: EMOJI.APPROVE }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function selfRandom(interaction) {
  const lang = await languageOf(interaction);
  if (!isBoosting(interaction.member)) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.notBooster'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await requireBotCanManageRoles(interaction))) return;

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const colorInt = actions.randomColorInt();
  const result = await actions.applyRole({ guild: interaction.guild, member: interaction.member, colorInt, lang });
  if (result.error) {
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  ${result.error}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const hex = `#${colorInt.toString(16).padStart(6, '0').toUpperCase()}`;
  await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { role_id: result.role.id, color: hex, color_cooldown_at: new Date().toISOString() });

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.randomSet', { emoji: EMOJI.APPROVE, hex }), colorInt)], flags: MessageFlags.IsComponentsV2 });
}

async function selfRemove(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.none'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (role) await role.delete(t(lang, 'utility.boosterrole.audit.removedBy', { user: interaction.user.tag })).catch((err) => logger.warn('Booster role delete failed:', err.message));
  await db.deleteBoosterRole(interaction.guild.id, interaction.user.id);

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.removed', { emoji: EMOJI.APPROVE }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function selfShare(interaction) {
  const lang = await languageOf(interaction);
  if (!isBoosting(interaction.member)) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.notBooster'), flags: MessageFlags.Ephemeral });
    return;
  }

  const target = interaction.options.getUser('user', true);
  if (target.id === interaction.user.id) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.share.self'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.noneYet'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (!role) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.gone'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (existing.shared_with.includes(target.id)) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.share.already'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const config = await db.ensureConfig(interaction.guild.id);
  if (config.share_max > 0 && 1 + existing.shared_with.length >= config.share_max) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.share.limit', { max: config.share_max }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.notMember'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await targetMember.roles.add(role).catch((err) => logger.warn('Booster role share failed:', err.message));
  await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { shared_with: [...existing.shared_with, target.id] });

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.share.done', { emoji: EMOJI.APPROVE, user: `${target}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function selfUnshare(interaction) {
  const lang = await languageOf(interaction);
  const target = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.none'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.guild.roles.cache.get(existing.role_id);
  const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (role && targetMember) await targetMember.roles.remove(role).catch(() => {});

  await db.upsertBoosterRole(interaction.guild.id, interaction.user.id, { shared_with: existing.shared_with.filter((id) => id !== target.id) });
  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.unshare.done', { emoji: EMOJI.APPROVE, user: `${target}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function selfShared(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, interaction.user.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.noneYet'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const shared = existing.shared_with.length ? existing.shared_with.map((id) => `<@${id}>`).join(', ') : t(lang, 'utility.boosterrole.shared.none');
  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.shared.text', { role: `<@&${existing.role_id}>`, users: shared }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function requireManageGuild(interaction) {
  const lang = await languageOf(interaction);
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  await interaction.reply({ content: t(lang, 'core.moderate.youNeed', { permission: t(lang, 'core.perm.ManageGuild') }), flags: MessageFlags.Ephemeral });
  return false;
}

async function adminCmd(interaction, sub) {
  if (!(await requireManageGuild(interaction))) return;

  if (sub === 'set') return adminSet(interaction);
  if (sub === 'rename') return adminRename(interaction);
  if (sub === 'icon') return adminIcon(interaction);
  if (sub === 'remove') return adminRemove(interaction);
  if (sub === 'list') return adminList(interaction);
  if (sub === 'link') return adminLink(interaction);
  if (sub === 'cleanup') return adminCleanup(interaction);
  if (sub === 'base') return adminBase(interaction);
  if (sub === 'limit') return adminLimit(interaction);
  if (sub === 'cooldown') return adminCooldown(interaction);
  return adminShareLimit(interaction);
}

async function adminSet(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const hex1Raw = interaction.options.getString('hex');
  const hex2Raw = interaction.options.getString('hex2');
  const name = interaction.options.getString('name');

  if (!hex1Raw && !hex2Raw && !name) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.admin.needValue'), flags: MessageFlags.Ephemeral });
    return;
  }

  const hex1 = hex1Raw ? actions.parseHex(hex1Raw) : null;
  if (hex1Raw && !hex1) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.badHex'), flags: MessageFlags.Ephemeral });
    return;
  }
  const hex2 = hex2Raw ? actions.parseHex(hex2Raw) : null;
  if (hex2Raw && !hex2) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.badHex2'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!(await requireBotCanManageRoles(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.notMember'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const result = await actions.applyRole({ guild: interaction.guild, member: targetMember, colorInt: hex1?.int, color2Int: hex2?.int, name: name ?? undefined, bypassLimit: true, lang });
  if (result.error) {
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  ${result.error}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const patch = {};
  if (hex1) patch.color = hex1.hex;
  if (hex2) patch.color2 = hex2.hex;
  if (Object.keys(patch).length) await db.upsertBoosterRole(interaction.guild.id, targetUser.id, { role_id: result.role.id, ...patch });

  await interaction.editReply({ components: [textCard(t(lang, result.updated ? 'utility.boosterrole.admin.updated' : 'utility.boosterrole.admin.created', { emoji: EMOJI.APPROVE, user: `${targetUser}`, role: `${result.role}` }), hex1?.int ?? 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminRename(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const name = interaction.options.getString('name', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, targetUser.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.none'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (!role) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.gone'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await role.setName(name).catch((err) => logger.warn('Admin booster role rename failed:', err.message));
  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.renamed', { emoji: EMOJI.APPROVE, user: `${targetUser}`, name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminIcon(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const input = interaction.options.getString('input') ?? interaction.rawMessage?.attachments?.first()?.url;
  if (!input) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.icon.needInput'), flags: MessageFlags.Ephemeral });
    return;
  }
  const resolved = actions.resolveIconInput(input, lang);
  if (resolved.error) {
    await interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, targetUser.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.none'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (!role) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.gone'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  try {
    await role.setIcon(resolved.url);
  } catch (err) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.icon.failed', { emoji: EMOJI.DENY, error: err.message }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.iconUpdated', { emoji: EMOJI.APPROVE, user: `${targetUser}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminRemove(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await db.getBoosterRole(interaction.guild.id, targetUser.id);
  if (!existing) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.none'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.guild.roles.cache.get(existing.role_id);
  if (role) await role.delete(t(lang, 'utility.boosterrole.audit.removedBy', { user: interaction.user.tag })).catch((err) => logger.warn('Admin booster role delete failed:', err.message));
  await db.deleteBoosterRole(interaction.guild.id, targetUser.id);

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.removed', { emoji: EMOJI.APPROVE, user: `${targetUser}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminList(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const all = await db.listBoosterRoles(interaction.guild.id);
  if (!all.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.list.empty'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = all.map((br) => {
    const role = interaction.guild.roles.cache.get(br.role_id);
    const shared = br.shared_with.length ? ` ${t(lang, 'utility.boosterrole.list.shared', { users: br.shared_with.map((id) => `<@${id}>`).join(', ') })}` : '';
    return `<@${br.user_id}> → ${role ? `<@&${br.role_id}>` : t(lang, 'utility.boosterrole.list.deleted', { id: br.role_id })}${br.color ? ` \`${br.color}\`` : ''}${shared}`;
  });

  await interaction.editReply({ components: [textCard(`${t(lang, 'utility.boosterrole.list.title', { count: all.length })}\n${lines.join('\n').slice(0, 3800)}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function adminLink(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const role = interaction.options.getRole('role', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.upsertBoosterRole(interaction.guild.id, targetUser.id, { role_id: role.id });

  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.linked', { emoji: EMOJI.APPROVE, user: `${targetUser}`, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminCleanup(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const all = await db.listBoosterRoles(interaction.guild.id);
  let deleted = 0;

  for (const br of all) {
    const member = await interaction.guild.members.fetch(br.user_id).catch(() => null);
    if (member?.premiumSince) continue;

    const role = interaction.guild.roles.cache.get(br.role_id);
    if (role) await role.delete(t(lang, 'utility.boosterrole.audit.cleanup')).catch(() => {});
    await db.deleteBoosterRole(interaction.guild.id, br.user_id);
    deleted++;
  }

  await interaction.editReply({ components: [textCard(tn(lang, 'utility.boosterrole.admin.cleanedUp', deleted, { emoji: EMOJI.APPROVE, count: deleted }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminBase(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.upsertConfig(interaction.guild.id, { base_role_id: role.id });
  await interaction.editReply({ components: [textCard(t(lang, 'utility.boosterrole.admin.base', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminLimit(interaction) {
  const lang = await languageOf(interaction);
  const count = interaction.options.getInteger('count', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.upsertConfig(interaction.guild.id, { role_limit: count });
  await interaction.editReply({ components: [textCard(t(lang, count === 0 ? 'utility.boosterrole.admin.limitUnlimited' : 'utility.boosterrole.admin.limit', { emoji: EMOJI.APPROVE, count }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminCooldown(interaction) {
  const lang = await languageOf(interaction);
  const type = interaction.options.getString('type', true);
  const durationStr = interaction.options.getString('duration', true);

  const durationMs = durationStr === '0' ? 0 : parseLength(durationStr);
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs) || durationMs < 0) {
    await interaction.reply({ content: t(lang, 'utility.boosterrole.admin.badDuration'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.upsertConfig(interaction.guild.id, { [COOLDOWN_CONFIG_FIELD[type]]: durationMs });

  await interaction.editReply({ components: [textCard(durationMs
    ? t(lang, 'utility.boosterrole.admin.cooldown', { emoji: EMOJI.APPROVE, type, duration: actions.formatDuration(durationMs) })
    : t(lang, 'utility.boosterrole.admin.cooldownOff', { emoji: EMOJI.APPROVE, type }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function adminShareLimit(interaction) {
  const lang = await languageOf(interaction);
  const count = interaction.options.getInteger('count', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.upsertConfig(interaction.guild.id, { share_max: count });
  await interaction.editReply({ components: [textCard(t(lang, count === 0 ? 'utility.boosterrole.admin.shareLimitUnlimited' : 'utility.boosterrole.admin.shareLimit', { emoji: EMOJI.APPROVE, count }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function filterCmd(interaction, sub) {
  const lang = await languageOf(interaction);
  if (!(await requireManageGuild(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const config = await db.ensureConfig(interaction.guild.id);

  if (sub === 'list') {
    const text = config.filtered_words.length ? config.filtered_words.map((w) => `\`${w}\``).join(', ') : t(lang, 'utility.boosterrole.filter.empty');
    await interaction.editReply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const word = interaction.options.getString('word', true).toLowerCase();
  const words = new Set(config.filtered_words);
  if (sub === 'add') words.add(word);
  else words.delete(word);

  await db.upsertConfig(interaction.guild.id, { filtered_words: [...words] });
  await interaction.editReply({ components: [textCard(t(lang, sub === 'add' ? 'utility.boosterrole.filter.added' : 'utility.boosterrole.filter.removed', { emoji: EMOJI.APPROVE, word }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
