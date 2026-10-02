// Leveling configuration, rewards, multipliers, and member progress commands.
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
const { getTemplate } = require('../../db/embedTemplates');
const { getVoiceConfig } = require('../../utils/levelSource');
const imageCardsDb = require('../../db/imageCards');
const xpEventsDb = require('../../db/xpEvents');
const { parseDuration, formatDuration } = require('../../utils/duration');

const ACTION_CHOICES = [
  { name: 'add', value: 'add' },
  { name: 'set', value: 'set' },
  { name: 'remove', value: 'remove' },
  { name: 'transfer', value: 'transfer' },
];

module.exports = {
  aliases: ['xp'],
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
    .addSubcommand((s) => s.setName('voice-enable').setDescription('Turn voice leveling on/off.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('voice-curve').setDescription('Tune the voice XP-per-level formula.').addNumberOption((o) => o.setName('a').setDescription('Cubic coefficient').setRequired(false)).addNumberOption((o) => o.setName('b').setDescription('Square coefficient').setRequired(false)).addNumberOption((o) => o.setName('c').setDescription('Linear coefficient').setRequired(false)).addNumberOption((o) => o.setName('difficulty').setDescription('Overall multiplier').setRequired(false)).addIntegerOption((o) => o.setName('rounding').setDescription('Round totals to nearest N').setRequired(false).setMinValue(0)))
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
    .addSubcommand((s) => s.setName('voice-max-level').setDescription('Voice leveling cap.').addIntegerOption((o) => o.setName('count').setDescription('Max voice level').setRequired(true).setMinValue(1)))
    .addSubcommand((s) =>
      s
        .setName('notify')
        .setDescription('Configure the level-up announcement.')
        .addStringOption((o) => o.setName('mode').setDescription('Where it posts').setRequired(true).addChoices({ name: 'off', value: 'off' }, { name: 'reply (in the channel they leveled up in)', value: 'reply' }, { name: 'fixed channel', value: 'channel' }, { name: 'DM', value: 'dm' }))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to use with mode:channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
        .addBooleanOption((o) => o.setName('embed').setDescription('Wrap the message in an embed instead of a plain Components V2 card').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Saved /embed template to use for the announcement').setRequired(false))
        .addIntegerOption((o) => o.setName('every').setDescription('Only announce every N levels (default 1 = every level)').setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName('card').setDescription('Image card sent with the announcement, or "none"').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Supports {user}, {level}, {level_xp}, {level_rank}, and every /embed variable').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('voice-notify').setDescription('Configure voice level-up announcements.').addStringOption((o) => o.setName('mode').setDescription('Where it posts').setRequired(true).addChoices({ name: 'off', value: 'off' }, { name: 'fixed channel', value: 'channel' }, { name: 'DM', value: 'dm' })).addChannelOption((o) => o.setName('channel').setDescription('Channel to use with mode:channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)).addBooleanOption((o) => o.setName('embed').setDescription('Use an embed').setRequired(false)).addStringOption((o) => o.setName('embed_template').setDescription('Saved /embed template').setRequired(false)).addIntegerOption((o) => o.setName('every').setDescription('Only announce every N levels').setRequired(false).setMinValue(1)).addStringOption((o) => o.setName('card').setDescription('Image card sent with the announcement, or "none"').setRequired(false)).addStringOption((o) => o.setName('message').setDescription('Voice level-up message').setRequired(false)))
    .addSubcommand((s) => s.setName('role-mode').setDescription('Whether members keep every earned reward role, or just the highest.').addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true).addChoices({ name: 'highest only', value: 'highest' }, { name: 'all earned', value: 'all' })))
    .addSubcommand((s) => s.setName('voice-role-mode').setDescription('Voice reward role mode.').addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true).addChoices({ name: 'highest only', value: 'highest' }, { name: 'all earned', value: 'all' })))
    .addSubcommand((s) => s.setName('ignore').setDescription('Toggle a channel out of/into XP tracking.').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('voice-ignore').setDescription('Toggle a voice channel out of/into voice XP tracking.').addChannelOption((o) => o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription('Starting bonus for new members (level takes priority over xp if both are set).')
        .addIntegerOption((o) => o.setName('xp').setDescription('Starting XP').setRequired(false).setMinValue(0))
        .addIntegerOption((o) => o.setName('level').setDescription('Starting level').setRequired(false).setMinValue(0)),
    )
    .addSubcommand((s) => s.setName('sync-join').setDescription('Apply the current join bonus to every member who has zero XP right now.'))
    .addSubcommand((s) => s.setName('reset').setDescription('Wipe a member\'s XP/level and remove their reward roles.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('rank-style').setDescription('How /rank answers: a card, an embed, or both.').addStringOption((o) => o.setName('style').setDescription('Card, embed or both').setRequired(true).addChoices({ name: 'card (image)', value: 'card' }, { name: 'embed', value: 'embed' }, { name: 'both', value: 'both' })).addStringOption((o) => o.setName('card').setDescription('Name of an image card for the rank, or "default"').setRequired(false)))
    .addSubcommand((s) =>
      s
        .setName('rules')
        .setDescription('Anti-abuse rules and the daily bonus. Run with no options to see the current values.')
        .addIntegerOption((o) => o.setName('min_chars').setDescription('Messages with fewer characters earn no XP (0 = off)').setRequired(false).setMinValue(0).setMaxValue(200))
        .addBooleanOption((o) => o.setName('anti_repeat').setDescription('The same text again within a minute earns no XP').setRequired(false))
        .addIntegerOption((o) => o.setName('voice_min_members').setDescription('People needed in the voice channel to earn XP').setRequired(false).setMinValue(1).setMaxValue(20))
        .addBooleanOption((o) => o.setName('voice_ignore_muted').setDescription('No voice XP while muted').setRequired(false))
        .addIntegerOption((o) => o.setName('daily_bonus').setDescription('Bonus XP for the first activity of each day').setRequired(false).setMinValue(0).setMaxValue(100000))
        .addIntegerOption((o) => o.setName('streak_bonus').setDescription('Extra XP for each earlier day in a row').setRequired(false).setMinValue(0).setMaxValue(10000))
        .addIntegerOption((o) => o.setName('streak_max_days').setDescription('Days in a row after which the streak bonus stops growing').setRequired(false).setMinValue(1).setMaxValue(365)),
    )
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
        .setName('event')
        .setDescription('Timed XP boosts, such as double XP for a weekend.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Start an XP event now, or later.')
            .addStringOption((o) => o.setName('name').setDescription('Name of the event').setRequired(true).setMaxLength(60))
            .addNumberOption((o) => o.setName('multiplier').setDescription('XP multiplier, e.g. 2 for double').setRequired(true).setMinValue(1.1).setMaxValue(20))
            .addStringOption((o) => o.setName('duration').setDescription('How long it lasts, e.g. 2h, 1d, 3d').setRequired(true))
            .addStringOption((o) => o.setName('applies_to').setDescription('What earns the boost (default: all)').setRequired(false).addChoices({ name: 'all XP', value: 'all' }, { name: 'messages only', value: 'text' }, { name: 'voice only', value: 'voice' }))
            .addStringOption((o) => o.setName('starts_in').setDescription('Start later, e.g. 1h or 2d (default: now)').setRequired(false)),
        )
        .addSubcommand((s) => s.setName('remove').setDescription('Cancel or delete an XP event.').addIntegerOption((o) => o.setName('id').setDescription('Id from the list').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('list').setDescription('XP events that are running or coming.')),
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
    if (group === 'event') return eventCmd(interaction, sub);

    switch (sub) {
      case 'enable':
        return enableCmd(interaction);
      case 'xp':
        return xpRangeCmd(interaction);
      case 'voice-xp':
        return voiceXpCmd(interaction);
      case 'voice-enable':
        return voiceEnableCmd(interaction);
      case 'voice-curve':
        return voiceCurveCmd(interaction);
      case 'cooldown':
        return cooldownCmd(interaction);
      case 'curve':
        return curveCmd(interaction);
      case 'max-level':
        return maxLevelCmd(interaction);
      case 'voice-max-level':
        return voiceMaxLevelCmd(interaction);
      case 'notify':
        return notifyCmd(interaction);
      case 'voice-notify':
        return voiceNotifyCmd(interaction);
      case 'role-mode':
        return roleModeCmd(interaction);
      case 'voice-role-mode':
        return voiceRoleModeCmd(interaction);
      case 'ignore':
        return ignoreCmd(interaction);
      case 'voice-ignore':
        return voiceIgnoreCmd(interaction);
      case 'join':
        return joinCmd(interaction);
      case 'sync-join':
        return syncJoinCmd(interaction);
      case 'reset':
        return resetCmd(interaction);
      case 'rank-style':
        return rankStyleCmd(interaction);
      case 'rules':
        return rulesCmd(interaction);
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
  await reply(interaction, `${EMOJI.APPROVE}  Leveling ${enabled ? 'enabled' : 'disabled'}.`, enabled ? 0xa5ea7a : 0x4b4f59);
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

async function voiceEnableCmd(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_enabled: enabled });
  await reply(interaction, `${EMOJI.APPROVE}  Voice leveling ${enabled ? 'enabled' : 'disabled'}.`, enabled ? 0xa5ea7a : 0x4b4f59);
}

async function voiceCurveCmd(interaction) {
  const patch = {};
  const a = interaction.options.getNumber('a');
  const b = interaction.options.getNumber('b');
  const c = interaction.options.getNumber('c');
  const difficulty = interaction.options.getNumber('difficulty');
  const rounding = interaction.options.getInteger('rounding');
  if (a != null) patch.voice_curve_a = a;
  if (b != null) patch.voice_curve_b = b;
  if (c != null) patch.voice_curve_c = c;
  if (difficulty != null) patch.voice_difficulty = difficulty;
  if (rounding != null) patch.voice_rounding = rounding;
  if (!Object.keys(patch).length) {
    await interaction.reply({ content: 'Provide at least one voice curve value.', flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  const saved = await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  const voiceConfig = getVoiceConfig(saved);
  const preview = [10, 25, 50].map((l) => `Lv.${l}: ${totalXpForLevel(l, voiceConfig).toLocaleString()} XP`).join(' • ');
  await reply(interaction, `${EMOJI.APPROVE}  Voice XP curve updated.\n${preview}`);
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

async function voiceMaxLevelCmd(interaction) {
  const count = interaction.options.getInteger('count', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_max_level: count });
  await reply(interaction, `${EMOJI.APPROVE}  Max voice level set to **${count}**.`);
}

async function notifyCmd(interaction) {
  const mode = interaction.options.getString('mode', true);
  const channel = interaction.options.getChannel('channel');
  const embed = interaction.options.getBoolean('embed');
  const embedTemplate = interaction.options.getString('embed_template');
  const every = interaction.options.getInteger('every');
  const message = interaction.options.getString('message');

  if (mode === 'channel' && !channel) {
    await interaction.reply({ content: 'Provide `channel` when `mode` is `channel`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = { notify_mode: mode };
  if (channel) patch.notify_channel_id = channel.id;
  if (embed != null) patch.notify_embed = embed;
  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate).catch(() => null);
    if (!template) {
      await interaction.reply({ content: `No saved embed template named \`${embedTemplate}\` was found.`, flags: MessageFlags.Ephemeral });
      return;
    }
    patch.notify_embed_template = embedTemplate;
  }
  if (every != null) patch.notify_every = every;
  if (message) patch.notify_message = message;
  const cardPatch = await cardOption(interaction, 'notify_card');
  if (cardPatch === false) return;
  Object.assign(patch, cardPatch);

  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, `${EMOJI.APPROVE}  Level-up notifications: **${mode}**.`);
}

async function voiceNotifyCmd(interaction) {
  const mode = interaction.options.getString('mode', true);
  const channel = interaction.options.getChannel('channel');
  const embed = interaction.options.getBoolean('embed');
  const embedTemplate = interaction.options.getString('embed_template');
  const every = interaction.options.getInteger('every');
  const message = interaction.options.getString('message');

  if (mode === 'channel' && !channel) {
    await interaction.reply({ content: 'Provide `channel` when `mode` is `channel`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = { voice_notify_mode: mode };
  if (channel) patch.voice_notify_channel_id = channel.id;
  if (embed != null) patch.voice_notify_embed = embed;
  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate).catch(() => null);
    if (!template) {
      await interaction.reply({ content: `No saved embed template named \`${embedTemplate}\` was found.`, flags: MessageFlags.Ephemeral });
      return;
    }
    patch.voice_notify_embed_template = embedTemplate;
  }
  if (every != null) patch.voice_notify_every = every;
  if (message) patch.voice_notify_message = message;
  const cardPatch = await cardOption(interaction, 'voice_notify_card');
  if (cardPatch === false) return;
  Object.assign(patch, cardPatch);

  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, `${EMOJI.APPROVE}  Voice level-up notifications: **${mode}**.`);
}

async function roleModeCmd(interaction) {
  const mode = interaction.options.getString('mode', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { role_mode: mode });
  await reply(interaction, `${EMOJI.APPROVE}  Reward role mode: **${mode === 'highest' ? 'highest earned only' : 'all earned'}**.`);
}

async function voiceRoleModeCmd(interaction) {
  const mode = interaction.options.getString('mode', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_role_mode: mode });
  await reply(interaction, `${EMOJI.APPROVE}  Voice reward role mode: **${mode === 'highest' ? 'highest earned only' : 'all earned'}**.`);
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

async function voiceIgnoreCmd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const ignored = new Set(config.voice_ignored_channel_ids ?? []);
  const wasIgnored = ignored.has(channel.id);
  wasIgnored ? ignored.delete(channel.id) : ignored.add(channel.id);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_ignored_channel_ids: [...ignored] });
  await reply(interaction, `${EMOJI.APPROVE}  ${channel} ${wasIgnored ? 'removed from' : 'added to'} ignored voice channels.`);
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

/** The `card` option of a command as a settings patch: nothing, a card that exists, or the card removed. False when the card does not exist and the person was told. */
async function cardOption(interaction, column) {
  const raw = interaction.options.getString('card');
  if (!raw) return {};
  if (/^(none|default|off)$/i.test(raw.trim())) return { [column]: null };
  const name = imageCardsDb.normalizeName(raw);
  const card = await imageCardsDb.getCard(interaction.guild.id, name).catch(() => null);
  if (!card) {
    await interaction.reply({ content: `No image card named \`${name}\` was found. Make one in the dashboard, under Image cards.`, flags: MessageFlags.Ephemeral });
    return false;
  }
  return { [column]: name };
}

async function rankStyleCmd(interaction) {
  const style = interaction.options.getString('style', true);
  const patch = { rank_style: style };
  const cardPatch = await cardOption(interaction, 'rank_card');
  if (cardPatch === false) return;
  Object.assign(patch, cardPatch);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  const config = await levelConfigDb.getConfig(interaction.guild.id);
  await reply(interaction, `${EMOJI.APPROVE}  /rank now answers with ${style === 'card' ? 'a **card**' : style === 'embed' ? 'an **embed**' : 'a **card and an embed**'}${config?.rank_card ? `, using the card \`${config.rank_card}\`` : ', using the default rank card'}.`);
}

async function rulesCmd(interaction) {
  const map = {
    min_chars: ['min_message_chars', 'getInteger'],
    anti_repeat: ['anti_repeat', 'getBoolean'],
    voice_min_members: ['voice_min_members', 'getInteger'],
    voice_ignore_muted: ['voice_ignore_muted', 'getBoolean'],
    daily_bonus: ['daily_bonus_xp', 'getInteger'],
    streak_bonus: ['streak_bonus_xp', 'getInteger'],
    streak_max_days: ['streak_max_days', 'getInteger'],
  };
  const patch = {};
  for (const [option, [column, getter]] of Object.entries(map)) {
    const value = interaction.options[getter](option);
    if (value != null) patch[column] = value;
  }
  await defer(interaction);
  const config = Object.keys(patch).length ? await levelConfigDb.upsertConfig(interaction.guild.id, patch) : await levelConfigDb.ensureConfig(interaction.guild.id);
  await reply(interaction, `${Object.keys(patch).length ? `${EMOJI.APPROVE}  Updated.\n\n` : ''}${rulesSummary(config)}`, Object.keys(patch).length ? 0xa5ea7a : 0x4b4f59);
}

function rulesSummary(config) {
  return [
    `**Minimum message length:** ${config.min_message_chars > 0 ? `${config.min_message_chars} characters` : 'off'}`,
    `**Ignore repeated text:** ${config.anti_repeat ? 'on' : 'off'}`,
    `**Voice needs:** ${config.voice_min_members} people in the channel${config.voice_ignore_muted ? ', not muted' : ''}`,
    `**Daily bonus:** ${config.daily_bonus_xp > 0 ? `${config.daily_bonus_xp} XP` : 'off'}`,
    `**Streak bonus:** ${config.streak_bonus_xp > 0 ? `${config.streak_bonus_xp} XP per earlier day, up to ${config.streak_max_days} days` : 'off'}`,
  ].join('\n');
}

async function eventCmd(interaction, sub) {
  await defer(interaction);
  const guildId = interaction.guild.id;

  if (sub === 'list') {
    const events = await xpEventsDb.listEvents(guildId, { force: true });
    const now = Date.now();
    const lines = events.map((event) => {
      const running = new Date(event.starts_at).getTime() <= now;
      const unix = Math.floor(new Date(running ? event.ends_at : event.starts_at).getTime() / 1000);
      return `**#${event.id}** ${event.name} · ×${Number(event.multiplier)} · ${event.source === 'all' ? 'all XP' : `${event.source} XP`} · ${running ? `ends <t:${unix}:R>` : `starts <t:${unix}:R>`}`;
    });
    await reply(interaction, lines.length ? lines.join('\n') : 'No XP events are running or coming.', 0x4b4f59);
    return;
  }

  if (sub === 'remove') {
    const removed = await xpEventsDb.removeEvent(guildId, interaction.options.getInteger('id', true));
    await reply(interaction, removed ? `${EMOJI.APPROVE}  XP event removed.` : 'No XP event with that id.', removed ? 0xa5ea7a : 0x4b4f59);
    return;
  }

  const duration = parseDuration(interaction.options.getString('duration', true));
  const startsInText = interaction.options.getString('starts_in');
  const delay = startsInText ? parseDuration(startsInText) : 0;
  if (!duration || duration < 60_000 || duration > 60 * 86_400_000 || (startsInText && delay == null)) {
    await reply(interaction, 'Give a duration between 1 minute and 60 days, such as `2h`, `1d` or `3d`. `starts_in` takes the same format.', 0xfe6465);
    return;
  }
  const startsAt = new Date(Date.now() + (delay ?? 0));
  const result = await xpEventsDb.addEvent(guildId, {
    name: interaction.options.getString('name', true),
    multiplier: interaction.options.getNumber('multiplier', true),
    source: interaction.options.getString('applies_to') ?? 'all',
    startsAt,
    endsAt: new Date(startsAt.getTime() + duration),
  }, interaction.user.id);
  if (!result.ok) {
    await reply(interaction, `A server can have ${result.limit} XP events at a time. Remove one first.`, 0xfe6465);
    return;
  }
  const event = result.event;
  await reply(interaction, `${EMOJI.APPROVE}  **${event.name}** (#${event.id}): ×${Number(event.multiplier)} ${event.source === 'all' ? 'XP' : `${event.source} XP`} for ${formatDuration(duration)}, ${delay ? `starting <t:${Math.floor(startsAt.getTime() / 1000)}:R>` : 'starting now'}.`);
}

