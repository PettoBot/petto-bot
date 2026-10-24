// Leveling configuration, rewards, multipliers, and member progress commands.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const levelConfigDb = require('../../db/levelConfig');
const levelUsersDb = require('../../db/levelUsers');
const levelRewardsDb = require('../../db/levelRewards');
const levelMultipliersDb = require('../../db/levelMultipliers');
const { stripRewardRoles, syncRewardRoles } = require('../../utils/levelActions');
const { totalXpForLevel, levelForXp } = require('../../utils/levelCurve');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { getTemplate } = require('../../db/embedTemplates');
const { getVoiceConfig } = require('../../utils/levelSource');
const imageCardsDb = require('../../db/imageCards');
const xpEventsDb = require('../../db/xpEvents');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { t, tn, formatNumber, languageOf } = require('../../i18n');

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
    .addSubcommand((s) => s.setName('max-level').setDescription('Set the highest level members can reach, or 0 for no limit.').addIntegerOption((o) => o.setName('count').setDescription('Max level').setRequired(true).setMinValue(1)))
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
        .addStringOption((o) => o.setName('message').setDescription('Supports {user}, {level}, {level_xp}, {level_rank}, and every /embed variable').setRequired(false))
        .addStringOption((o) => o.setName('card').setDescription('Image card sent with the announcement, or "none"').setRequired(false))
        .addBooleanOption((o) => o.setName('reply').setDescription('Answer the message that made them level up (default on)').setRequired(false))
        .addIntegerOption((o) => o.setName('delete_after').setDescription('Delete the announcement after this many seconds, 0 to keep it').setRequired(false).setMinValue(0).setMaxValue(86400))
        .addBooleanOption((o) => o.setName('ping').setDescription('Ping the member (default on)').setRequired(false))
        .addIntegerOption((o) => o.setName('milestone').setDescription('A level with a message of its own: use it with message (message off removes it)').setRequired(false).setMinValue(1).setMaxValue(10000)),
    )
    .addSubcommand((s) => s.setName('voice-notify').setDescription('Configure voice level-up announcements.').addStringOption((o) => o.setName('mode').setDescription('Where it posts').setRequired(true).addChoices({ name: 'off', value: 'off' }, { name: 'reply (in the voice channel chat)', value: 'reply' }, { name: 'fixed channel', value: 'channel' }, { name: 'DM', value: 'dm' })).addChannelOption((o) => o.setName('channel').setDescription('Channel to use with mode:channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)).addBooleanOption((o) => o.setName('embed').setDescription('Use an embed').setRequired(false)).addStringOption((o) => o.setName('embed_template').setDescription('Saved /embed template').setRequired(false)).addIntegerOption((o) => o.setName('every').setDescription('Only announce every N levels').setRequired(false).setMinValue(1)).addStringOption((o) => o.setName('message').setDescription('Voice level-up message').setRequired(false)).addStringOption((o) => o.setName('card').setDescription('Image card sent with the announcement, or "none"').setRequired(false)).addIntegerOption((o) => o.setName('delete_after').setDescription('Delete the announcement after this many seconds, 0 to keep it').setRequired(false).setMinValue(0).setMaxValue(86400)).addBooleanOption((o) => o.setName('ping').setDescription('Ping the member (default on)').setRequired(false)).addIntegerOption((o) => o.setName('milestone').setDescription('A level with a message of its own: use it with message (message off removes it)').setRequired(false).setMinValue(1).setMaxValue(10000)))
    .addSubcommand((s) => s.setName('role-mode').setDescription('Whether members keep every earned reward role, or just the highest.').addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true).addChoices({ name: 'highest only', value: 'highest' }, { name: 'all earned', value: 'all' })))
    .addSubcommand((s) => s.setName('voice-role-mode').setDescription('Voice reward role mode.').addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true).addChoices({ name: 'highest only', value: 'highest' }, { name: 'all earned', value: 'all' })))
    .addSubcommand((s) => s.setName('ignore').setDescription('Toggle a channel, a category or a role out of/into earning XP.').addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(false)).addRoleOption((o) => o.setName('role').setDescription('A role whose members earn no XP').setRequired(false)).addRoleOption((o) => o.setName('only_role').setDescription('A role that is the only one allowed to earn XP (toggle; none picked = everyone)').setRequired(false)))
    .addSubcommand((s) => s.setName('voice-ignore').setDescription('Toggle a voice channel or a category out of/into voice XP tracking.').addChannelOption((o) => o.setName('channel').setDescription('Voice channel or category').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription('Starting bonus for new members (level takes priority over xp if both are set).')
        .addIntegerOption((o) => o.setName('xp').setDescription('Starting XP').setRequired(false).setMinValue(0))
        .addIntegerOption((o) => o.setName('level').setDescription('Starting level').setRequired(false).setMinValue(0)),
    )
    .addSubcommand((s) => s.setName('sync-join').setDescription('Apply the current join bonus to every member who has zero XP right now.'))
    .addSubcommand((s) => s.setName('reset').setDescription('Wipe a member\'s XP/level and remove their reward roles.').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('rank-style').setDescription('How the rank command answers: a card, an embed, or both.').addStringOption((o) => o.setName('style').setDescription('Card, embed or both').setRequired(true).addChoices({ name: 'card (image)', value: 'card' }, { name: 'embed', value: 'embed' }, { name: 'both', value: 'both' })).addStringOption((o) => o.setName('card').setDescription('Name of an image card for the rank, or "default"').setRequired(false)))
    .addSubcommand(
      (s) => s
        .setName('rules')
        .setDescription('Anti-abuse rules and the daily bonus. With no options it shows the current values.')
        .addStringOption((o) => o.setName('setting').setDescription('Which rule to change').setRequired(false).addChoices(
          { name: 'min_chars (messages shorter than this earn no XP, 0 = off)', value: 'min_chars' },
          { name: 'anti_repeat (the same text within a minute earns no XP)', value: 'anti_repeat' },
          { name: 'voice_min_members (people needed in the voice channel)', value: 'voice_min_members' },
          { name: 'voice_ignore_muted (no voice XP while muted)', value: 'voice_ignore_muted' },
          { name: 'voice_alone_percent (the share of voice XP earned while alone, 0 to 100)', value: 'voice_alone_percent' },
          { name: 'daily_xp_cap (the most XP from messages a member earns in a day, 0 = no limit)', value: 'daily_xp_cap' },
          { name: 'daily_bonus (XP for the first activity of each day)', value: 'daily_bonus' },
          { name: 'streak_bonus (extra XP per earlier day in a row)', value: 'streak_bonus' },
          { name: 'streak_max_days (days after which the streak bonus stops growing)', value: 'streak_max_days' },
          { name: 'xp_multiplier (a base multiplier for all XP, e.g. 1.5)', value: 'xp_multiplier' },
          { name: 'reset_on_leave (wipe the XP and level of a member who leaves)', value: 'reset_on_leave' },
          { name: 'restore_roles (give the reward roles back to a member who returns)', value: 'restore_roles' },
          { name: 'multiplier_mode (how several role multipliers join: highest, stack or sum)', value: 'multiplier_mode' },
          { name: 'multiplier_cap (the most a combined multiplier can reach)', value: 'multiplier_cap' },
        ))
        .addStringOption((o) => o.setName('value').setDescription('The new value: a number, or on/off').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the full current configuration.'))

    .addSubcommandGroup((g) =>
      g
        .setName('reward')
        .setDescription('Roles granted at specific levels.')
        .addSubcommand((s) => s.setName('add').setDescription('Grant a role at a level.').addStringOption((o) => o.setName('type').setDescription('Message levels (default) or voice levels').setRequired(false).addChoices({ name: 'messages', value: 'text' }, { name: 'voice', value: 'voice' })).addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a level reward.').addStringOption((o) => o.setName('type').setDescription('Message levels (default) or voice levels').setRequired(false).addChoices({ name: 'messages', value: 'text' }, { name: 'voice', value: 'voice' })).addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1)))
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
            .addRoleOption((o) => o.setName('role').setDescription('Role (provide this, a channel or a category)').setRequired(false))
            .addChannelOption((o) => o.setName('channel').setDescription('Channel (provide this, a role or a category)').setRequired(false))
            .addChannelOption((o) => o.setName('category').setDescription('Category: every channel in it, unless it has a multiplier of its own').addChannelTypes(ChannelType.GuildCategory).setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a multiplier.')
            .addRoleOption((o) => o.setName('role').setDescription('Role (provide this, a channel or a category)').setRequired(false))
            .addChannelOption((o) => o.setName('channel').setDescription('Channel (provide this, a role or a category)').setRequired(false))
            .addChannelOption((o) => o.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory).setRequired(false)),
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
        )
        .addSubcommand((s) => s.setName('sync').setDescription('Give every member the reward roles their levels have earned, for example after adding rewards.')),
    ),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'reward') return rewardCmd(interaction, sub, lang);
    if (group === 'multiplier') return multiplierCmd(interaction, sub, lang);
    if (group === 'manage') return manageCmd(interaction, sub, lang);
    if (group === 'event') return eventCmd(interaction, sub, lang);

    switch (sub) {
      case 'enable':
        return enableCmd(interaction, lang);
      case 'xp':
        return xpRangeCmd(interaction, lang);
      case 'voice-xp':
        return voiceXpCmd(interaction, lang);
      case 'voice-enable':
        return voiceEnableCmd(interaction, lang);
      case 'voice-curve':
        return voiceCurveCmd(interaction, lang);
      case 'cooldown':
        return cooldownCmd(interaction, lang);
      case 'curve':
        return curveCmd(interaction, lang);
      case 'max-level':
        return maxLevelCmd(interaction, lang);
      case 'voice-max-level':
        return voiceMaxLevelCmd(interaction, lang);
      case 'notify':
        return notifyCmd(interaction, lang);
      case 'voice-notify':
        return voiceNotifyCmd(interaction, lang);
      case 'role-mode':
        return roleModeCmd(interaction, lang);
      case 'voice-role-mode':
        return voiceRoleModeCmd(interaction, lang);
      case 'ignore':
        return ignoreCmd(interaction, lang);
      case 'voice-ignore':
        return voiceIgnoreCmd(interaction, lang);
      case 'join':
        return joinCmd(interaction, lang);
      case 'sync-join':
        return syncJoinCmd(interaction, lang);
      case 'reset':
        return resetCmd(interaction, lang);
      case 'rank-style':
        return rankStyleCmd(interaction, lang);
      case 'rules':
        return rulesCmd(interaction, lang);
      default:
        return statusCmd(interaction, lang);
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

async function enableCmd(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { enabled });
  await reply(interaction, t(lang, enabled ? 'leveling.enable.on' : 'leveling.enable.off', { emoji: EMOJI.APPROVE }), enabled ? 0xa5ea7a : 0x4b4f59);
}

async function xpRangeCmd(interaction, lang) {
  const min = interaction.options.getInteger('min', true);
  const max = interaction.options.getInteger('max', true);
  if (min > max) {
    await interaction.reply({ content: t(lang, 'leveling.xp.minAboveMax'), flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { xp_min: min, xp_max: max });
  await reply(interaction, t(lang, 'leveling.xp.done', { emoji: EMOJI.APPROVE, min, max }));
}

async function voiceXpCmd(interaction, lang) {
  const amount = interaction.options.getInteger('amount', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { xp_per_vc_minute: amount });
  await reply(interaction, t(lang, 'leveling.voiceXp.done', { emoji: EMOJI.APPROVE, amount }));
}

async function voiceEnableCmd(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_enabled: enabled });
  await reply(interaction, t(lang, enabled ? 'leveling.voiceEnable.on' : 'leveling.voiceEnable.off', { emoji: EMOJI.APPROVE }), enabled ? 0xa5ea7a : 0x4b4f59);
}

/** `Lv.10: 1,234 XP` for the levels a curve command previews, joined by `separator`. */
function curvePreview(config, separator, lang) {
  return [10, 25, 50].map((level) => t(lang, 'leveling.curve.previewItem', { level, xp: formatNumber(lang, totalXpForLevel(level, config)) })).join(separator);
}

async function voiceCurveCmd(interaction, lang) {
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
    await interaction.reply({ content: t(lang, 'leveling.voiceCurve.missing'), flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  const saved = await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  const voiceConfig = getVoiceConfig(saved);
  await reply(interaction, t(lang, 'leveling.voiceCurve.done', { emoji: EMOJI.APPROVE, preview: curvePreview(voiceConfig, ' • ', lang) }));
}

async function cooldownCmd(interaction, lang) {
  const seconds = interaction.options.getInteger('seconds', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { cooldown_seconds: seconds });
  await reply(interaction, t(lang, 'leveling.cooldown.done', { emoji: EMOJI.APPROVE, seconds }));
}

async function curveCmd(interaction, lang) {
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
    await interaction.reply({ content: t(lang, 'leveling.curve.missing'), flags: MessageFlags.Ephemeral });
    return;
  }

  await defer(interaction);
  const saved = await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, t(lang, 'leveling.curve.done', { emoji: EMOJI.APPROVE, preview: curvePreview(saved, ' · ', lang) }));
}

async function maxLevelCmd(interaction, lang) {
  const count = interaction.options.getInteger('count', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { max_level: count });
  await reply(interaction, t(lang, 'leveling.maxLevel.done', { emoji: EMOJI.APPROVE, count }));
}

async function voiceMaxLevelCmd(interaction, lang) {
  const count = interaction.options.getInteger('count', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_max_level: count });
  await reply(interaction, t(lang, 'leveling.voiceMaxLevel.done', { emoji: EMOJI.APPROVE, count }));
}

/** The patch for the new announcement options (reply, delete_after, ping and a milestone message). `prefix` is `` or `voice_`. */
async function notifyExtras(interaction, config, prefix, lang) {
  const patch = {};
  const reply = prefix ? null : interaction.options.getBoolean('reply');
  const deleteAfter = interaction.options.getInteger('delete_after');
  const ping = interaction.options.getBoolean('ping');
  const milestone = interaction.options.getInteger('milestone');
  const message = interaction.options.getString('message');
  if (reply != null) patch.notify_reply = reply;
  if (deleteAfter != null) patch[`${prefix}notify_delete_after`] = deleteAfter;
  if (ping != null) patch[`${prefix}notify_ping`] = ping;
  if (milestone != null) {
    if (!message) return { error: t(lang, 'leveling.notify.milestoneNeedsMessage') };
    const current = (Array.isArray(config?.[`${prefix}notify_milestones`]) ? config[`${prefix}notify_milestones`] : []).filter((entry) => Number(entry.level) !== milestone);
    if (message.trim().toLowerCase() !== 'off') {
      if (current.length >= 25) return { error: t(lang, 'leveling.notify.milestoneLimit') };
      current.push({ level: milestone, message: message.slice(0, 1000) });
    }
    patch[`${prefix}notify_milestones`] = current.sort((a, b) => a.level - b.level);
    patch.__milestone = { level: milestone, removed: message.trim().toLowerCase() === 'off' };
  }
  return patch;
}

/** What a notify command answers: the mode, and what changed for a milestone level. `scope` is `notify` or `voiceNotify`. */
function notifyDone(scope, mode, milestoneNote, lang) {
  const vars = { emoji: EMOJI.APPROVE, mode, level: milestoneNote?.level };
  if (!milestoneNote) return t(lang, `leveling.${scope}.done`, vars);
  return t(lang, milestoneNote.removed ? `leveling.${scope}.doneMilestoneGeneral` : `leveling.${scope}.doneMilestoneOwn`, vars);
}

async function notifyCmd(interaction, lang) {
  const mode = interaction.options.getString('mode', true);
  const channel = interaction.options.getChannel('channel');
  const embed = interaction.options.getBoolean('embed');
  const embedTemplate = interaction.options.getString('embed_template');
  const every = interaction.options.getInteger('every');
  const message = interaction.options.getString('message');

  if (mode === 'channel' && !channel) {
    await interaction.reply({ content: t(lang, 'leveling.notify.needsChannel'), flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = { notify_mode: mode };
  if (channel) patch.notify_channel_id = channel.id;
  if (embed != null) patch.notify_embed = embed;
  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate).catch(() => null);
    if (!template) {
      await interaction.reply({ content: t(lang, 'leveling.notify.noTemplate', { name: embedTemplate }), flags: MessageFlags.Ephemeral });
      return;
    }
    patch.notify_embed_template = embedTemplate;
  }
  if (every != null) patch.notify_every = every;
  // With `milestone`, the message is the one of that level and not the general one.
  if (message && interaction.options.getInteger('milestone') == null) patch.notify_message = message;
  const cardPatch = await cardOption(interaction, 'notify_card', lang);
  if (cardPatch === false) return;
  Object.assign(patch, cardPatch);
  const extras = await notifyExtras(interaction, await levelConfigDb.ensureConfig(interaction.guild.id), '', lang);
  if (extras.error) { await interaction.reply({ content: extras.error, flags: MessageFlags.Ephemeral }); return; }
  const { __milestone: milestoneNote, ...extraPatch } = extras;
  Object.assign(patch, extraPatch);

  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, notifyDone('notify', mode, milestoneNote, lang));
}

async function voiceNotifyCmd(interaction, lang) {
  const mode = interaction.options.getString('mode', true);
  const channel = interaction.options.getChannel('channel');
  const embed = interaction.options.getBoolean('embed');
  const embedTemplate = interaction.options.getString('embed_template');
  const every = interaction.options.getInteger('every');
  const message = interaction.options.getString('message');

  if (mode === 'channel' && !channel) {
    await interaction.reply({ content: t(lang, 'leveling.notify.needsChannel'), flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = { voice_notify_mode: mode };
  if (channel) patch.voice_notify_channel_id = channel.id;
  if (embed != null) patch.voice_notify_embed = embed;
  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate).catch(() => null);
    if (!template) {
      await interaction.reply({ content: t(lang, 'leveling.notify.noTemplate', { name: embedTemplate }), flags: MessageFlags.Ephemeral });
      return;
    }
    patch.voice_notify_embed_template = embedTemplate;
  }
  if (every != null) patch.voice_notify_every = every;
  if (message && interaction.options.getInteger('milestone') == null) patch.voice_notify_message = message;
  const cardPatch = await cardOption(interaction, 'voice_notify_card', lang);
  if (cardPatch === false) return;
  Object.assign(patch, cardPatch);
  const extras = await notifyExtras(interaction, await levelConfigDb.ensureConfig(interaction.guild.id), 'voice_', lang);
  if (extras.error) { await interaction.reply({ content: extras.error, flags: MessageFlags.Ephemeral }); return; }
  const { __milestone: milestoneNote, ...extraPatch } = extras;
  Object.assign(patch, extraPatch);

  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, notifyDone('voiceNotify', mode, milestoneNote, lang));
}

async function roleModeCmd(interaction, lang) {
  const mode = interaction.options.getString('mode', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { role_mode: mode });
  await reply(interaction, t(lang, mode === 'highest' ? 'leveling.roleMode.highest' : 'leveling.roleMode.all', { emoji: EMOJI.APPROVE }));
}

async function voiceRoleModeCmd(interaction, lang) {
  const mode = interaction.options.getString('mode', true);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, { voice_role_mode: mode });
  await reply(interaction, t(lang, mode === 'highest' ? 'leveling.voiceRoleMode.highest' : 'leveling.voiceRoleMode.all', { emoji: EMOJI.APPROVE }));
}

