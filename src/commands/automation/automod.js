const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig, addBannedWord, removeBannedWord, addImmuneRole, removeImmuneRole, listSilentChannels, addSilentChannel, removeSilentChannel } = require('../../db/automod');
const { getConfig: getAntinukeConfig, upsertConfig: upsertAntinukeConfig, addWhitelist, removeWhitelist } = require('../../db/antinuke');
const { checkUrl, normalizeUrl } = require('../../utils/safeBrowsing');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const THREAT_LABELS = {
  MALWARE: 'Malware',
  SOCIAL_ENGINEERING: 'Phishing / social engineering',
  UNWANTED_SOFTWARE: 'Unwanted software',
  POTENTIALLY_HARMFUL_APPLICATION: 'Potentially harmful application',
};

module.exports = {
  aliases: ['am'],
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Server protection tools: link scanning, word filter, anti-spam, anti-raid.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)

    .addSubcommand((sub) => sub.setName('link').setDescription('Check a URL for phishing/malware via Google Safe Browsing.').addStringOption((opt) => opt.setName('url').setDescription('The URL to check').setRequired(true)))

    .addSubcommand((sub) =>
      sub
        .setName('spam')
        .setDescription('Configure anti-spam (repeat messages, mass mentions, excessive caps, unauthorized invites).')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-spam on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('max_mentions').setDescription('Max users/roles mentioned in one message before it counts as spam (default 5)').setMinValue(1).setRequired(false)),
    )

    .addSubcommand((sub) =>
      sub
        .setName('raid')
        .setDescription('Configure anti-raid (burst-join detection).')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-raid on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('threshold').setDescription('Joins within the window that count as a raid (default 6)').setMinValue(2).setRequired(false))
        .addIntegerOption((opt) => opt.setName('window_seconds').setDescription('Time window in seconds (default 10)').setMinValue(2).setMaxValue(300).setRequired(false))
        .addStringOption((opt) => opt.setName('action').setDescription('What to do once a raid is detected (default alert)').addChoices({ name: 'alert', value: 'alert' }, { name: 'kick', value: 'kick' }).setRequired(false)),
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
        .setName('antinuke')
        .setDescription('Detect and respond to a burst of destructive actions (bans, channel/role deletes) by one account.')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Turn anti-nuke on/off').setRequired(true))
        .addIntegerOption((opt) => opt.setName('threshold').setDescription('Destructive actions within the window that trigger a response (default 5)').setMinValue(2).setRequired(false))
        .addIntegerOption((opt) => opt.setName('window_seconds').setDescription('Time window in seconds (default 10)').setMinValue(2).setMaxValue(300).setRequired(false)),
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
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if (!group && sub === 'link') return link(interaction);
    if (!group && sub === 'spam') return spam(interaction);
    if (!group && sub === 'raid') return raid(interaction);
    if (!group && sub === 'anti-alt') return antiAlt(interaction);
    if (!group && sub === 'antinuke') return antinuke(interaction);
    if (group === 'word-filter') return wordFilter(interaction, sub);
    if (group === 'invites') return invites(interaction, sub);
    if (group === 'silent-channel') return silentChannel(interaction, sub);
    if (group === 'immune') return immune(interaction, sub);
    if (group === 'antinuke-whitelist') return antinukeWhitelist(interaction, sub);
  },
};