async function statusCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const rewards = await levelRewardsDb.listRewards(interaction.guild.id);
  const multipliers = await levelMultipliersDb.listMultipliers(interaction.guild.id);

  const lines = [
    `**Enabled:** ${config.enabled ? `${EMOJI.APPROVE} Yes` : `${EMOJI.DENY} No`}`,
    `**Message XP:** ${config.xp_min}-${config.xp_max} every ${config.cooldown_seconds}s`,
    `**Voice leveling:** ${config.voice_enabled === false ? `${EMOJI.DENY} Disabled` : `${EMOJI.APPROVE} Enabled`} · ${config.xp_per_vc_minute}/min`,
    `**Voice curve:** a=${config.voice_curve_a ?? config.curve_a} b=${config.voice_curve_b ?? config.curve_b} c=${config.voice_curve_c ?? config.curve_c} difficulty=${config.voice_difficulty ?? config.difficulty} rounding=${config.voice_rounding ?? config.rounding}`,
    `**Voice max level:** ${config.voice_max_level ?? config.max_level}`,
    `**Curve:** a=${config.curve_a} b=${config.curve_b} c=${config.curve_c} difficulty=${config.difficulty} rounding=${config.rounding}`,
    `**Max level:** ${config.max_level}`,
    `**Role mode:** ${config.role_mode}`,
    `**Notify:** ${config.notify_mode}${config.notify_channel_id ? ` (<#${config.notify_channel_id}>)` : ''}${config.notify_every > 1 ? `, every ${config.notify_every} levels` : ''}`,
    `**Rank:** ${config.rank_style ?? 'card'}${config.rank_card ? ` (card \`${config.rank_card}\`)` : ''}${config.notify_card ? ` · level-up card \`${config.notify_card}\`` : ''}`,
    rulesSummary(config),
    `**Join bonus:** ${config.join_level ? `level ${config.join_level}` : config.join_xp ? `${config.join_xp} XP` : 'None'}`,
    `**Ignored channels:** ${config.ignored_channel_ids.length ? config.ignored_channel_ids.map((id) => `<#${id}>`).join(', ') : 'None'}`,
    `**Ignored voice channels:** ${(config.voice_ignored_channel_ids ?? []).length ? config.voice_ignored_channel_ids.map((id) => `<#${id}>`).join(', ') : 'None'}`,
    `**Rewards:** ${rewards.length ? rewards.map((r) => `Lv.${r.level} → <@&${r.role_id}>`).join(', ') : 'None'}`,
    `**Multipliers:** ${multipliers.length ? multipliers.map((m) => `${m.target_type === 'role' ? `<@&${m.target_id}>` : `<#${m.target_id}>`} ×${m.multiplier}`).join(', ') : 'None'}`,
  ];

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function rewardCmd(interaction, sub) {
  await defer(interaction);

  if (sub === 'list') {
    const rewards = await levelRewardsDb.listRewards(interaction.guild.id);
    const text = rewards.length ? rewards.map((r) => `**Level ${r.level}** → <@&${r.role_id}>`).join('\n') : 'No level rewards configured.';
    await reply(interaction, text, 0x4b4f59);
    return;
  }

  const level = interaction.options.getInteger('level', true);

  if (sub === 'remove') {
    const removed = await levelRewardsDb.removeReward(interaction.guild.id, level);
    await reply(interaction, removed ? `${EMOJI.APPROVE}  Removed the level ${level} reward.` : `No reward configured for level ${level}.`, removed ? 0xa5ea7a : 0x4b4f59);
    return;
  }

  const role = interaction.options.getRole('role', true);
  await levelRewardsDb.setReward(interaction.guild.id, level, role.id);
  await reply(interaction, `${EMOJI.APPROVE}  Members will now get ${role} at level **${level}**.`);
}

async function multiplierCmd(interaction, sub) {
  await defer(interaction);

  if (sub === 'list') {
    const multipliers = await levelMultipliersDb.listMultipliers(interaction.guild.id);
    const text = multipliers.length ? multipliers.map((m) => `${m.target_type === 'role' ? `<@&${m.target_id}>` : `<#${m.target_id}>`} → ×${m.multiplier}`).join('\n') : 'No multipliers configured.';
    await reply(interaction, text, 0x4b4f59);
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
    await reply(interaction, removed ? `${EMOJI.APPROVE}  Removed the multiplier for ${targetMention}.` : `No multiplier configured for ${targetMention}.`, removed ? 0xa5ea7a : 0x4b4f59);
    return;
  }

  const value = interaction.options.getNumber('value', true);
  await levelMultipliersDb.setMultiplier(interaction.guild.id, targetId, targetType, value);
  await reply(interaction, `${EMOJI.APPROVE}  ${targetMention} now gives **×${value}** XP.`);
}

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
