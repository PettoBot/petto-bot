const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig, addBannedWord, removeBannedWord, addImmuneRole, removeImmuneRole, listSilentChannels, addSilentChannel, removeSilentChannel } = require('../../db/automod');
const { getConfig: getAntinukeConfig, upsertConfig: upsertAntinukeConfig, addWhitelist, removeWhitelist } = require('../../db/antinuke');
const { normalizeUrl, defangUrl } = require('../../utils/safeBrowsing');
const { findKnownMalicious, markDeveloperAlerted } = require('../../db/maliciousLinks');
const { notifyMaliciousLink } = require('../../utils/maliciousLinkAlerts');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const rulesDb = require('../../db/automodRules');
const joinPasses = require('../../db/joinPasses');
const native = require('../../utils/nativeAutomod');
const { TEMPLATES, TEMPLATE_IDS, PACKS } = require('../../utils/automodTemplates');
const { syncGuildAutoMod, getAutoModStats } = require('../../utils/autoModManager');
const { isPettoOperator } = require('../../utils/autoModControl');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

// The threat types of the feeds and the catalog key of each one's name.
const THREAT_KEYS = {
  MALWARE: 'malware',
  SOCIAL_ENGINEERING: 'socialEngineering',
  UNWANTED_SOFTWARE: 'unwantedSoftware',
  POTENTIALLY_HARMFUL_APPLICATION: 'harmfulApplication',
};
const threatLabel = (type, lang) => (THREAT_KEYS[type] ? t(lang, `security.threat.${THREAT_KEYS[type]}`) : type);

