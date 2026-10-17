const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
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

// The permissions a purge needs, by their flag name (shown with the `core.perm.*` names).
const NEEDED = ['ViewChannel', 'ReadMessageHistory', 'ManageMessages'];

module.exports = {
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
    .addStringOption((opt) => opt.setName('after').setDescription('Only messages newer than this one (ID or link)').setRequired(false)),

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

    if ((beforeRaw && !beforeId) || (afterRaw && !afterId)) {
      await interaction.reply({ ...noticePayload(t(lang, 'moderation.purge.badMessage', { value: String(beforeRaw && !beforeId ? beforeRaw : afterRaw).slice(0, 80) }), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    if (!PURGE_FILTERS.includes(filter)) {
      await interaction.reply({ ...noticePayload(t(lang, 'moderation.purge.unknownFilter', { list: PURGE_FILTERS.map((name) => `\`${name}\``).join(', ') }), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    const missingFor = (who) => NEEDED.filter((flag) => !channel.permissionsFor(who)?.has(PermissionFlagsBits[flag])).map((flag) => t(lang, `core.perm.${flag}`));
    const youMissing = missingFor(interaction.member);
    if (youMissing.length) {
      await interaction.reply({ content: t(lang, 'moderation.purge.youNeed', { permissions: youMissing.join(', ') }), flags: MessageFlags.Ephemeral });
      return;
    }
    const meMissing = missingFor(interaction.guild.members.me);
    if (meMissing.length) {
      await interaction.reply({ content: t(lang, 'moderation.purge.iNeed', { permissions: meMissing.join(', ') }), flags: MessageFlags.Ephemeral });
      return;
    }

    // The command message itself must not count towards the scan.
    await interaction.rawMessage?.delete().catch(() => {});
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

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

    const options = { userId: user?.id ?? null, filter, text, startsWith, endsWith, beforeId, afterId };
    const matching = scanned.filter((message) => matchesPurge(message, options));
    const pinnedKept = scanned.filter((message) => message.pinned && matchesPurge(message, { ...options, includePinned: true })).length;
    if (filter === 'reactions') {
      await clearReactions(interaction, { lang, scanned, matching });
      return;
    }

    const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
    const deletable = matching.filter((message) => message.createdTimestamp > cutoff);
    const tooOld = matching.length - deletable.length;

    let deleted = 0;
    for (let index = 0; index < deletable.length; index += 100) {
      const chunk = deletable.slice(index, index + 100);
      const result = await (chunk.length === 1 ? chunk[0].delete().then(() => [chunk[0]]) : channel.bulkDelete(chunk, true).then((done) => [...done.values()])).catch((err) => {
        logger.warn(`Purge failed to delete messages in ${channel.id}: ${err.message}`);
        return [];
      });
      deleted += result.length;
    }

    const filters = describeFilters({ lang, filter, user, text, startsWith, endsWith, beforeId, afterId });
    const sent = await interaction.editReply(infoPayload({
      accent: deleted ? COLORS.GREEN : COLORS.DEFAULT,
      title: `${deleted ? EMOJI.APPROVE : EMOJI.RELEASE_MINUS} ${deleted ? tn(lang, 'moderation.purge.deleted', deleted, { count: deleted }) : t(lang, 'moderation.purge.nothing')}`,
      subtitle: [`${tn(lang, 'moderation.purge.scanned', scanned.length, { count: scanned.length })}${filters ? ` · ${filters}` : ''}`],
      sections: [{
        lines: [
          tooOld ? line(t(lang, 'moderation.purge.tooOld'), t(lang, 'moderation.purge.tooOldValue', { count: tooOld })) : null,
          pinnedKept ? line(t(lang, 'moderation.purge.pinnedKept'), pinnedKept) : null,
          deletable.length - deleted > 0 ? line(t(lang, 'moderation.purge.couldNotDelete'), deletable.length - deleted) : null,
        ],
      }],
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

/** `purge reactions`: the messages stay, their reactions go. */
async function clearReactions(interaction, { lang, scanned, matching }) {
  let cleared = 0;
  for (const message of matching) {
    const ok = await message.reactions.removeAll().then(() => true).catch((err) => {
      logger.warn(`Purge could not remove reactions in ${interaction.channel.id}: ${err.message}`);
      return false;
    });
    if (ok) cleared += 1;
  }
  const sent = await interaction.editReply(infoPayload({
    accent: cleared ? COLORS.GREEN : COLORS.DEFAULT,
    title: `${cleared ? EMOJI.APPROVE : EMOJI.RELEASE_MINUS} ${cleared ? tn(lang, 'moderation.purge.reactionsCleared', cleared, { count: cleared }) : t(lang, 'moderation.purge.noReactions')}`,
    subtitle: [tn(lang, 'moderation.purge.scanned', scanned.length, { count: scanned.length })],
    sections: [{ lines: [matching.length - cleared > 0 ? line(t(lang, 'moderation.purge.couldNotClear'), matching.length - cleared) : null] }],
  }));
  if (interaction.rawMessage && sent?.delete) setTimeout(() => sent.delete().catch(() => {}), RESULT_LIFETIME_MS).unref?.();
}
