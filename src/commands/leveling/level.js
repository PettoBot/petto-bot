const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const levelConfigDb = require('../../db/levelConfig');
const levelUsersDb = require('../../db/levelUsers');
const levelRewardsDb = require('../../db/levelRewards');
const levelMultipliersDb = require('../../db/levelMultipliers');
const { stripRewardRoles } = require('../../utils/levelActions');
const { totalXpForLevel, levelForXp } = require('../../utils/levelCurve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const ACTION_CHOICES = [
  { name: 'add', value: 'add' },
  { name: 'set', value: 'set' },
  { name: 'remove', value: 'remove' },
  { name: 'transfer', value: 'transfer' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Configure the XP/leveling system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommand((s) => s.setName('enable').setDescription('Turn leveling on/off.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('xp')
        .setDescription('XP awarded per message (a random amount in this range).')
        .addIntegerOption((o) => o.setName('min').setDescription('Minimum XP per message').setRequired(true).setMinValue(0))
        .addIntegerOption((o) => o.setName('max').setDescription('Maximum XP per message').setRequired(true).setMinValue(0)),
    )
    .addSubcommand((s) => s.setName('voice-xp').setDescription('XP awarded per minute in voice.').addIntegerOption((o) => o.setName('amount').setDescription('XP per minute').setRequired(true).setMinValue(0)))
    .addSubcommand((s) => s.setName('cooldown').setDescription('Seconds between message-XP awards, per member.').addIntegerOption((o) => o.setName('seconds').setDescription('Cooldown').setRequired(true).setMinValue(0)))
    .addSubcommand((s) =>
      s
        .setName('curve')
        .setDescription('Advanced: tune the XP-per-level formula (a*L^3 + b*L^2 + c*L) * difficulty, rounded.')
        .addNumberOption((o) => o.setName('a').setDescription('Cubic coefficient (default 1)').setRequired(false))
        .addNumberOption((o) => o.setName('b').setDescription('Square coefficient (default 50)').setRequired(false))
        .addNumberOption((o) => o.setName('c').setDescription('Linear coefficient (default 100)').setRequired(false))
        .addNumberOption((o) => o.setName('difficulty').setDescription('Overall multiplier (default 2.5)').setRequired(false))
        .addIntegerOption((o) => o.setName('rounding').setDescription('Round totals to the nearest N (default 50, 0 = off)').setRequired(false).setMinValue(0)),
    )
    .addSubcommand((s) => s.setName('max-level').setDescription('Level cap.').addIntegerOption((o) => o.setName('count').setDescription('Max level').setRequired(true).setMinValue(1)))
    .addSubcommand((s) =>
      s
        .setName('notify')
        .setDescription('Configure the level-up announcement.')
        .addStringOption((o) => o.setName('mode').setDescription('Where it posts').setRequired(true).addChoices({ name: 'off', value: 'off' }, { name: 'reply (in the channel they leveled up in)', value: 'reply' }, { name: 'fixed channel', value: 'channel' }, { name: 'DM', value: 'dm' }))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to use with mode:channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
        .addBooleanOption((o) => o.setName('embed').setDescription('Wrap the message in an embed instead of a plain Components V2 card').setRequired(false))
        .addIntegerOption((o) => o.setName('every').setDescription('Only announce every N levels (default 1 = every level)').setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName('message').setDescription('Supports {user}, {level}, {level_xp}, {level_rank}, and every /embed variable').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('role-mode').setDescription('Whether members keep every earned reward role, or just the highest.').addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true).addChoices({ name: 'highest only', value: 'highest' }, { name: 'all earned', value: 'all' })))
    .addSubcommand((s) => s.setName('ignore').setDescription('Toggle a channel out of/into XP tracking.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription('Starting bonus for new members (level takes priority over xp if both are set).')
        .addIntegerOption((o) => o.setName('xp').setDescription('Starting XP').setRequired(false).setMinValue(0))
        .addIntegerOption((o) => o.setName('level').setDescription('Starting level').setRequired(false).setMinValue(0)),
    )
    .addSubcommand((s) => s.setName('sync-join').setDescription('Apply the current join bonus to every member who has zero XP right now.'))
    .addSubcommand((s) => s.setName('reset').setDescription('Wipe a member\'s XP/level and remove their reward roles.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the full current configuration.'))

    .addSubcommandGroup((g) =>
      g
        .setName('reward')
        .setDescription('Roles granted at specific levels.')
        .addSubcommand((s) => s.setName('add').setDescription('Grant a role at a level.').addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a level reward.').addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('list').setDescription('List all level rewards.')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('multiplier')
        .setDescription('XP multipliers for specific roles/channels.')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Set a multiplier for a role or channel.')
            .addNumberOption((o) => o.setName('value').setDescription('Multiplier, e.g. 2 for double XP, 0.5 for half').setRequired(true).setMinValue(0))
            .addRoleOption((o) => o.setName('role').setDescription('Role (provide this or channel)').setRequired(false))
            .addChannelOption((o) => o.setName('channel').setDescription('Channel (provide this or role)').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a multiplier.')
            .addRoleOption((o) => o.setName('role').setDescription('Role (provide this or channel)').setRequired(false))
            .addChannelOption((o) => o.setName('channel').setDescription('Channel (provide this or role)').setRequired(false)),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List all multipliers.')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('manage')
        .setDescription('Manually adjust a member\'s XP or level.')
        .addSubcommand((s) =>
          s
            .setName('xp')
            .setDescription('Add/set/remove/transfer a member\'s XP.')
            .addStringOption((o) => o.setName('action').setDescription('Action').setRequired(true).addChoices(...ACTION_CHOICES))
            .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(0))
            .addUserOption((o) => o.setName('target').setDescription('Transfer destination (required for action:transfer)').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('level')
            .setDescription('Add/set/remove a member\'s level directly (recomputes their XP to match).')
            .addStringOption((o) => o.setName('action').setDescription('Action').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'set', value: 'set' }, { name: 'remove', value: 'remove' }))
            .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('Level amount').setRequired(true).setMinValue(0)),
        ),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'reward') return rewardCmd(interaction, sub);
    if (group === 'multiplier') return multiplierCmd(interaction, sub);
    if (group === 'manage') return manageCmd(interaction, sub);

    switch (sub) {
      case 'enable':
        return enableCmd(interaction);
      case 'xp':
        return xpRangeCmd(interaction);
      case 'voice-xp':
        return voiceXpCmd(interaction);
      case 'cooldown':
        return cooldownCmd(interaction);
      case 'curve':
        return curveCmd(interaction);
      case 'max-level':
        return maxLevelCmd(interaction);
      case 'notify':
        return notifyCmd(interaction);
      case 'role-mode':
        return roleModeCmd(interaction);
      case 'ignore':
        return ignoreCmd(interaction);
      case 'join':
        return joinCmd(interaction);
      case 'sync-join':
        return syncJoinCmd(interaction);
      case 'reset':
        return resetCmd(interaction);
      default:
        return statusCmd(interaction);
    }
  },
};