/** A saved action value (warn, kick, lockdown...) as the replies name it; an unknown value as it is. */
function actionWord(value, lang) {
  const key = `security.action.${value}`;
  const text = t(lang, key);
  return text === key ? String(value) : text;
}

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['am', 'antiraid'],
  // The words of other bots for the same settings (`!antiraid newaccounts`, `!antiraid avatar`...).
  prefixSubcommandAliases: { massjoin: 'raid', newaccounts: 'anti-alt', newaccount: 'anti-alt', age: 'anti-alt', avatar: 'no-avatar', defaultpfp: 'no-avatar', whitelist: 'join-pass' },
  hiddenPrefixSubcommands: ['control'],
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Server protection tools: manual link checks, word filter, anti-spam, anti-raid.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)

    .addSubcommand((sub) => sub.setName('link').setDescription('Check a URL against Petto\'s synchronized public threat feeds.').addStringOption((opt) => opt.setName('url').setDescription('The URL to check').setRequired(true)))

    .addSubcommand((sub) =>
      sub
        .setName('spam')
        .setDescription('Configure anti-spam (repeat messages, mass mentions, excessive caps, unauthorized invites).')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-spam on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('max_mentions').setDescription('Max users/roles mentioned in one message before it counts as spam (default 5)').setMinValue(1).setRequired(false))
        .addIntegerOption((opt) => opt.setName('repeat').setDescription('Same message this many times is a flood (default 3)').setMinValue(2).setMaxValue(20).setRequired(false))
        .addIntegerOption((opt) => opt.setName('caps_percent').setDescription('Percent of capital letters that counts as shouting (default 70)').setMinValue(30).setMaxValue(100).setRequired(false))
        .addIntegerOption((opt) => opt.setName('max_length').setDescription('Delete messages longer than this many characters (0 for no limit)').setMinValue(0).setMaxValue(2000).setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('strikes')
        .setDescription('Mute a member who breaks the automod again and again.')
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Hits that trigger the mute (0 turns it off)').setMinValue(0).setMaxValue(20).setRequired(true))
        .addIntegerOption((opt) => opt.setName('window_minutes').setDescription('In how many minutes (default 10)').setMinValue(1).setMaxValue(1440))
        .addIntegerOption((opt) => opt.setName('mute_minutes').setDescription('How long the mute lasts (default 10)').setMinValue(1).setMaxValue(40320)),
    )

    .addSubcommand((sub) =>
      sub
        .setName('raid')
        .setDescription('Configure anti-raid (burst-join detection).')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-raid on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('threshold').setDescription('Joins within the window that count as a raid (default 6)').setMinValue(2).setRequired(false))
        .addIntegerOption((opt) => opt.setName('window_seconds').setDescription('Time window in seconds (default 10)').setMinValue(2).setMaxValue(300).setRequired(false))
        .addStringOption((opt) => opt.setName('action').setDescription('What to do once a raid is detected (default alert)').addChoices({ name: 'alert', value: 'alert' }, { name: 'kick', value: 'kick' }, { name: 'lockdown', value: 'lockdown' }).setRequired(false)),
    )

    .addSubcommand((sub) =>
      sub
        .setName('anti-alt')
        .setDescription('Flag or kick very new accounts on join.')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-alt on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('min_age_days').setDescription('Minimum account age in days (default 7)').setMinValue(1).setMaxValue(365).setRequired(false))
        .addStringOption((opt) => opt.setName('action').setDescription('What to do (default kick)').addChoices({ name: 'kick', value: 'kick' }, { name: 'flag only', value: 'flag' }).setRequired(false)),
    )

    .addSubcommand((sub) =>
      sub
        .setName('no-avatar')
        .setDescription('Flag or kick accounts that join without a profile picture.')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn the no-avatar check on/off').setRequired(true))
        .addStringOption((opt) => opt.setName('action').setDescription('What to do (default kick)').addChoices({ name: 'kick', value: 'kick' }, { name: 'flag only', value: 'flag' }).setRequired(false)),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('join-pass')
        .setDescription('One-time passes that let an account join past the anti-raid checks.')
        .addSubcommand((sub) => sub.setName('add').setDescription('Let an account join once without the anti-raid checks.').addUserOption((opt) => opt.setName('user').setDescription('The account (an ID works)').setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Take back a join pass.').addUserOption((opt) => opt.setName('user').setDescription('The account').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List the join passes not used yet.')),
    )

    .addSubcommand((sub) =>
      sub
        .setName('antinuke')
        .setDescription('Detect and respond to a burst of destructive actions (bans, channel/role deletes) by one account.')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-nuke on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('threshold').setDescription('Destructive actions within the window that trigger a response (default 5)').setMinValue(2).setRequired(false))
        .addIntegerOption((opt) => opt.setName('window_seconds').setDescription('Time window in seconds (default 10)').setMinValue(2).setMaxValue(300).setRequired(false)),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('template')
        .setDescription("Filters of Petto's own AutoMod made from ready templates (links, invites, emojis...).")
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a filter from a template.')
            .addStringOption((opt) => opt.setName('template').setDescription('What to filter').addChoices(...TEMPLATE_IDS.slice(0, 25).map((id) => ({ name: native.NAMES[id], value: id }))).setRequired(true))
            .addStringOption((opt) => opt.setName('action').setDescription('What happens (default delete the message)').addChoices({ name: 'delete only', value: 'delete' }, { name: 'warn', value: 'warn' }, { name: 'mute', value: 'mute' }, { name: 'kick', value: 'kick' }))
            .addIntegerOption((opt) => opt.setName('mute_minutes').setDescription('Minutes of mute when the action is mute (default 10)').setMinValue(1).setMaxValue(40320))
            .addIntegerOption((opt) => opt.setName('amount').setDescription('The number some templates use (emojis allowed, words in caps, repeated characters...)').setMinValue(0).setMaxValue(30)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('See the filters of this server.'))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a filter.').addIntegerOption((opt) => opt.setName('id').setDescription('The number of the filter (see list)').setMinValue(1).setRequired(true)))
        .addSubcommand((sub) => sub.setName('toggle').setDescription('Turn a filter on or off.').addIntegerOption((opt) => opt.setName('id').setDescription('The number of the filter (see list)').setMinValue(1).setRequired(true)).addBooleanOption((opt) => opt.setName('enabled').setDescription('On or off').setRequired(true))),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('native')
        .setDescription("Rules in Discord's own AutoMod made from the same templates and packs.")
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription("Make a rule in Discord's AutoMod from a template or a pack.")
            .addStringOption((opt) => opt.setName('template').setDescription('One template').addChoices(...TEMPLATE_IDS.slice(0, 25).map((id) => ({ name: native.NAMES[id], value: id }))))
            .addStringOption((opt) => opt.setName('pack').setDescription('Or a pack of templates in one rule').addChoices(...Object.keys(PACKS).map((id) => ({ name: native.PACK_NAMES[id], value: id }))))
            .addChannelOption((opt) => opt.setName('alert_channel').setDescription('Where Discord sends an alert when it blocks something').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addIntegerOption((opt) => opt.setName('timeout_minutes').setDescription('Also mute the member for these minutes').setMinValue(1).setMaxValue(40320))
            .addIntegerOption((opt) => opt.setName('amount').setDescription('The number some templates use (emojis allowed, words in caps...)').setMinValue(0).setMaxValue(30)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription("See the rules of Discord's AutoMod in this server."))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a rule made from these templates.').addStringOption((opt) => opt.setName('rule').setDescription('The rule ID (see list)').setRequired(true))),
    )

    // Prefix-only owner/developer control. The dispatcher unlocks this hidden path
    // only after seeing the configured control token, so it never appears in !help.
    .addSubcommand((sub) =>
      sub
        .setName('control')
        .setDescription('Private Petto official AutoMod control.')
        .addStringOption((opt) => opt.setName('action').setDescription('Private action').addChoices({ name: 'stats', value: 'stats' }, { name: 'sync', value: 'sync' }).setRequired(false)),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('immune')
        .setDescription('Roles that bypass the word filter / anti-spam checks entirely.')
        .addSubcommand((sub) => sub.setName('add').setDescription('Make a role immune to automod.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a role\'s automod immunity.').addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List immune roles.')),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('antinuke-whitelist')
        .setDescription('Users/bots exempt from anti-nuke tracking.')
        .addSubcommand((sub) => sub.setName('add').setDescription('Whitelist a user or bot.').addUserOption((opt) => opt.setName('user').setDescription('User or bot').setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a user or bot from the whitelist.').addUserOption((opt) => opt.setName('user').setDescription('User or bot').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List whitelisted users/bots.')),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('word-filter')
        .setDescription('Ban specific words/phrases from being posted.')
        .addSubcommand((sub) =>
          sub
            .setName('toggle')
            .setDescription('Turn the word filter on/off and choose what happens on a hit.')
            .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable?').setRequired(true))
            .addStringOption((opt) =>
              opt
                .setName('action')
                .setDescription('What happens when a banned word is posted (default warn)')
                .addChoices({ name: 'warn', value: 'warn' }, { name: 'mute (10m)', value: 'mute' }, { name: 'kick', value: 'kick' }, { name: 'delete only (no sanction)', value: 'delete' })
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) => sub.setName('add').setDescription('Add a banned word.').addStringOption((opt) => opt.setName('word').setDescription('Word or phrase').setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a banned word.').addStringOption((opt) => opt.setName('word').setDescription('Word or phrase').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List banned words.')),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('invites')
        .setDescription('Manage which Discord invite codes are allowed past the anti-spam filter.')
        .addSubcommand((sub) => sub.setName('allow').setDescription('Allow an invite code (e.g. your own server\'s).').addStringOption((opt) => opt.setName('code').setDescription('Invite code, e.g. the "abc123" in discord.gg/abc123').setRequired(true)))
        .addSubcommand((sub) => sub.setName('disallow').setDescription('Remove an invite code from the allow-list.').addStringOption((opt) => opt.setName('code').setDescription('Invite code').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List allowed invite codes.')),
    )

    .addSubcommandGroup((group) =>
      group
        .setName('silent-channel')
        .setDescription('Channels where any message is treated as a violation.')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Make a channel silent.')
            .addChannelOption((opt) => opt.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
            .addStringOption((opt) => opt.setName('action').setDescription('What happens if someone posts there (default warn)').addChoices({ name: 'warn', value: 'warn' }, { name: 'mute (30m)', value: 'mute' }, { name: 'kick', value: 'kick' }).setRequired(false)),
        )
        .addSubcommand((sub) => sub.setName('remove').setDescription('Stop treating a channel as silent.').addChannelOption((opt) => opt.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('List silent channels.')),
    ),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if (!group && sub === 'link') return link(interaction, lang);
    if (!group && sub === 'spam') return spam(interaction, lang);
    if (!group && sub === 'raid') return raid(interaction, lang);
    if (!group && sub === 'strikes') return strikes(interaction, lang);
    if (!group && sub === 'anti-alt') return antiAlt(interaction, lang);
    if (!group && sub === 'antinuke') return antinuke(interaction, lang);
    if (!group && sub === 'no-avatar') return noAvatar(interaction, lang);
    if (group === 'join-pass') return joinPass(interaction, sub, lang);
    if (!group && sub === 'control') return officialControl(interaction, lang);
    if (group === 'word-filter') return wordFilter(interaction, sub, lang);
    if (group === 'invites') return invites(interaction, sub, lang);
    if (group === 'silent-channel') return silentChannel(interaction, sub, lang);
    if (group === 'immune') return immune(interaction, sub, lang);
    if (group === 'antinuke-whitelist') return antinukeWhitelist(interaction, sub, lang);
    if (group === 'template') return templateFilters(interaction, sub, lang);
    if (group === 'native') return nativeRules(interaction, sub, lang);
  },
};

async function officialControl(interaction, lang) {
  if (!interaction.pettoAutomodControl || !isPettoOperator(interaction.user.id)) {
    await interaction.reply({ content: t(lang, 'security.control.unavailable'), flags: MessageFlags.Ephemeral });
    return;
  }

  // From here on only the Petto team (isPettoOperator) reads the answers, so they stay in English.
  const action = interaction.options.getString('action') ?? 'stats';
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    if (action === 'sync') {
    const result = await syncGuildAutoMod(interaction.guild);
    const clean = result.success && !result.missingPermissions && result.failed === 0;
    const lines = [
      `### ${clean ? EMOJI.APPROVE : EMOJI.ALERT} Petto Official AutoMod`, // i18n-ignore: Petto team only
      `**Created:** ${result.created}`, // i18n-ignore: Petto team only
      `**Updated:** ${result.updated}`, // i18n-ignore: Petto team only
      `**Existing:** ${result.existing}`, // i18n-ignore: Petto team only
      `**Skipped:** ${result.skipped}`, // i18n-ignore: Petto team only
      `**Errors:** ${result.failed}`, // i18n-ignore: Petto team only
      `**Managed rules:** ${result.managedRules}`, // i18n-ignore: Petto team only
    ];
    if (result.reason) lines.push(`**Result:** ${result.reason}`); // i18n-ignore: Petto team only
    if (result.skippedReasons.length) lines.push(`**Notes:** ${result.skippedReasons.slice(0, 3).join(' · ')}`); // i18n-ignore: Petto team only
    await interaction.editReply({ components: [textCard(lines.join('\n'), clean ? 0xa5ea7a : 0xf5c451)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const stats = await getAutoModStats(interaction.client);
  const reached = stats.remaining === 0;
  const lines = [
    `### ${reached ? EMOJI.APPROVE : EMOJI.STAR} Petto Official AutoMod`, // i18n-ignore: Petto team only
    `**Guilds checked:** ${stats.guilds}`, // i18n-ignore: Petto team only
    `**Guilds with Petto rules:** ${stats.guildsWithAutoMod}`, // i18n-ignore: Petto team only
    `**Managed rules:** ${stats.managedRules}`, // i18n-ignore: Petto team only
    `**Target:** ${stats.target}`, // i18n-ignore: Petto team only
    `**Remaining:** ${stats.remaining}`, // i18n-ignore: Petto team only
    `**Status:** ${reached ? 'Target reached' : 'In progress'}`, // i18n-ignore: Petto team only
  ];
  if (stats.missingPermissions || stats.errors) lines.push(`**Warnings:** ${stats.missingPermissions} permission · ${stats.errors} errors`); // i18n-ignore: Petto team only
  await interaction.editReply({ components: [textCard(lines.join('\n'), reached ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function link(interaction, lang) {
  const raw = interaction.options.getString('url', true);
  const url = normalizeUrl(raw);

  if (!url) {
    await interaction.reply({ content: t(lang, 'security.link.invalid', { url: raw }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  // First consult Petto's own threat DB. Known malicious URLs never consume a
  // Public feed results are reused instead of making an external request again.
  let known = null;
  try {
    known = (await findKnownMalicious([url]))[0] ?? null;
  } catch (err) {
    // A DB outage should not make the manual checker useless; fall back to the
    // external lookup, but log that the cache/database path was unavailable.
    logger.error('Malicious-link DB lookup failed:', err);
  }

  if (known) {
    const threats = known.threat_types ?? [];
    const labels = threats.map((type) => threatLabel(type, lang));
    const text = t(lang, 'security.link.flagged', { emoji: EMOJI.DENY, url: defangUrl(url), threats: labels.join(', ') || t(lang, 'security.link.unknownThreat') });
    await interaction.editReply({ components: [textCard(text, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });

    // Retry the developer alert only if a previous attempt never succeeded.
    if (!known.dev_alerted_at) {
      const sent = await notifyMaliciousLink(interaction.client, {
        url,
        threatTypes: threats,
        reporterId: interaction.user?.id,
        guild: interaction.guild,
        channel: interaction.channel,
      });
      if (sent) await markDeveloperAlerted(url).catch((err) => logger.error('Failed to mark malicious-link alert as sent:', err));
    }
    return;
  }

  const text = t(lang, 'security.link.clean', { emoji: EMOJI.APPROVE, url });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function spam(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const maxMentions = interaction.options.getInteger('max_mentions');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { anti_spam_enabled: enabled };
  if (maxMentions) patch.max_mentions = maxMentions;
  const repeat = interaction.options.getInteger('repeat');
  if (repeat) patch.repeat_threshold = repeat;
  const capsPercent = interaction.options.getInteger('caps_percent');
  if (capsPercent) patch.caps_percent = capsPercent;
  const maxLength = interaction.options.getInteger('max_length');
  if (maxLength !== null) patch.max_message_length = maxLength;
  const saved = await upsertConfig(interaction.guild.id, patch);

  const text = t(lang, enabled ? 'security.spam.enabled' : 'security.spam.disabled', { emoji: EMOJI.APPROVE, maxMentions: saved.max_mentions });
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function raid(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const threshold = interaction.options.getInteger('threshold');
  const windowSeconds = interaction.options.getInteger('window_seconds');
  const action = interaction.options.getString('action');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { anti_raid_enabled: enabled };
  if (threshold) patch.raid_join_threshold = threshold;
  if (windowSeconds) patch.raid_window_seconds = windowSeconds;
  if (action) patch.raid_action = action;
  const saved = await upsertConfig(interaction.guild.id, patch);

  const text = t(lang, enabled ? 'security.raid.enabled' : 'security.raid.disabled', { emoji: EMOJI.APPROVE, threshold: saved.raid_join_threshold, seconds: saved.raid_window_seconds, action: actionWord(saved.raid_action, lang) });
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

// What happens on a word filter hit, as the replies name it.
const WORD_FILTER_ACTIONS = ['warn', 'mute', 'kick', 'delete'];
const wordFilterAction = (value, lang) => (WORD_FILTER_ACTIONS.includes(value) ? t(lang, `security.wordFilter.action.${value}`) : value);

async function wordFilter(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'toggle') {
    const enabled = interaction.options.getBoolean('enabled', true);
    const action = interaction.options.getString('action');

    const patch = { word_filter_enabled: enabled };
    if (action) patch.word_filter_action = action;
    const saved = await upsertConfig(interaction.guild.id, patch);

    const actionLabel = wordFilterAction(saved.word_filter_action, lang);
    await interaction.editReply({ components: [textCard(t(lang, enabled ? 'security.wordFilter.enabled' : 'security.wordFilter.disabled', { emoji: EMOJI.APPROVE, action: actionLabel }), enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'add') {
    const word = interaction.options.getString('word', true);
    await addBannedWord(interaction.guild.id, word);
    await interaction.editReply({ components: [textCard(t(lang, 'security.wordFilter.added', { emoji: EMOJI.APPROVE, word }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const word = interaction.options.getString('word', true);
    await removeBannedWord(interaction.guild.id, word);
    await interaction.editReply({ components: [textCard(t(lang, 'security.wordFilter.removed', { emoji: EMOJI.APPROVE, word }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // list
  const config = await getConfig(interaction.guild.id);
  const words = config?.banned_words ?? [];
  const actionLabel = wordFilterAction(WORD_FILTER_ACTIONS.includes(config?.word_filter_action) ? config.word_filter_action : 'warn', lang);
  const lines = [
    t(lang, 'security.wordFilter.list.action', { action: actionLabel }),
    words.length ? t(lang, 'security.wordFilter.list.words', { count: words.length, words: words.map((w) => `\`${w}\``).join(', ') }) : t(lang, 'security.wordFilter.list.empty'),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function invites(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const config = await getConfig(interaction.guild.id);
    const codes = config?.allowed_invite_codes ?? [];
    const text = codes.length ? t(lang, 'security.invites.list', { count: codes.length, codes: codes.map((c) => `\`${c}\``).join(', ') }) : t(lang, 'security.invites.empty');
    await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const rawCode = interaction.options.getString('code', true);
  const code = rawCode.replace(/^https?:\/\/(discord\.gg|discord(?:app)?\.com\/invite)\//i, '').replace(/\/$/, '');
  const config = (await getConfig(interaction.guild.id)) ?? { allowed_invite_codes: [] };
  const codes = new Set((config.allowed_invite_codes ?? []).map((c) => c.toLowerCase()));

  if (sub === 'allow') {
    codes.add(code.toLowerCase());
  } else {
    codes.delete(code.toLowerCase());
  }

  await upsertConfig(interaction.guild.id, { allowed_invite_codes: [...codes] });
  const text = t(lang, sub === 'allow' ? 'security.invites.allowed' : 'security.invites.disallowed', { emoji: EMOJI.APPROVE, code });
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function silentChannel(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'add') {
    const channel = interaction.options.getChannel('channel', true);
    const action = interaction.options.getString('action') ?? 'warn';
    await addSilentChannel(interaction.guild.id, channel.id, action);
    await interaction.editReply({ components: [textCard(t(lang, 'security.silent.added', { emoji: EMOJI.APPROVE, channel: `${channel}`, action: actionWord(action, lang) }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const channel = interaction.options.getChannel('channel', true);
    const removed = await removeSilentChannel(interaction.guild.id, channel.id);
    const text = removed ? t(lang, 'security.silent.removed', { emoji: EMOJI.APPROVE, channel: `${channel}` }) : t(lang, 'security.silent.notSilent', { channel: `${channel}` });
    await interaction.editReply({ components: [textCard(text, removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // list
  const channels = await listSilentChannels(interaction.guild.id);
  const text = channels.length ? channels.map((c) => `<#${c.channel_id}> · ${actionWord(c.action, lang)}`).join('\n') : t(lang, 'security.silent.empty');
  await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
}

async function antiAlt(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const minAgeDays = interaction.options.getInteger('min_age_days');
  const action = interaction.options.getString('action');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { anti_alt_enabled: enabled };
  if (minAgeDays) patch.anti_alt_min_age_days = minAgeDays;
  if (action) patch.anti_alt_action = action;
  const saved = await upsertConfig(interaction.guild.id, patch);

  const text = t(lang, enabled ? 'security.antiAlt.enabled' : 'security.antiAlt.disabled', { emoji: EMOJI.APPROVE, days: saved.anti_alt_min_age_days, action: actionWord(saved.anti_alt_action, lang) });
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function noAvatar(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const action = interaction.options.getString('action');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { no_avatar_enabled: enabled };
  if (action) patch.no_avatar_action = action;
  const saved = await upsertConfig(interaction.guild.id, patch);

  const text = t(lang, enabled ? 'security.noAvatar.enabled' : 'security.noAvatar.disabled', { emoji: EMOJI.APPROVE, action: actionWord(saved.no_avatar_action, lang) });
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function joinPass(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const reply = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

  if (sub === 'list') {
    const rows = await joinPasses.listPasses(interaction.guild.id);
    if (!rows.length) return reply(t(lang, 'security.joinPass.empty'));
    const lines = rows.slice(0, 40).map((row) => `<@${row.user_id}> \`${row.user_id}\` · <@${row.created_by}> · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`);
    return reply([t(lang, 'security.joinPass.title', { count: rows.length }), ...lines].join('\n'));
  }

  const user = interaction.options.getUser('user', true);
  if (sub === 'add') {
    if (await interaction.guild.members.fetch(user.id).catch(() => null)) return reply(t(lang, 'security.joinPass.alreadyIn', { emoji: EMOJI.DENY, user: `${user}` }), 0xfe6465);
    await joinPasses.addPass(interaction.guild.id, user.id, interaction.user.id);
    return reply(t(lang, 'security.joinPass.added', { emoji: EMOJI.APPROVE, user: `${user}` }));
  }
  const removed = await joinPasses.removePass(interaction.guild.id, user.id);
  return reply(t(lang, removed ? 'security.joinPass.removed' : 'security.joinPass.notFound', { emoji: removed ? EMOJI.APPROVE : EMOJI.DENY, user: `${user}` }), removed ? 0xa5ea7a : 0x4b4f59);
}

async function antinuke(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const threshold = interaction.options.getInteger('threshold');
  const windowSeconds = interaction.options.getInteger('window_seconds');

  if (enabled && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: t(lang, 'security.antinukeSwitch.needsAdmin'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { enabled };
  if (threshold) patch.action_threshold = threshold;
  if (windowSeconds) patch.window_seconds = windowSeconds;
  const saved = await upsertAntinukeConfig(interaction.guild.id, patch);

  const text = t(lang, enabled ? 'security.antinukeSwitch.enabled' : 'security.antinukeSwitch.disabled', { emoji: EMOJI.APPROVE, threshold: saved.action_threshold, seconds: saved.window_seconds });
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function immune(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const config = await getConfig(interaction.guild.id);
    const ids = config?.immune_role_ids ?? [];
    const text = ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : t(lang, 'security.immune.empty');
    await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.options.getRole('role', true);
  if (sub === 'add') {
    await addImmuneRole(interaction.guild.id, role.id);
    await interaction.editReply({ components: [textCard(t(lang, 'security.immune.added', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } else {
    await removeImmuneRole(interaction.guild.id, role.id);
    await interaction.editReply({ components: [textCard(t(lang, 'security.immune.removed', { emoji: EMOJI.APPROVE, role: `${role}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function antinukeWhitelist(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const config = await getAntinukeConfig(interaction.guild.id);
    const ids = config?.whitelist_ids ?? [];
    const text = ids.length ? ids.map((id) => `<@${id}>`).join(' ') : t(lang, 'security.antinukeWhitelist.empty');
    await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const user = interaction.options.getUser('user', true);
  if (sub === 'add') {
    await addWhitelist(interaction.guild.id, user.id);
    await interaction.editReply({ components: [textCard(t(lang, 'security.antinukeWhitelist.added', { emoji: EMOJI.APPROVE, user: `${user}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } else {
    await removeWhitelist(interaction.guild.id, user.id);
    await interaction.editReply({ components: [textCard(t(lang, 'security.antinukeWhitelist.removed', { emoji: EMOJI.APPROVE, user: `${user}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  }
}

const AMOUNT_KEY = { emojis: 'max', caps: 'words', repeated_characters: 'times', spoilers: 'max', headings: 'level' };

async function templateFilters(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const guildId = interaction.guild.id;
  const show = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

  if (sub === 'list') {
    const rows = await rulesDb.listRules(guildId);
    if (!rows.length) return show(t(lang, 'security.template.list.empty'));
    const line = (r) => t(lang, 'security.template.list.line', {
      id: r.id,
      status: r.enabled ? EMOJI.APPROVE : '▫️',
      name: native.filterName(r, lang),
      action: `${actionWord(r.action, lang)}${r.action === 'mute' ? ` ${r.mute_minutes}m` : ''}`,
      hits: tn(lang, 'security.template.list.hits', r.hits, { count: r.hits }),
    });
    return show([t(lang, 'security.template.list.title'), ...rows.map(line)].join('\n'));
  }
  if (sub === 'remove') {
    const removed = await rulesDb.deleteRule(guildId, interaction.options.getInteger('id', true));
    return show(removed ? t(lang, 'security.template.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'security.template.missing'), removed ? 0xa5ea7a : 0xff6b6b);
  }
  if (sub === 'toggle') {
    const enabled = interaction.options.getBoolean('enabled', true);
    const updated = await rulesDb.updateRule(guildId, interaction.options.getInteger('id', true), { enabled });
    return show(updated ? t(lang, enabled ? 'security.template.on' : 'security.template.off', { emoji: EMOJI.APPROVE }) : t(lang, 'security.template.missing'), updated ? 0xa5ea7a : 0xff6b6b);
  }

  const id = interaction.options.getString('template', true);
  const amount = interaction.options.getInteger('amount');
  const options = amount !== null && AMOUNT_KEY[id] ? { [AMOUNT_KEY[id]]: amount } : {};
  try {
    const row = await rulesDb.createRule(guildId, {
      name: native.NAMES[id],
      template: id,
      options,
      action: interaction.options.getString('action') ?? 'delete',
      mute_minutes: interaction.options.getInteger('mute_minutes') ?? 10,
    });
    return show(t(lang, 'security.template.created', { emoji: EMOJI.APPROVE, id: row.id, name: native.filterName(row, lang), action: actionWord(row.action, lang) }));
  } catch (err) {
    if (err.userFacing) return show(err.message, 0xff6b6b);
    throw err;
  }
}

async function nativeRules(interaction, sub, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const show = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
  try {
    if (sub === 'list') {
      const { rules, used, limits } = await native.listNative(interaction.guild);
      const lines = rules.map((r) => t(lang, r.official ? 'security.native.list.lineOfficial' : 'security.native.list.line', { status: r.enabled ? EMOJI.APPROVE : '▫️', name: r.name, id: r.id }));
      return show([t(lang, 'security.native.list.title'), t(lang, 'security.native.list.keywordRules', { used: used.keyword, limit: limits.keyword }), ...lines].join('\n').slice(0, 3800));
    }
    if (sub === 'remove') {
      await native.deleteNative(interaction.guild, interaction.options.getString('rule', true).trim(), lang);
      return show(t(lang, 'security.native.removed', { emoji: EMOJI.APPROVE }));
    }
    const template = interaction.options.getString('template');
    const pack = interaction.options.getString('pack');
    if (!template && !pack) return show(t(lang, 'security.native.pickOne'), 0xff6b6b);
    const amount = interaction.options.getInteger('amount');
    const made = await native.createNative(interaction.guild, {
      template, pack,
      options: amount !== null && template && AMOUNT_KEY[template] ? { [AMOUNT_KEY[template]]: amount } : {},
      alertChannelId: interaction.options.getChannel('alert_channel')?.id,
      timeoutMinutes: interaction.options.getInteger('timeout_minutes'),
      lang,
    });
    return show(t(lang, 'security.native.created', { emoji: EMOJI.APPROVE, name: made.name }));
  } catch (err) {
    if (err.userFacing) return show(err.message, 0xff6b6b);
    throw err;
  }
}

async function strikes(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const limit = interaction.options.getInteger('limit', true);
  const patch = { strike_limit: limit };
  const windowMinutes = interaction.options.getInteger('window_minutes');
  if (windowMinutes) patch.strike_window_minutes = windowMinutes;
  const muteMinutes = interaction.options.getInteger('mute_minutes');
  if (muteMinutes) patch.strike_mute_minutes = muteMinutes;
  const saved = await upsertConfig(interaction.guild.id, patch);
  const text = limit
    ? t(lang, 'security.strikes.on', { emoji: EMOJI.APPROVE, limit: saved.strike_limit, window: saved.strike_window_minutes, minutes: saved.strike_mute_minutes })
    : t(lang, 'security.strikes.off', { emoji: EMOJI.APPROVE });
  await interaction.editReply({ components: [textCard(text, limit ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