async function ignoreCmd(interaction, lang) {
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  const onlyRole = interaction.options.getRole('only_role');
  if (!channel && !role && !onlyRole) {
    await interaction.reply({ content: t(lang, 'leveling.ignore.pick'), flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const toggle = (list, id) => { const set = new Set(list ?? []); const had = set.has(id); had ? set.delete(id) : set.add(id); return { list: [...set], had }; };
  const notes = [];
  const patch = {};
  if (channel) {
    const isCategory = channel.type === ChannelType.GuildCategory;
    const column = isCategory ? 'ignored_category_ids' : 'ignored_channel_ids';
    const { list, had } = toggle(config[column], channel.id);
    patch[column] = list;
    notes.push(t(lang, `leveling.ignore.${isCategory ? 'category' : 'channel'}${had ? 'Removed' : 'Added'}`, { channel: `${channel}` }));
  }
  if (role) {
    const { list, had } = toggle(config.no_xp_role_ids, role.id);
    patch.no_xp_role_ids = list;
    notes.push(t(lang, had ? 'leveling.ignore.roleRemoved' : 'leveling.ignore.roleAdded', { role: `${role}` }));
  }
  if (onlyRole) {
    const { list, had } = toggle(config.only_xp_role_ids, onlyRole.id);
    patch.only_xp_role_ids = list;
    // Adding a role always leaves one picked, so "nobody is picked" can only follow a removal.
    const key = had ? (list.length ? 'leveling.ignore.onlyRoleRemoved' : 'leveling.ignore.onlyRoleRemovedEveryone') : 'leveling.ignore.onlyRoleAdded';
    notes.push(t(lang, key, { role: `${onlyRole}` }));
  }
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, `${EMOJI.APPROVE}  ${notes.join('\n')}`);
}

async function voiceIgnoreCmd(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const isCategory = channel.type === ChannelType.GuildCategory;
  const column = isCategory ? 'voice_ignored_category_ids' : 'voice_ignored_channel_ids';
  const ignored = new Set(config[column] ?? []);
  const wasIgnored = ignored.has(channel.id);
  wasIgnored ? ignored.delete(channel.id) : ignored.add(channel.id);
  await levelConfigDb.upsertConfig(interaction.guild.id, { [column]: [...ignored] });
  await reply(interaction, t(lang, `leveling.voiceIgnore.${isCategory ? 'category' : 'channel'}${wasIgnored ? 'Removed' : 'Added'}`, { emoji: EMOJI.APPROVE, channel: `${channel}` }));
}

async function joinCmd(interaction, lang) {
  const xp = interaction.options.getInteger('xp');
  const level = interaction.options.getInteger('level');
  if (xp == null && level == null) {
    await interaction.reply({ content: t(lang, 'leveling.join.missing'), flags: MessageFlags.Ephemeral });
    return;
  }
  await defer(interaction);
  const patch = {};
  if (xp != null) patch.join_xp = xp;
  if (level != null) patch.join_level = level;
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  await reply(interaction, level ? t(lang, 'leveling.join.level', { emoji: EMOJI.APPROVE, level }) : t(lang, 'leveling.join.xp', { emoji: EMOJI.APPROVE, xp }));
}

async function syncJoinCmd(interaction, lang) {
  await defer(interaction);
  const config = await levelConfigDb.getConfig(interaction.guild.id);

  if (!config.join_xp && !config.join_level) {
    await reply(interaction, t(lang, 'leveling.syncJoin.noBonus', { emoji: EMOJI.ALERT }), 0xfe6465);
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

  await reply(interaction, tn(lang, 'leveling.syncJoin.done', affected, { emoji: EMOJI.APPROVE, count: affected }));
}

async function resetCmd(interaction, lang) {
  const targetUser = interaction.options.getUser('user', true);
  await defer(interaction);

  await levelUsersDb.resetUser(interaction.guild.id, targetUser.id);

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember) await stripRewardRoles(interaction.guild, targetMember);

  await reply(interaction, t(lang, 'leveling.reset.done', { emoji: EMOJI.APPROVE, user: `${targetUser}` }));
}

/** The `card` option of a command as a settings patch: nothing, a card that exists, or the card removed. False when the card does not exist and the person was told. */
async function cardOption(interaction, column, lang) {
  const raw = interaction.options.getString('card');
  if (!raw) return {};
  if (/^(none|default|off)$/i.test(raw.trim())) return { [column]: null };
  const name = imageCardsDb.normalizeName(raw);
  const card = await imageCardsDb.getCard(interaction.guild.id, name).catch(() => null);
  if (!card) {
    await interaction.reply({ content: t(lang, 'leveling.card.notFound', { name }), flags: MessageFlags.Ephemeral });
    return false;
  }
  return { [column]: name };
}

async function rankStyleCmd(interaction, lang) {
  const style = interaction.options.getString('style', true);
  const patch = { rank_style: style };
  const cardPatch = await cardOption(interaction, 'rank_card', lang);
  if (cardPatch === false) return;
  Object.assign(patch, cardPatch);
  await defer(interaction);
  await levelConfigDb.upsertConfig(interaction.guild.id, patch);
  const config = await levelConfigDb.getConfig(interaction.guild.id);
  const kind = style === 'card' ? 'card' : style === 'embed' ? 'embed' : 'both';
  await reply(interaction, t(lang, `leveling.rankStyle.${kind}${config?.rank_card ? 'Named' : ''}`, { emoji: EMOJI.APPROVE, card: config?.rank_card }));
}

// The rules a person can change with `/level rules setting value`, with the column, the kind of value and its range.
const RULE_SETTINGS = {
  min_chars: { column: 'min_message_chars', kind: 'number', min: 0, max: 200 },
  anti_repeat: { column: 'anti_repeat', kind: 'flag' },
  voice_min_members: { column: 'voice_min_members', kind: 'number', min: 1, max: 20 },
  voice_ignore_muted: { column: 'voice_ignore_muted', kind: 'flag' },
  voice_alone_percent: { column: 'voice_alone_percent', kind: 'number', min: 0, max: 100 },
  daily_xp_cap: { column: 'daily_xp_cap', kind: 'number', min: 0, max: 1000000 },
  daily_bonus: { column: 'daily_bonus_xp', kind: 'number', min: 0, max: 100000 },
  streak_bonus: { column: 'streak_bonus_xp', kind: 'number', min: 0, max: 10000 },
  streak_max_days: { column: 'streak_max_days', kind: 'number', min: 1, max: 365 },
  xp_multiplier: { column: 'xp_multiplier', kind: 'decimal', min: 0, max: 20 },
  reset_on_leave: { column: 'reset_on_leave', kind: 'flag' },
  restore_roles: { column: 'restore_roles', kind: 'flag' },
  multiplier_mode: { column: 'multiplier_mode', kind: 'choice', choices: ['highest', 'stack', 'sum'] },
  multiplier_cap: { column: 'multiplier_cap', kind: 'decimal', min: 1, max: 100 },
};

/** The value of a rule from what was typed: a whole number in its range, or on/off. Null when it is not valid. */
function readRuleValue(rule, text) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (rule.kind === 'flag') {
    if (/^(on|true|yes|1|enable|enabled)$/.test(raw)) return true;
    if (/^(off|false|no|0|disable|disabled)$/.test(raw)) return false;
    return null;
  }
  if (rule.kind === 'choice') return rule.choices.includes(raw) ? raw : null;
  if (rule.kind === 'decimal') {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return null;
    const decimal = Number(raw);
    return decimal >= rule.min && decimal <= rule.max ? decimal : null;
  }
  if (!/^\d{1,6}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= rule.min && value <= rule.max ? value : null;
}

/** What a rule accepts, for the answer to a value that is not valid. */
function ruleValueHelp(setting, rule, lang) {
  if (rule.kind === 'flag') return t(lang, 'leveling.rules.takesFlag', { setting });
  if (rule.kind === 'choice') return t(lang, 'leveling.rules.takesChoice', { setting, list: rule.choices.map((name) => `\`${name}\``).join(', ') });
  if (rule.kind === 'decimal') return t(lang, 'leveling.rules.takesDecimal', { setting, min: rule.min, max: rule.max });
  return t(lang, 'leveling.rules.takesWhole', { setting, min: rule.min, max: rule.max });
}

async function rulesCmd(interaction, lang) {
  const setting = interaction.options.getString('setting');
  const text = interaction.options.getString('value');
  let patch = null;
  if (setting) {
    const rule = RULE_SETTINGS[setting];
    if (!rule) {
      await interaction.reply({ content: t(lang, 'leveling.rules.unknown', { setting, list: Object.keys(RULE_SETTINGS).map((name) => `\`${name}\``).join(', ') }), flags: MessageFlags.Ephemeral });
      return;
    }
    const value = readRuleValue(rule, text);
    if (value === null) {
      await interaction.reply({ content: ruleValueHelp(setting, rule, lang), flags: MessageFlags.Ephemeral });
      return;
    }
    patch = { [rule.column]: value };
  }
  await defer(interaction);
  const config = patch ? await levelConfigDb.upsertConfig(interaction.guild.id, patch) : await levelConfigDb.ensureConfig(interaction.guild.id);
  const summary = rulesSummary(config, lang);
  await reply(interaction, patch ? t(lang, 'leveling.rules.updated', { emoji: EMOJI.APPROVE, summary }) : summary, patch ? 0xa5ea7a : 0x4b4f59);
}

function rulesSummary(config, lang) {
  const keepRoles = config.restore_roles !== false;
  return [
    config.min_message_chars > 0 ? tn(lang, 'leveling.rules.minLength', config.min_message_chars, { count: config.min_message_chars }) : t(lang, 'leveling.rules.minLengthOff'),
    t(lang, config.anti_repeat ? 'leveling.rules.antiRepeatOn' : 'leveling.rules.antiRepeatOff'),
    tn(lang, config.voice_ignore_muted ? 'leveling.rules.voiceNeedsUnmuted' : 'leveling.rules.voiceNeeds', config.voice_min_members, { count: config.voice_min_members }),
    ...(Number(config.voice_min_members) <= 1 && Number(config.voice_alone_percent ?? 100) < 100 ? [t(lang, 'leveling.rules.voiceAlone', { percent: Number(config.voice_alone_percent) })] : []),
    Number(config.daily_xp_cap) > 0 ? t(lang, 'leveling.rules.dailyCapOn', { xp: Number(config.daily_xp_cap) }) : t(lang, 'leveling.rules.dailyCapOff'),
    config.daily_bonus_xp > 0 ? t(lang, 'leveling.rules.dailyOn', { xp: config.daily_bonus_xp }) : t(lang, 'leveling.rules.dailyOff'),
    config.streak_bonus_xp > 0 ? tn(lang, 'leveling.rules.streakOn', config.streak_max_days, { xp: config.streak_bonus_xp, count: config.streak_max_days }) : t(lang, 'leveling.rules.streakOff'),
    t(lang, `leveling.rules.leave${config.reset_on_leave ? 'Wipe' : 'Keep'}${keepRoles ? 'Restore' : ''}`),
    t(lang, 'leveling.rules.multipliers', { base: Number(config.xp_multiplier ?? 1), mode: config.multiplier_mode ?? 'highest', cap: Number(config.multiplier_cap ?? 20) }),
  ].join('\n');
}

/** `text XP`, `voice XP` or what an event that boosts everything is called (`all` is `all XP` in the list and `XP` once added). */
function eventSource(source, lang, everything) {
  if (source === 'all') return t(lang, everything);
  return t(lang, source === 'voice' ? 'leveling.event.source.voice' : 'leveling.event.source.text');
}

async function eventCmd(interaction, sub, lang) {
  await defer(interaction);
  const guildId = interaction.guild.id;

  if (sub === 'list') {
    const events = await xpEventsDb.listEvents(guildId, { force: true });
    const now = Date.now();
    const lines = events.map((event) => {
      const running = new Date(event.starts_at).getTime() <= now;
      const unix = Math.floor(new Date(running ? event.ends_at : event.starts_at).getTime() / 1000);
      return t(lang, 'leveling.event.line', {
        id: event.id,
        name: event.name,
        multiplier: Number(event.multiplier),
        source: eventSource(event.source, lang, 'leveling.event.source.all'),
        when: t(lang, running ? 'leveling.event.ends' : 'leveling.event.starts', { time: `<t:${unix}:R>` }),
      });
    });
    await reply(interaction, lines.length ? lines.join('\n') : t(lang, 'leveling.event.none'), 0x4b4f59);
    return;
  }

  if (sub === 'remove') {
    const removed = await xpEventsDb.removeEvent(guildId, interaction.options.getInteger('id', true));
    await reply(interaction, removed ? t(lang, 'leveling.event.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'leveling.event.notFound'), removed ? 0xa5ea7a : 0x4b4f59);
    return;
  }

  const duration = parseDuration(interaction.options.getString('duration', true));
  const startsInText = interaction.options.getString('starts_in');
  const delay = startsInText ? parseDuration(startsInText) : 0;
  if (!duration || duration < 60_000 || duration > 60 * 86_400_000 || (startsInText && delay == null)) {
    await reply(interaction, t(lang, 'leveling.event.badDuration'), 0xfe6465);
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
    await reply(interaction, t(lang, 'leveling.event.limit', { limit: result.limit }), 0xfe6465);
    return;
  }
  const event = result.event;
  const vars = {
    emoji: EMOJI.APPROVE,
    name: event.name,
    id: event.id,
    multiplier: Number(event.multiplier),
    kind: eventSource(event.source, lang, 'leveling.event.kindAll'),
    duration: formatDuration(duration, lang),
    time: `<t:${Math.floor(startsAt.getTime() / 1000)}:R>`,
  };
  await reply(interaction, t(lang, delay ? 'leveling.event.addedLater' : 'leveling.event.addedNow', vars));
}

/** `<#id>, <#id>` or the word for none (`none` is the key, the gender differs in Spanish and Portuguese). */
function mentionList(ids, format, none, lang) {
  return (ids ?? []).length ? ids.map(format).join(', ') : t(lang, none);
}

async function statusCmd(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const rewards = await levelRewardsDb.listRewards(interaction.guild.id, 'all');
  const multipliers = await levelMultipliersDb.listMultipliers(interaction.guild.id);

  const channelMention = (id) => `<#${id}>`;
  const roleMention = (id) => `<@&${id}>`;
  const curve = (prefix) => ({
    a: config[`${prefix}curve_a`] ?? config.curve_a,
    b: config[`${prefix}curve_b`] ?? config.curve_b,
    c: config[`${prefix}curve_c`] ?? config.curve_c,
    difficulty: config[`${prefix}difficulty`] ?? config.difficulty,
    rounding: config[`${prefix}rounding`] ?? config.rounding,
  });
  const rewardList = (voice) => {
    const list = rewards.filter((r) => (r.source === 'voice') === voice);
    return list.length ? list.map((r) => t(lang, 'leveling.status.rewardItem', { level: r.level, role: `<@&${r.role_id}>` })).join(', ') : t(lang, 'leveling.status.noneRewards');
  };
  const milestones = config.notify_milestones ?? [];

  const lines = [
    config.enabled ? t(lang, 'leveling.status.enabled', { emoji: EMOJI.APPROVE }) : t(lang, 'leveling.status.disabled', { emoji: EMOJI.DENY }),
    t(lang, 'leveling.status.messageXp', { min: config.xp_min, max: config.xp_max, seconds: config.cooldown_seconds }),
    config.voice_enabled === false ? t(lang, 'leveling.status.voiceOff', { emoji: EMOJI.DENY, xp: config.xp_per_vc_minute }) : t(lang, 'leveling.status.voiceOn', { emoji: EMOJI.APPROVE, xp: config.xp_per_vc_minute }),
    t(lang, 'leveling.status.voiceCurve', curve('voice_')),
    t(lang, 'leveling.status.voiceMaxLevel', { level: config.voice_max_level ?? config.max_level }),
    t(lang, 'leveling.status.curve', curve('')),
    t(lang, 'leveling.status.maxLevel', { level: config.max_level }),
    t(lang, 'leveling.status.roleMode', { mode: config.role_mode }),
    t(lang, 'leveling.status.notify', {
      mode: config.notify_mode,
      channel: config.notify_channel_id ? ` (<#${config.notify_channel_id}>)` : '',
      every: config.notify_every > 1 ? t(lang, 'leveling.status.notifyEvery', { count: config.notify_every }) : '',
    }),
    t(lang, 'leveling.status.rank', {
      style: config.rank_style ?? 'card',
      card: config.rank_card ? t(lang, 'leveling.status.rankCard', { name: config.rank_card }) : '',
      levelUpCard: config.notify_card ? t(lang, 'leveling.status.levelUpCard', { name: config.notify_card }) : '',
    }),
    rulesSummary(config, lang),
    config.join_level ? t(lang, 'leveling.status.joinLevel', { level: config.join_level }) : config.join_xp ? t(lang, 'leveling.status.joinXp', { xp: config.join_xp }) : t(lang, 'leveling.status.joinNone'),
    t(lang, 'leveling.status.ignoredChannels', { list: mentionList(config.ignored_channel_ids, channelMention, 'leveling.status.noneChannels', lang) }),
    t(lang, 'leveling.status.ignoredVoiceChannels', { list: mentionList(config.voice_ignored_channel_ids, channelMention, 'leveling.status.noneChannels', lang) }),
    t(lang, 'leveling.status.ignoredCategories', { list: mentionList(config.ignored_category_ids, channelMention, 'leveling.status.noneCategories', lang) }),
    t(lang, 'leveling.status.roles', {
      noXp: mentionList(config.no_xp_role_ids, roleMention, 'leveling.status.noneRoles', lang),
      only: mentionList(config.only_xp_role_ids, roleMention, 'leveling.status.everyone', lang),
    }),
    t(lang, 'leveling.status.levelUp', {
      how: t(lang, config.notify_reply === false ? 'leveling.status.levelUpAlone' : 'leveling.status.levelUpReply'),
      deleted: config.notify_delete_after > 0 ? t(lang, 'leveling.status.levelUpDeleted', { seconds: config.notify_delete_after }) : '',
      ping: config.notify_ping === false ? t(lang, 'leveling.status.levelUpNoPing') : '',
      milestones: milestones.length ? t(lang, 'leveling.status.levelUpMilestones', { levels: milestones.map((m) => m.level).join(', ') }) : '',
    }),
    t(lang, 'leveling.status.rewards', { list: rewardList(false) }),
    t(lang, 'leveling.status.voiceRewards', { list: rewardList(true) }),
    t(lang, 'leveling.status.multipliers', { list: multipliers.length ? multipliers.map((m) => `${m.target_type === 'role' ? `<@&${m.target_id}>` : `<#${m.target_id}>`} ×${m.multiplier}`).join(', ') : t(lang, 'leveling.status.noneMultipliers') }),
  ];

  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function rewardCmd(interaction, sub, lang) {
  await defer(interaction);

  if (sub === 'list') {
    const rewards = await levelRewardsDb.listRewards(interaction.guild.id, 'all');
    const lines = (kind) => rewards.filter((r) => r.source === kind).map((r) => t(lang, 'leveling.reward.listItem', { level: r.level, role: `<@&${r.role_id}>` }));
    const text = rewards.length
      ? [lines('text').length ? t(lang, 'leveling.reward.listMessages', { lines: lines('text').join('\n') }) : '', lines('voice').length ? t(lang, 'leveling.reward.listVoice', { lines: lines('voice').join('\n') }) : ''].filter(Boolean).join('\n\n')
      : t(lang, 'leveling.reward.none');
    await reply(interaction, text, 0x4b4f59);
    return;
  }

  const level = interaction.options.getInteger('level', true);
  const type = interaction.options.getString('type') === 'voice' ? 'voice' : 'text';
  const voice = type === 'voice' ? 'Voice' : '';

  if (sub === 'remove') {
    const removed = await levelRewardsDb.removeReward(interaction.guild.id, level, type);
    await reply(interaction, removed ? t(lang, `leveling.reward.removed${voice}`, { emoji: EMOJI.APPROVE, level }) : t(lang, `leveling.reward.notFound${voice}`, { level }), removed ? 0xa5ea7a : 0x4b4f59);
    return;
  }

  const role = interaction.options.getRole('role', true);
  await levelRewardsDb.setReward(interaction.guild.id, level, role.id, type);
  await reply(interaction, t(lang, `leveling.reward.added${voice}`, { emoji: EMOJI.APPROVE, role: `${role}`, level }));
}

async function multiplierCmd(interaction, sub, lang) {
  await defer(interaction);

  if (sub === 'list') {
    const multipliers = await levelMultipliersDb.listMultipliers(interaction.guild.id);
    const item = (m) => t(lang, m.target_type === 'category' ? 'leveling.multiplier.listItemCategory' : 'leveling.multiplier.listItem', {
      target: m.target_type === 'role' ? `<@&${m.target_id}>` : `<#${m.target_id}>`,
      value: m.multiplier,
    });
    const text = multipliers.length ? multipliers.map(item).join('\n') : t(lang, 'leveling.multiplier.none');
    await reply(interaction, text, 0x4b4f59);
    return;
  }

  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  const category = interaction.options.getChannel('category');
  if (!role && !channel && !category) {
    await reply(interaction, t(lang, 'leveling.multiplier.needsTarget'), 0xfe6465);
    return;
  }
  const target = role ?? category ?? channel;
  const targetId = target.id;
  const targetType = role ? 'role' : category ? 'category' : 'channel';
  const targetMention = `${target}`;

  if (sub === 'remove') {
    const removed = await levelMultipliersDb.removeMultiplier(interaction.guild.id, targetId);
    await reply(interaction, removed ? t(lang, 'leveling.multiplier.removed', { emoji: EMOJI.APPROVE, target: targetMention }) : t(lang, 'leveling.multiplier.notFound', { target: targetMention }), removed ? 0xa5ea7a : 0x4b4f59);
    return;
  }

  const value = interaction.options.getNumber('value', true);
  await levelMultipliersDb.setMultiplier(interaction.guild.id, targetId, targetType, value);
  await reply(interaction, t(lang, 'leveling.multiplier.set', { emoji: EMOJI.APPROVE, target: targetMention, value }));
}

const SYNC_LIMIT = 2000;

/** Checks the reward roles of the members who have a level: the ones they earned and do not have yet are given. */
async function syncCmd(interaction, lang) {
  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  let checked = 0;
  let given = 0;
  for (let offset = 0; checked < SYNC_LIMIT; offset += 100) {
    const page = await levelUsersDb.listWithLevels(interaction.guild.id, { offset, limit: 100 });
    if (!page.length) break;
    const members = await interaction.guild.members.fetch({ user: page.map((row) => row.user_id) }).catch(() => null);
    for (const row of page) {
      const member = members?.get(row.user_id);
      if (!member) continue;
      checked += 1;
      given += await syncRewardRoles(interaction.guild, member, row, config);
      if (given && given % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (page.length < 100) break;
  }
  const done = t(lang, 'leveling.sync.done', {
    emoji: EMOJI.APPROVE,
    members: tn(lang, 'leveling.sync.members', checked, { count: checked }),
    roles: tn(lang, 'leveling.sync.roles', given, { count: given }),
  });
  await reply(interaction, `${done}${checked >= SYNC_LIMIT ? t(lang, 'leveling.sync.limit', { limit: SYNC_LIMIT }) : ''}`);
}

async function manageCmd(interaction, sub, lang) {
  if (sub === 'sync') return syncCmd(interaction, lang);
  if (sub === 'xp') return manageXp(interaction, lang);
  return manageLevel(interaction, lang);
}

async function manageXp(interaction, lang) {
  const action = interaction.options.getString('action', true);
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const destUser = interaction.options.getUser('target');

  // The prefix form does not check the choices: a word that is not an action would otherwise answer "undefined".
  if (!['add', 'set', 'remove', 'transfer'].includes(action)) {
    await interaction.reply({ content: t(lang, 'leveling.manage.unknownXpAction', { action }), flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'transfer' && !destUser) {
    await interaction.reply({ content: t(lang, 'leveling.manage.needsTarget'), flags: MessageFlags.Ephemeral });
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
      await reply(interaction, t(lang, 'leveling.manage.notEnough', { emoji: EMOJI.DENY, user: `${targetUser}` }), 0xfe6465);
      return;
    }
    newXp = data.xp - amount;
    const destData = await levelUsersDb.ensureUser(interaction.guild.id, destUser.id);
    const destNewXp = destData.xp + amount;
    await levelUsersDb.setXpAndLevel(interaction.guild.id, destUser.id, destNewXp, levelForXp(destNewXp, config));
  }

  await levelUsersDb.setXpAndLevel(interaction.guild.id, targetUser.id, newXp, levelForXp(newXp, config));

  const key = { add: 'leveling.manage.xpAdd', set: 'leveling.manage.xpSet', remove: 'leveling.manage.xpRemove', transfer: 'leveling.manage.xpTransfer' }[action];
  await reply(interaction, t(lang, key, { emoji: EMOJI.APPROVE, amount, user: `${targetUser}`, target: `${destUser}` }));
}

async function manageLevel(interaction, lang) {
  const action = interaction.options.getString('action', true);
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  if (!['add', 'set', 'remove'].includes(action)) {
    await interaction.reply({ content: t(lang, 'leveling.manage.unknownLevelAction', { action }), flags: MessageFlags.Ephemeral });
    return;
  }

  await defer(interaction);
  const config = await levelConfigDb.ensureConfig(interaction.guild.id);
  const data = await levelUsersDb.ensureUser(interaction.guild.id, targetUser.id);

  let newLevel = data.level;
  if (action === 'add') newLevel = data.level + amount;
  else if (action === 'set') newLevel = amount;
  else if (action === 'remove') newLevel = Math.max(0, data.level - amount);

  const newXp = totalXpForLevel(newLevel, config);
  await levelUsersDb.setXpAndLevel(interaction.guild.id, targetUser.id, newXp, newLevel);

  const key = { add: 'leveling.manage.levelAdd', set: 'leveling.manage.levelSet', remove: 'leveling.manage.levelRemove' }[action];
  await reply(interaction, t(lang, key, { emoji: EMOJI.APPROVE, user: `${targetUser}`, level: newLevel }));
}

module.exports.readRuleValue = readRuleValue;
module.exports.RULE_SETTINGS = RULE_SETTINGS;
