const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { matchesPurge, PURGE_FILTERS, messageIdOf, purgePrefixArgs } = require('../../utils/purgeFilters');
const { noticePayload, infoPayload, line } = require('../../utils/infoCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const MAX_SCAN = 500;
const DEFAULT_SCAN = 100;
const FETCH_PAGE = 100;
// Discord refuses to bulk delete messages older than two weeks.
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const RESULT_LIFETIME_MS = 8_000;
// `all_channels` goes through the text channels of the server, up to this many, and waits for a confirmation this long.
const MAX_ALL_CHANNELS = 100;
const MAX_ALL_THREADS = 100;
// Asking Discord for the open threads must not take the three seconds that a command has to answer.
const THREADS_WAIT_MS = 2_000;
const CONFIRM_MS = 60_000;
const CHANNEL_LINES = 10;

// The permissions a purge needs, by their flag name (shown with the `core.perm.*` names).
const NEEDED = ['ViewChannel', 'ReadMessageHistory', 'ManageMessages'];

module.exports = {
  // A slash command of its own again (`/purge`): `/mod` is not a slash command any more. The prefix is as before.
  registerSlash: true,
  aliases: ['prune'],
  prefixArgs: purgePrefixArgs,
  // Written after the prefix, the text takes every word left; the other text options are given with --starts_with, --before...
  prefixGreedyStringOptions: { _: 'text' },
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Scan recent messages in this channel and delete the ones that match.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((opt) => opt.setName('amount').setDescription('How many recent messages to scan (1-500, default 100)').setRequired(false).setMinValue(1).setMaxValue(MAX_SCAN))
    .addUserOption((opt) => opt.setName('user').setDescription('Only messages from this member').setRequired(false))
    .addStringOption((opt) => opt
      .setName('filter')
      .setDescription('Only this kind of message (default: all)')
      .setRequired(false)
      .addChoices(...PURGE_FILTERS.map((name) => ({ name, value: name }))))
    .addStringOption((opt) => opt.setName('text').setDescription('Only messages containing this text').setRequired(false).setMaxLength(100))
    .addStringOption((opt) => opt.setName('starts_with').setDescription('Only messages that start with this text').setRequired(false).setMaxLength(100))
    .addStringOption((opt) => opt.setName('ends_with').setDescription('Only messages that end with this text').setRequired(false).setMaxLength(100))
    .addStringOption((opt) => opt.setName('before').setDescription('Only messages older than this one (ID or link)').setRequired(false))
    .addStringOption((opt) => opt.setName('after').setDescription('Only messages newer than this one (ID or link)').setRequired(false))
    .addBooleanOption((opt) => opt.setName('all_channels').setDescription('Scan every text channel of the server, not only this one (asks to confirm first)').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const user = interaction.options.getUser('user');
    const filter = interaction.options.getString('filter') ?? 'all';
    const text = interaction.options.getString('text')?.trim() || null;
    const startsWith = interaction.options.getString('starts_with')?.trim() || null;
    const endsWith = interaction.options.getString('ends_with')?.trim() || null;
    const beforeRaw = interaction.options.getString('before');
    const afterRaw = interaction.options.getString('after');
    const beforeId = beforeRaw ? messageIdOf(beforeRaw) : null;
    const afterId = afterRaw ? messageIdOf(afterRaw) : null;
    // With a start message and no amount, everything after it is scanned (up to the limit).
    const amount = Math.min(MAX_SCAN, Math.max(1, interaction.options.getInteger('amount') ?? (afterId ? MAX_SCAN : DEFAULT_SCAN)));
    const channel = interaction.channel;
    const allChannels = interaction.options.getBoolean('all_channels') ?? false;

    if ((beforeRaw && !beforeId) || (afterRaw && !afterId)) {
      await interaction.reply({ ...noticePayload(t(lang, 'moderation.purge.badMessage', { value: String(beforeRaw && !beforeId ? beforeRaw : afterRaw).slice(0, 80) }), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    if (!PURGE_FILTERS.includes(filter)) {
      await interaction.reply({ ...noticePayload(t(lang, 'moderation.purge.unknownFilter', { list: PURGE_FILTERS.map((name) => `\`${name}\``).join(', ') }), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    const missingIn = (target, who) => NEEDED.filter((flag) => !target.permissionsFor(who)?.has(PermissionFlagsBits[flag])).map((flag) => t(lang, `core.perm.${flag}`));
    let targets = [channel];
    let skipped = 0;
    let notScanned = 0;
    if (allChannels) {
      // Every text channel where the member and Petto both can read, see the history and delete. The others are left out and counted.
      const all = [...interaction.guild.channels.cache.values()].filter((candidate) => candidate.isTextBased() && !candidate.isThread() && !candidate.isDMBased() && candidate.messages);
      // The open threads too, and with them the posts of the forums (a post is a thread): they are not in the list of channels. An archived thread cannot be written
      // in until it is opened again, so it is left alone.
      const threads = await activeThreads(interaction.guild);
      const allowed = (candidate) => !missingIn(candidate, interaction.member).length && !missingIn(candidate, interaction.guild.members.me).length;
      const usable = all.filter(allowed);
      const usableThreads = threads.filter(allowed);
      skipped = all.length - usable.length + threads.length - usableThreads.length;
      targets = [...usable.slice(0, MAX_ALL_CHANNELS), ...usableThreads.slice(0, MAX_ALL_THREADS)];
      notScanned = usable.length - Math.min(usable.length, MAX_ALL_CHANNELS) + usableThreads.length - Math.min(usableThreads.length, MAX_ALL_THREADS);
      if (!targets.length) {
        await interaction.reply({ content: t(lang, 'moderation.purge.noChannels', { permissions: NEEDED.map((flag) => t(lang, `core.perm.${flag}`)).join(', ') }), flags: MessageFlags.Ephemeral });
        return;
      }
    } else {
      const youMissing = missingIn(channel, interaction.member);
      if (youMissing.length) {
        await interaction.reply({ content: t(lang, 'moderation.purge.youNeed', { permissions: youMissing.join(', ') }), flags: MessageFlags.Ephemeral });
        return;
      }
      const meMissing = missingIn(channel, interaction.guild.members.me);
      if (meMissing.length) {
        await interaction.reply({ content: t(lang, 'moderation.purge.iNeed', { permissions: meMissing.join(', ') }), flags: MessageFlags.Ephemeral });
        return;
      }
    }

    // The command message itself must not count towards the scan.
    // Both requests go out together: deleting the command message does not have to wait for the acknowledgement (or the other way round).
    await Promise.all([
      interaction.rawMessage?.delete().catch(() => {}),
      interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }),
    ]);

    const options = { userId: user?.id ?? null, filter, text, startsWith, endsWith, beforeId, afterId };
    const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
    const results = [];
    for (const target of targets) {
      const scanned = await scanChannel(target, { amount, beforeId, afterId });
      const matching = scanned.filter((message) => matchesPurge(message, options));
      results.push({
        channel: target,
        scanned: scanned.length,
        matching,
        deletable: matching.filter((message) => message.createdTimestamp > cutoff),
        pinnedKept: scanned.filter((message) => message.pinned && matchesPurge(message, { ...options, includePinned: true })).length,
      });
    }
    const filters = describeFilters({ lang, filter, user, text, startsWith, endsWith, beforeId, afterId });

    // Deleting in the whole server cannot be undone: it shows what it would delete in each channel and waits for a click.
    if (allChannels) {
      const proceed = await confirmAllChannels(interaction, { lang, results, filters, filter, skipped, notScanned });
      if (!proceed) return;
    }

    if (filter === 'reactions') {
      await clearReactions(interaction, { lang, results, allChannels });
      return;
    }

    let deleted = 0;
    for (const result of results) { result.deleted = await deleteIn(result.channel, result.deletable); deleted += result.deleted; }
    const matchingTotal = sum(results, (result) => result.matching.length);
    const deletableTotal = sum(results, (result) => result.deletable.length);
    const tooOld = matchingTotal - deletableTotal;
    const pinnedKept = sum(results, (result) => result.pinnedKept);
    const scannedTotal = sum(results, (result) => result.scanned);
    // In the whole server, the channels that lost messages are listed (the biggest first).
    const channelLines = allChannels ? await perChannelLines(results, lang, (result) => result.deleted) : [];

    const sent = await interaction.editReply(infoPayload({
      accent: deleted ? COLORS.GREEN : COLORS.DEFAULT,
      title: `${deleted ? EMOJI.APPROVE : EMOJI.RELEASE_MINUS} ${deleted ? tn(lang, 'moderation.purge.deleted', deleted, { count: deleted }) : t(lang, 'moderation.purge.nothing')}`,
      subtitle: [`${tn(lang, 'moderation.purge.scanned', scannedTotal, { count: scannedTotal })}${allChannels ? ` · ${tn(lang, 'moderation.purge.inChannels', targets.length, { count: targets.length })}` : ''}${filters ? ` · ${filters}` : ''}`],
      sections: [{
        lines: [
          tooOld ? line(t(lang, 'moderation.purge.tooOld'), t(lang, 'moderation.purge.tooOldValue', { count: tooOld })) : null,
          pinnedKept ? line(t(lang, 'moderation.purge.pinnedKept'), pinnedKept) : null,
          deletableTotal - deleted > 0 ? line(t(lang, 'moderation.purge.couldNotDelete'), deletableTotal - deleted) : null,
          allChannels && skipped ? line(t(lang, 'moderation.purge.skippedChannels'), skipped) : null,
          allChannels && notScanned ? line(t(lang, 'moderation.purge.notScanned'), notScanned) : null,
        ],
      }, ...(channelLines.length ? [{ title: t(lang, 'moderation.purge.byChannel'), lines: channelLines }] : [])],
    }));

    // Prefix commands answer in the channel, where the confirmation would stay forever; slash replies are already private.
    if (interaction.rawMessage && sent?.delete) setTimeout(() => sent.delete().catch(() => {}), RESULT_LIFETIME_MS).unref?.();
  },
};

/** What a purge looked for, in one line: the kind, the member, the text and the range. */
function describeFilters({ lang, filter, user, text, startsWith, endsWith, beforeId, afterId }) {
  return [
    filter !== 'all' ? `**${filter}**` : null,
    user ? t(lang, 'moderation.purge.from', { user: `${user}` }) : null,
    text ? t(lang, 'moderation.purge.containing', { text }) : null,
    startsWith ? t(lang, 'moderation.purge.startingWith', { text: startsWith }) : null,
    endsWith ? t(lang, 'moderation.purge.endingWith', { text: endsWith }) : null,
    afterId ? t(lang, 'moderation.purge.afterMessage', { id: afterId }) : null,
    beforeId ? t(lang, 'moderation.purge.beforeMessage', { id: beforeId }) : null,
  ].filter(Boolean).join(' · ');
}

/** The open threads of the server (and the posts of its forums), where messages can be read and deleted. Empty when Discord does not answer in time. */
async function activeThreads(guild) {
  if (typeof guild.channels?.fetchActiveThreads !== 'function') return [];
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), THREADS_WAIT_MS).unref?.(); });
  const found = await Promise.race([guild.channels.fetchActiveThreads().catch(() => null), timeout]);
  return found ? [...found.threads.values()].filter((thread) => !thread.archived && thread.messages) : [];
}

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

/** The newest `amount` messages of a channel (from `beforeId`, and no further back than `afterId`). A channel that cannot be read gives what was read before. */
async function scanChannel(channel, { amount, beforeId, afterId }) {
  const scanned = [];
  let before = beforeId ?? undefined;
  while (scanned.length < amount) {
    const page = await channel.messages.fetch({ limit: Math.min(FETCH_PAGE, amount - scanned.length), ...(before ? { before } : {}) }).catch((err) => {
      logger.warn(`Purge could not read messages in ${channel.id}: ${err.message}`);
      return null;
    });
    if (!page?.size) break;
    const values = [...page.values()];
    // Pages come newest first: once a message is at or before the start message, nothing older is needed.
    const reachedStart = afterId ? values.findIndex((message) => BigInt(message.id) <= BigInt(afterId)) : -1;
    scanned.push(...(reachedStart >= 0 ? values.slice(0, reachedStart) : values));
    if (reachedStart >= 0) break;
    before = page.last().id;
    if (page.size < FETCH_PAGE) break;
  }
  return scanned;
}

/** Deletes messages in a channel, 100 at a time (one by one when it is a single message); returns how many went. */
async function deleteIn(channel, messages) {
  let deleted = 0;
  for (let index = 0; index < messages.length; index += 100) {
    const chunk = messages.slice(index, index + 100);
    const result = await (chunk.length === 1 ? chunk[0].delete().then(() => [chunk[0]]) : channel.bulkDelete(chunk, true).then((done) => [...done.values()])).catch((err) => {
      logger.warn(`Purge failed to delete messages in ${channel.id}: ${err.message}`);
      return [];
    });
    deleted += result.length;
  }
  return deleted;
}

/** `#channel: 12` lines for the channels with something, the biggest first, as many as fit. `count` reads the number of a result. */
async function perChannelLines(results, lang, count) {
  const withCount = results.map((result) => ({ result, number: count(result) })).filter((entry) => entry.number > 0).sort((a, b) => b.number - a.number);
  const lines = withCount.slice(0, CHANNEL_LINES).map((entry) => line(`<#${entry.result.channel.id}>`, entry.number));
  if (withCount.length > CHANNEL_LINES) lines.push(t(lang, 'moderation.purge.andMoreChannels', { count: withCount.length - CHANNEL_LINES }));
  return lines;
}

/**
 * The question before a purge of the whole server: what it would delete in each channel, with Confirm and Cancel.
 * Answers true when it was confirmed. Nothing is deleted before; on Cancel or no answer the card says so and this answers false.
 */
async function confirmAllChannels(interaction, { lang, results, filters, filter, skipped, notScanned }) {
  const reactions = filter === 'reactions';
  const total = sum(results, (result) => (reactions ? result.matching.length : result.deletable.length));
  const scannedTotal = sum(results, (result) => result.scanned);
  const lines = await perChannelLines(results, lang, (result) => (reactions ? result.matching.length : result.deletable.length));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('purge_confirm').setLabel(t(lang, 'moderation.bulk.confirm.button')).setStyle(ButtonStyle.Danger).setDisabled(!total),
    new ButtonBuilder().setCustomId('purge_cancel').setLabel(t(lang, 'moderation.bulk.cancel.button')).setStyle(ButtonStyle.Secondary),
  );
  const question = infoPayload({
    accent: COLORS.DEFAULT,
    rows: [row],
    title: `${EMOJI.WARNING} ${total ? tn(lang, reactions ? 'moderation.purge.askReactions' : 'moderation.purge.ask', total, { count: total, channels: results.length }) : t(lang, 'moderation.purge.nothing')}`,
    subtitle: [`${tn(lang, 'moderation.purge.scanned', scannedTotal, { count: scannedTotal })} · ${tn(lang, 'moderation.purge.inChannels', results.length, { count: results.length })}${filters ? ` · ${filters}` : ''}`],
    sections: [
      ...(lines.length ? [{ title: t(lang, 'moderation.purge.byChannel'), lines }] : []),
      ...(skipped || notScanned ? [{ lines: [skipped ? line(t(lang, 'moderation.purge.skippedChannels'), skipped) : null, notScanned ? line(t(lang, 'moderation.purge.notScanned'), notScanned) : null] }] : []),
    ],
  });
  const prompt = await interaction.editReply(question);
  const close = (key) => interaction.editReply(noticePayload(t(lang, key, { emoji: EMOJI.DENY }), COLORS.RED)).catch(() => {});
  let click;
  try {
    click = await prompt.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: CONFIRM_MS });
  } catch {
    await close('moderation.purge.timedOut');
    return false;
  }
  if (click.customId !== 'purge_confirm') {
    await click.update(noticePayload(t(lang, 'moderation.purge.cancelled', { emoji: EMOJI.DENY }), COLORS.RED)).catch(() => {});
    return false;
  }
  await click.update(noticePayload(t(lang, 'moderation.purge.working', { emoji: EMOJI.APPROVE }), COLORS.GREEN)).catch(() => {});
  return true;
}

