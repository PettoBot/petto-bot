const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
} = require('discord.js');
const { getTemplate } = require('../db/embedTemplates');
const { isV2 } = require('./embedV2');
const { templatePayload } = require('./templatedMessage');

const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];
const BAR_LENGTH = 12;
const OPEN_COLOR = 0xf0a88f;
const CLOSED_COLOR = 0x8b8fa3;

function bar(pct) {
  const filled = Math.round((pct / 100) * BAR_LENGTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
}

function percentOf(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** The options that lead (more than zero votes), more than one when they tie. */
function leaders(poll, results) {
  const counts = poll.options.map((_, i) => results.counts[i] ?? 0);
  const top = Math.max(0, ...counts);
  return top > 0 ? counts.map((count, i) => (count === top ? i : -1)).filter((i) => i >= 0) : [];
}

function typeText(poll) {
  return poll.multi ? 'Multiple choice' : 'Single choice';
}

function endsAtUnix(poll) {
  if (!poll.ends_at) return null;
  const ms = new Date(poll.ends_at).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** One block per option: its letter and text, then the bar with its percentage and votes. A closed poll marks the option that won. */
function resultBlocks(poll, results) {
  const total = results.voters;
  const winners = poll.closed ? new Set(leaders(poll, results)) : new Set();
  return poll.options.map((option, i) => {
    const count = results.counts[i] ?? 0;
    return `${LETTERS[i]} **${option}**${winners.has(i) ? ' 🏆' : ''}\n${bar(percentOf(count, total))}  ${percentOf(count, total)}% (${count})`;
  });
}

const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** Builds the poll's default card (Components V2: header, a line, the options with their bars, a line, the votes) from its tallies. */
function buildPollCard(poll, results) {
  const total = results.voters;
  const ends = endsAtUnix(poll);
  const meta = [typeText(poll), poll.closed ? 'closed' : ends ? `closes <t:${ends}:R>` : null].filter(Boolean).join(' · ');

  const container = new ContainerBuilder()
    .setAccentColor(poll.closed ? CLOSED_COLOR : OPEN_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 📊 ${poll.question}\n-# ${meta}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(resultBlocks(poll, results).join('\n\n')));

  if (poll.image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(poll.image)));
  }
  container
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${total} vote${total === 1 ? '' : 's'} · ${poll.closed ? 'closed' : 'open'}`));

  return { components: [container], rows: poll.closed ? [] : voteRows(poll) };
}

/** The vote buttons (five to a row) and the End poll button, shared by the default card and by a saved design. */
function voteRows(poll) {
  const rows = [];
  for (let i = 0; i < poll.options.length; i += 5) {
    const row = new ActionRowBuilder();
    poll.options.slice(i, i + 5).forEach((_, j) => {
      const idx = i + j;
      row.addComponents(new ButtonBuilder().setCustomId(`plv_vote::${poll.id}::${idx}`).setLabel(`${idx + 1}`).setEmoji(LETTERS[idx]).setStyle(ButtonStyle.Secondary));
    });
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`plv_close::${poll.id}`).setLabel('End poll').setStyle(ButtonStyle.Danger)));
  return rows;
}

/** What the {poll.*} variables of a saved design resolve to. */
function pollContext(poll, results) {
  const total = results.voters;
  const lead = leaders(poll, results);
  return {
    question: poll.question,
    options: poll.options.map((option, i) => `${LETTERS[i]} ${option}`).join('\n'),
    results: resultBlocks({ ...poll, closed: false }, results).join('\n\n'),
    votes: total,
    votesText: `${total} vote${total === 1 ? '' : 's'}`,
    type: typeText(poll),
    status: poll.closed ? 'Closed' : 'Open',
    endsAtUnix: endsAtUnix(poll),
    image: poll.image ?? '',
    hostId: poll.creator_id ?? null,
    winner: lead.length === 1 ? poll.options[lead[0]] : '',
  };
}

/** Whether a saved embed can be the design of a poll: it has to exist and be a Components V2 design. */
async function checkPollTemplate(guildId, name) {
  const doc = await getTemplate(guildId, name);
  if (!doc?.data) return 'missing';
  return isV2(doc.data) ? 'ok' : 'not_v2';
}

/**
 * The whole message of a poll, ready to send or edit: the saved design when the poll has one (with the vote buttons added
 * under it), otherwise the default card. A design that is missing, empty, or not Components V2 falls back to the card.
 */
async function buildPollMessage({ guild, poll, results }) {
  if (poll.embed_template && guild) {
    const payload = await templatePayload(guild.id, poll.embed_template, { guild, poll: pollContext(poll, results) });
    if (payload?.flags && payload.components?.length) {
      return { components: [...payload.components, ...(poll.closed ? [] : voteRows(poll))], flags: payload.flags, allowedMentions: { parse: [] } };
    }
  }
  const card = buildPollCard(poll, results);
  return { components: [...card.components, ...card.rows], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

// Polls posted before the V2 card are classic messages, and Discord will not turn those into V2: they keep their
// message while they are open and only lose their buttons when they close.
async function updatePollMessage(message, { guild, poll, results }) {
  if (message.flags?.has?.(MessageFlags.IsComponentsV2)) return message.edit(await buildPollMessage({ guild, poll, results }));
  if (poll.closed) return message.edit({ components: [] });
  return null;
}

module.exports = { updatePollMessage, buildPollCard, buildPollMessage, pollContext, checkPollTemplate, voteRows };