async function link(interaction) {
  const raw = interaction.options.getString('url', true);
  const url = normalizeUrl(raw);

  if (!url) {
    await interaction.reply({ content: `\`${raw}\` doesn't look like a valid URL.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  let threats;
  try {
    threats = await checkUrl(url);
  } catch (err) {
    logger.error('Safe Browsing check failed:', err);
    await interaction.editReply({ components: [textCard('I was unable to check that URL right now. Try again shortly.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (!threats.length) {
    const text = `${EMOJI.APPROVE}  No known threats found for:\n\`${url}\``;
    await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const labels = threats.map((t) => THREAT_LABELS[t] ?? t);
  const text = [`${EMOJI.DENY}  This URL was flagged as dangerous:`, `\`${url}\``, `**Threats:** ${labels.join(', ')}`].join('\n');
  await interaction.editReply({ components: [textCard(text, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

async function spam(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const maxMentions = interaction.options.getInteger('max_mentions');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { anti_spam_enabled: enabled };
  if (maxMentions) patch.max_mentions = maxMentions;
  const saved = await upsertConfig(interaction.guild.id, patch);

  const text = `${EMOJI.APPROVE}  Anti-spam ${enabled ? 'enabled' : 'disabled'}.\n**Max mentions:** ${saved.max_mentions}\nCovers repeat-message flooding, mass mentions, excessive caps, and unauthorized invite links — all checked locally, no external API calls per message.`;
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function raid(interaction) {
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

  const text = `${EMOJI.APPROVE}  Anti-raid ${enabled ? 'enabled' : 'disabled'}.\n**Threshold:** ${saved.raid_join_threshold} joins in ${saved.raid_window_seconds}s\n**Action:** ${saved.raid_action}`;
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function wordFilter(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'toggle') {
    const enabled = interaction.options.getBoolean('enabled', true);
    const action = interaction.options.getString('action');

    const patch = { word_filter_enabled: enabled };
    if (action) patch.word_filter_action = action;
    const saved = await upsertConfig(interaction.guild.id, patch);

    const actionLabel = { warn: 'warn', mute: 'mute (10m)', kick: 'kick', delete: 'delete only, no sanction' }[saved.word_filter_action] ?? saved.word_filter_action;
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Word filter ${enabled ? 'enabled' : 'disabled'}.\n**Action:** ${actionLabel}`, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'add') {
    const word = interaction.options.getString('word', true);
    await addBannedWord(interaction.guild.id, word);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Added \`${word}\` to the word filter.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const word = interaction.options.getString('word', true);
    await removeBannedWord(interaction.guild.id, word);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Removed \`${word}\` from the word filter.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // list
  const config = await getConfig(interaction.guild.id);
  const words = config?.banned_words ?? [];
  const actionLabel = { warn: 'warn', mute: 'mute (10m)', kick: 'kick', delete: 'delete only, no sanction' }[config?.word_filter_action] ?? 'warn';
  const lines = [`**Action on hit:** ${actionLabel}`, words.length ? `**Banned words (${words.length}):** ${words.map((w) => `\`${w}\``).join(', ')}` : 'No banned words configured.'];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function invites(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const config = await getConfig(interaction.guild.id);
    const codes = config?.allowed_invite_codes ?? [];
    const text = codes.length ? `**Allowed invite codes (${codes.length}):** ${codes.map((c) => `\`${c}\``).join(', ')}` : 'No invite codes allow-listed — every Discord invite link will be treated as unauthorized when anti-spam is on.';
    await interaction.editReply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
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
  const text = `${EMOJI.APPROVE}  \`${code}\` is now ${sub === 'allow' ? 'allowed' : 'no longer allowed'}.`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function silentChannel(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'add') {
    const channel = interaction.options.getChannel('channel', true);
    const action = interaction.options.getString('action') ?? 'warn';
    await addSilentChannel(interaction.guild.id, channel.id, action);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${channel} is now silent — posting there triggers **${action}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const channel = interaction.options.getChannel('channel', true);
    const removed = await removeSilentChannel(interaction.guild.id, channel.id);
    await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  ${channel} is no longer silent.` : `${channel} wasn't marked as silent.`, removed ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // list
  const channels = await listSilentChannels(interaction.guild.id);
  const text = channels.length ? channels.map((c) => `<#${c.channel_id}> · ${c.action}`).join('\n') : 'No silent channels configured.';
  await interaction.editReply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function antiAlt(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const minAgeDays = interaction.options.getInteger('min_age_days');
  const action = interaction.options.getString('action');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { anti_alt_enabled: enabled };
  if (minAgeDays) patch.anti_alt_min_age_days = minAgeDays;
  if (action) patch.anti_alt_action = action;
  const saved = await upsertConfig(interaction.guild.id, patch);

  const text = `${EMOJI.APPROVE}  Anti-alt ${enabled ? 'enabled' : 'disabled'}.\n**Minimum account age:** ${saved.anti_alt_min_age_days}d\n**Action:** ${saved.anti_alt_action}`;
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function antinuke(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const threshold = interaction.options.getInteger('threshold');
  const windowSeconds = interaction.options.getInteger('window_seconds');

  if (enabled && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Enabling anti-nuke requires **Administrator** — it can strip roles or ban accounts automatically.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const patch = { enabled };
  if (threshold) patch.action_threshold = threshold;
  if (windowSeconds) patch.window_seconds = windowSeconds;
  const saved = await upsertAntinukeConfig(interaction.guild.id, patch);

  const text = `${EMOJI.APPROVE}  Anti-nuke ${enabled ? 'enabled' : 'disabled'}.\n**Threshold:** ${saved.action_threshold} destructive actions in ${saved.window_seconds}s\nResponds by banning a bot executor, or stripping all roles from a human executor. The server owner is never auto-actioned.`;
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function immune(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const config = await getConfig(interaction.guild.id);
    const ids = config?.immune_role_ids ?? [];
    const text = ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : 'No immune roles configured.';
    await interaction.editReply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.options.getRole('role', true);
  if (sub === 'add') {
    await addImmuneRole(interaction.guild.id, role.id);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role} is now immune to automod.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } else {
    await removeImmuneRole(interaction.guild.id, role.id);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role} is no longer immune to automod.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function antinukeWhitelist(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const config = await getAntinukeConfig(interaction.guild.id);
    const ids = config?.whitelist_ids ?? [];
    const text = ids.length ? ids.map((id) => `<@${id}>`).join(' ') : 'No whitelisted users/bots.';
    await interaction.editReply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const user = interaction.options.getUser('user', true);
  if (sub === 'add') {
    await addWhitelist(interaction.guild.id, user.id);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${user} is now exempt from anti-nuke tracking.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } else {
    await removeWhitelist(interaction.guild.id, user.id);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${user} removed from the anti-nuke whitelist.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  }
}