async function reply(interaction, text, color = 0xa5ea7a) {
  await interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
}

async function defer(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
}

async function enableCmd(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { enabled });
  await reply(interaction, `${EMOJI.APPROVE}  Leveling ${enabled ? 'enabled' : 'disabled'}.`, enabled ? 0xa5ea7a : 0x8399ff);
}

async function xpRangeCmd(interaction) {
  const min = interaction.options.getInteger('min', true);
  const max = interaction.options.getInteger('max', true);
  if (min > max) {
    await interaction.reply({ content: '`min` cannot be greater than `max`.', flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { xp_min: min, xp_max: max });
  await reply(interaction, `${EMOJI.APPROVE}  Message XP set to **${min}-${max}** per message.`);
}

async function voiceXpCmd(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { xp_per_vc_minute: amount });
  await reply(interaction, `${EMOJI.APPROVE}  Voice XP set to **${amount}** per minute.`);
}

async function cooldownCmd(interaction) {
  const seconds = interaction.options.getInteger('seconds', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { cooldown_seconds: seconds });
  await reply(interaction, `${EMOJI.APPROVE}  Message XP cooldown set to **${seconds}s**.`);
}

async function curveCmd(interaction) {
  const patch = {};
  const a = interaction.options.getNumber('a');
  const b = interaction.options.getNumber('b');
  const c = interaction.options.getNumber('c');
  const difficulty = interaction.options.getNumber('difficulty');
  const rounding = interaction.options.getInteger('rounding');
  if (a != null) patch.curve_a = a;
  if (b != null) patch.curve_b = b;
  if (c != null) patch.curve_c = c;
  if (difficulty != null) patch.difficulty = difficulty;
  if (rounding != null) patch.rounding = rounding;

  if (!Object.keys(patch).length) {
    await interaction.reply({ content: 'Provide at least one of `a`, `b`, `c`, `difficulty`, `rounding`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await defer(interaction);
  const saved = await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  const preview = [10, 25, 50].map((l) => `Lv.${l}: ${totalXpForLevel(l, saved).toLocaleString()} XP`).join(' · ');
  await reply(interaction, `${EMOJI.APPROVE}  XP curve updated.\n${preview}`);
}

async function maxLevelCmd(interaction) {
  const count = interaction.options.getInteger('count', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { max_level: count });
  await reply(interaction, `${EMOJI.APPROVE}  Max level set to **${count}**.`);
}

async function notifyCmd(interaction) {
  const mode = interaction.options.getString('mode', true);
  const channel = interaction.options.getChannel('channel');
  const embed = interaction.options.getBoolean('embed');
  const every = interaction.options.getInteger('every');
  const message = interaction.options.getString('message');

  if (mode === 'channel' && !channel) {
    await interaction.reply({ content: 'Provide `channel` when `mode` is `channel`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = { notify_mode: mode };
  if (channel) patch.notify_channel_id = channel.id;
  if (embed != null) patch.notify_embed = embed;
  if (every != null) patch.notify_every = every;
  if (message) patch.notify_message = message;

  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, `${EMOJI.APPROVE}  Level-up notifications: **${mode}**.`);
}

async function roleModeCmd(interaction) {
  const mode = interaction.options.getString('mode', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { role_mode: mode });
  await reply(interaction, `${EMOJI.APPROVE}  Reward role mode: **${mode === 'highest' ? 'highest earned only' : 'all earned'}**.`);
}

async function ignoreCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const ignored = new Set(config.ignored_channel_ids);
  const wasIgnored = ignored.has(channel.id);
  wasIgnored ? ignored.delete(channel.id) : ignored.add(channel.id);
  await levelConfigDb.upsertConfig(interaction.guild.id, { ignored_channel_ids: [...ignored] });
  await reply(interaction, `${EMOJI.APPROVE}  ${channel} ${wasIgnored ? 'removed from' : 'added to'} ignored channels.`);
}

async function joinCmd(interaction) {
  const xp = interaction.options.getInteger('xp');
  const level = interaction.options.getInteger('level');
  if (xp == null && level == null) {
    await interaction.reply({ content: 'Provide `xp` and/or `level`.', flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  const patch = {};
  if (xp != null) patch.join_xp = xp;
  if (level != null) patch.join_level = level;
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, `${EMOJI.APPROVE}  New members will now start with ${level ? `level **${level}**` : `**${xp}** XP`}.`);
}

async function syncJoinCmd(interaction) {
  await defer(interaction);
  const config = await levelConfigDb.getConfig(interaction.guild.id);

  if (!config.join_xp && !config.join_level) {
    await reply(interaction, `${EMOJI.ALERT}  No join bonus configured. Set one with \`!level join\` first.`, 0xfe6465);
    return;
  }

  let level;
  let xp;
  if (config.join_level > 0) {
    level = config.join_level;
    xp = totalXpForLevel(level, config);
  } else {
    xp = config.join_xp;
    level = levelForXp(xp, config);
  }

  await interaction.guild.members.fetch().catch(() => {});
  let affected = 0;
  for (const member of interaction.guild.members.cache.values()) {
    if (member.user.bot) continue;
    const existing = await levelUsersDb.getUser(interaction.guild.id, member.id);
    if (existing && (existing.xp > 0 || existing.level > 0)) continue;
    await levelUsersDb.setXpAndLevel(interaction.guild.id, member.id, xp, level);
    affected++;
  }

  await reply(interaction, `${EMOJI.APPROVE}  Sync complete. **${affected}** member(s) affected.`);
}

async function resetCmd(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  await defer(interaction);

  await levelUsersDb.resetUser(interaction.guild.id, targetUser.id);

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember) await stripRewardRoles(interaction.guild, targetMember);

  await reply(interaction, `${EMOJI.APPROVE}  Reset ${targetUser}'s XP/level and removed their reward roles.`);
}

async function statusCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const rewards = await levelRewardsDb.listRewards(interaction.guild.id);
  const multipliers = await levelMultipliersDb.listMultipliers(interaction.guild.id);

  const lines = [
    `**Enabled:** ${config.enabled ? `${EMOJI.APPROVE} Yes` : `${EMOJI.DENY} No`}`,
    `**Message XP:** ${config.xp_min}-${config.xp_max} every ${config.cooldown_seconds}s`,
    `**Voice XP:** ${config.xp_per_vc_minute}/min`,
    `**Curve:** a=${config.curve_a} b=${config.curve_b} c=${config.curve_c} difficulty=${config.difficulty} rounding=${config.rounding}`,
    `**Max level:** ${config.max_level}`,
    `**Role mode:** ${config.role_mode}`,
    `**Notify:** ${config.notify_mode}${config.notify_channel_id ? ` (<#${config.notify_channel_id}>)` : ''}${config.notify_every > 1 ? `, every ${config.notify_every} levels` : ''}`,
    `**Join bonus:** ${config.join_level ? `level ${config.join_level}` : config.join_xp ? `${config.join_xp} XP` : 'None'}`,
    `**Ignored channels:** ${config.ignored_channel_ids.length ? config.ignored_channel_ids.map((id) => `<#${id}>`).join(', ') : 'None'}`,
    `**Rewards:** ${rewards.length ? rewards.map((r) => `Lv.${r.level} → <@&${r.role_id}>`).join(', ') : 'None'}`,
    `**Multipliers:** ${multipliers.length ? multipliers.map((m) => `${m.target_type === 'role' ? `<@&${m.target_id}>` : `<#${m.target_id}>`} ×${m.multiplier}`).join(', ') : 'None'}`,
  ];

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

// ── reward group ─────────────────────────────────────────────────────────────

async function rewardCmd(interaction, sub) {
  await defer(interaction);

  if (sub === 'list') {
    const rewards = await levelRewardsDb.listRewards(interaction.guild.id);
    const text = rewards.length ? rewards.map((r) => `**Level ${r.level}** → <@&${r.role_id}>`).join('\n') : 'No level rewards configured.';
    await reply(interaction, text, 0x8399ff);
    return;
  }

  const level = interaction.options.getInteger('level', true);

  if (sub === 'remove') {
    const removed = await levelRewardsDb.removeReward(interaction.guild.id, level);
    await reply(interaction, removed ? `${EMOJI.APPROVE}  Removed the level ${level} reward.` : `No reward configured for level ${level}.`, removed ? 0xa5ea7a : 0x8399ff);
    return;
  }

  const role = interaction.options.getRole('role', true);
  await levelRewardsDb.setReward(interaction.guild.id, level, role.id);
  await reply(interaction, `${EMOJI.APPROVE}  Members will now get ${role} at level **${level}**.`);
}

// ── multiplier group ─────────────────────────────────────────────────────────

async function multiplierCmd(interaction, sub) {
  await defer(interaction);

  if (sub === 'list') {
    const multipliers = await levelMultipliersDb.listMultipliers(interaction.guild.id);
    const text = multipliers.length ? multipliers.map((m) => `${m.target_type === 'role' ? `<@&${m.target_id}>` : `<#${m.target_id}>`} → ×${m.multiplier}`).join('\n') : 'No multipliers configured.';
    await reply(interaction, text, 0x8399ff);
    return;
  }

  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  if (!role && !channel) {
    await reply(interaction, 'Provide a `role` or a `channel`.', 0xfe6465);
    return;
  }
  const targetId = role ? role.id : channel.id;
  const targetType = role ? 'role' : 'channel';
  const targetMention = role ?? channel;

  if (sub === 'remove') {
    const removed = await levelMultipliersDb.removeMultiplier(interaction.guild.id, targetId);
    await reply(interaction, removed ? `${EMOJI.APPROVE}  Removed the multiplier for ${targetMention}.` : `No multiplier configured for ${targetMention}.`, removed ? 0xa5ea7a : 0x8399ff);
    return;
  }

  const value = interaction.options.getNumber('value', true);
  await levelMultipliersDb.setMultiplier(interaction.guild.id, targetId, targetType, value);
  await reply(interaction, `${EMOJI.APPROVE}  ${targetMention} now gives **×${value}** XP.`);
}

// ── manage group ─────────────────────────────────────────────────────────────

async function manageCmd(interaction, sub) {
  if (sub === 'xp') return manageXp(interaction);
  return manageLevel(interaction);
}

async function manageXp(interaction) {
  const action = interaction.options.getString('action', true);
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const destUser = interaction.options.getUser('target');

  if (action === 'transfer' && !destUser) {
    await interaction.reply({ content: 'Provide `target` for a transfer.', flags: MessageFlags.Ephemeral });
    return;
  }

  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const data = await levelUsersDb.ensureUser(interaction.guild.id, targetUser.id);

  let newXp = data.xp;
  if (action === 'add') newXp = data.xp + amount;
  else if (action === 'set') newXp = amount;
  else if (action === 'remove') newXp = Math.max(0, data.xp - amount);
  else if (action === 'transfer') {
    if (data.xp < amount) {
      await reply(interaction, `${EMOJI.DENY}  ${targetUser} doesn't have enough XP.`, 0xfe6465);
      return;
    }
    newXp = data.xp - amount;
    const destData = await levelUsersDb.ensureUser(interaction.guild.id, destUser.id);
    const destNewXp = destData.xp + amount;
    await levelUsersDb.setXpAndLevel(interaction.guild.id, destUser.id, destNewXp, levelForXp(destNewXp, config));
  }

  await levelUsersDb.setXpAndLevel(interaction.guild.id, targetUser.id, newXp, levelForXp(newXp, config));

  const verb = { add: 'Added', set: 'Set', remove: 'Removed', transfer: 'Transferred' }[action];
  const suffix = action === 'transfer' ? ` to ${destUser}` : '';
  await reply(interaction, `${EMOJI.APPROVE}  ${verb} **${amount} XP** for ${targetUser}${suffix}.`);
}

async function manageLevel(interaction) {
  const action = interaction.options.getString('action', true);
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const data = await levelUsersDb.ensureUser(interaction.guild.id, targetUser.id);

  let newLevel = data.level;
  if (action === 'add') newLevel = data.level + amount;
  else if (action === 'set') newLevel = amount;
  else if (action === 'remove') newLevel = Math.max(0, data.level - amount);

  const newXp = totalXpForLevel(newLevel, config);
  await levelUsersDb.setXpAndLevel(interaction.guild.id, targetUser.id, newXp, newLevel);

  const verb = { add: 'Added', set: 'Set', remove: 'Removed' }[action];
  await reply(interaction, `${EMOJI.APPROVE}  ${verb} level for ${targetUser} — now **level ${newLevel}**.`);
}