/** `purge reactions`: the messages stay, their reactions go. */
async function clearReactions(interaction, { lang, results, allChannels }) {
  let cleared = 0;
  const found = sum(results, (result) => result.matching.length);
  for (const result of results) {
    result.cleared = 0;
    for (const message of result.matching) {
      const ok = await message.reactions.removeAll().then(() => true).catch((err) => {
        logger.warn(`Purge could not remove reactions in ${result.channel.id}: ${err.message}`);
        return false;
      });
      if (ok) { cleared += 1; result.cleared += 1; }
    }
  }
  const scannedTotal = sum(results, (result) => result.scanned);
  const channelLines = allChannels ? await perChannelLines(results, lang, (result) => result.cleared) : [];
  const sent = await interaction.editReply(infoPayload({
    accent: cleared ? COLORS.GREEN : COLORS.DEFAULT,
    title: `${cleared ? EMOJI.APPROVE : EMOJI.RELEASE_MINUS} ${cleared ? tn(lang, 'moderation.purge.reactionsCleared', cleared, { count: cleared }) : t(lang, 'moderation.purge.noReactions')}`,
    subtitle: [tn(lang, 'moderation.purge.scanned', scannedTotal, { count: scannedTotal })],
    sections: [{ lines: [found - cleared > 0 ? line(t(lang, 'moderation.purge.couldNotClear'), found - cleared) : null] }, ...(channelLines.length ? [{ title: t(lang, 'moderation.purge.byChannel'), lines: channelLines }] : [])],
  }));
  if (interaction.rawMessage && sent?.delete) setTimeout(() => sent.delete().catch(() => {}), RESULT_LIFETIME_MS).unref?.();
}
