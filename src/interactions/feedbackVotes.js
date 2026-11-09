// The Like and Dislike buttons under each post of the feedback board (feedback/card.js). Pressing one is the vote of that person, the same
// one they would give on the website: one vote per person, the other button changes it and pressing the same one again takes it back.
// The card is drawn again with the new numbers and only the person sees what happened.
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const db = require('../db/feedback');
const service = require('../feedback/service');
const { EMOJI, VOTE_PREFIX, parseVoteId, safe } = require('../feedback/card');
const config = require('../config');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const PRIVATE = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const PER_HOUR = 120; // a person cannot press the buttons without end
const pressed = new Map();

/** Whether this person has pressed too many times in the last hour (kept in memory, enough to slow a flood down). */
function tooMany(userId, now = Date.now()) {
  const recent = (pressed.get(userId) ?? []).filter((time) => now - time < 3_600_000);
  if (recent.length >= PER_HOUR) { pressed.set(userId, recent); return true; }
  recent.push(now);
  pressed.set(userId, recent);
  return false;
}

const mention = (emoji) => `<:${emoji.name}:${emoji.id}>`;

/** A small private message in Components V2: a title, a line and a text. */
function notice(title, text) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return { components: [container], flags: PRIVATE, allowedMentions: { parse: [] } };
}

/** What the person is told (only they see it) after their vote was saved. */
function confirmation(lang, vote, title) {
  const name = `**${safe(title, 80)}**`;
  if (vote === 1) return notice(t(lang, 'feedback.vote.saved'), t(lang, 'feedback.vote.liked', { emoji: mention(EMOJI.like), title: name }));
  if (vote === -1) return notice(t(lang, 'feedback.vote.saved'), t(lang, 'feedback.vote.disliked', { emoji: mention(EMOJI.dislike), title: name }));
  return notice(t(lang, 'feedback.vote.taken'), t(lang, 'feedback.vote.takenText', { title: name }));
}

/** Handles one press: the vote (with toggle), the card drawn again and the private answer. `deps` lets a test replace the database. */
async function vote({ customId, user, lang }, deps = {}) {
  const store = deps.db ?? db;
  const parsed = parseVoteId(customId);
  if (!parsed) return { ignored: 'id' };
  if (!user?.id || user.bot) return { ignored: 'user' };
  if (tooMany(user.id)) return { postId: parsed.postId, reply: notice(t(lang, 'feedback.vote.failedTitle'), t(lang, 'feedback.vote.rate')) };
  const post = await store.getPost(parsed.postId);
  if (!post) return { postId: parsed.postId, reply: notice(t(lang, 'feedback.vote.failedTitle'), t(lang, 'feedback.vote.gone')) };
  const before = await store.currentVote(parsed.postId, user.id);
  const value = before === parsed.value ? 0 : parsed.value;
  await store.setVote(parsed.postId, user.id, value);
  const fresh = (await store.getPost(parsed.postId)) ?? post;
  return { postId: parsed.postId, vote: value, post: fresh, reply: confirmation(lang, value, fresh.title) };
}

async function handleButton(interaction) {
  if (!parseVoteId(interaction.customId)) return;
  // The card is the message of the button: it is edited at once with the new numbers (the answer to the press).
  await interaction.deferUpdate().catch(() => null);
  const lang = await languageOf(interaction);
  try {
    const result = await vote({ customId: interaction.customId, user: interaction.user, lang });
    if (result.post) await interaction.message.edit(service.cardOf(result.post)).catch((error) => logger.warn(`The card of feedback post ${result.postId} could not be drawn again: ${error.message}`));
    if (result.reply) await interaction.followUp(result.reply).catch(() => null);
  } catch (error) {
    logger.warn(`A feedback vote could not be saved: ${error.message}`);
    await interaction.followUp(notice(t(lang, 'feedback.vote.failedTitle'), t(lang, 'feedback.vote.failed', { url: `${config.siteUrl}/feedback` }))).catch(() => null);
  }
}

module.exports = { PREFIX: VOTE_PREFIX, handleButton, vote, confirmation, notice, tooMany };
