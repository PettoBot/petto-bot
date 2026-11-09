// i18n-ignore-file: logs of the feedback board
// The feedback board in Discord, done by Petto itself (it used to be a second bot, `feed`): each post of petto.sbs/feedback is published in a
// channel of the Petto server as a card (card.js), kept up to date when the votes, the comments or the state change, and deleted with the post.
// The website asks for it (web/feedbackBoardRoutes.js) and the Like and Dislike buttons are handled by interactions/feedbackVotes.js.
const { Routes } = require('discord.js');
const config = require('../config');
const db = require('../db/feedback');
const logger = require('../utils/logger');
const { buildPost } = require('./card');

const missing = (error) => error?.status === 404 || error?.code === 10008 || error?.code === 10003;
// A message written by another bot cannot be edited (the cards the old `feed` bot published): code 50005.
const notOurs = (error) => error?.code === 50005;

const channelOf = (post) => post?.discord_channel_id || config.feedbackChannelId;

/** Whether the board can publish in Discord (the channel is set). */
const enabled = () => Boolean(config.feedbackChannelId);

function cardOf(post) {
  return buildPost(post, config.siteUrl);
}

/** Sends the card of a post to the channel and remembers where it is. Returns `{ channelId, messageId }`. */
async function publish(client, post) {
  if (!enabled()) return null;
  const message = await client.rest.post(Routes.channelMessages(config.feedbackChannelId), { body: cardOf(post) });
  await db.saveMessage(post.id, message.channel_id ?? config.feedbackChannelId, message.id).catch((error) => logger.warn(`The card of feedback post ${post.id} could not be remembered: ${error.message}`));
  return { channelId: message.channel_id ?? config.feedbackChannelId, messageId: message.id };
}

/**
 * Draws the card of a post again with its new numbers. A card that is gone is published again, and one that another bot wrote (the cards
 * of the old `feed` bot) is deleted when it can be and published again as Petto's own, since only the author of a message can edit it.
 */
async function update(client, post) {
  if (!enabled()) return null;
  if (!post.discord_message_id) return publish(client, post);
  const channelId = channelOf(post);
  const route = Routes.channelMessage(channelId, post.discord_message_id);
  try {
    const message = await client.rest.patch(route, { body: cardOf(post) });
    return { channelId: message.channel_id ?? channelId, messageId: message.id };
  } catch (error) {
    if (missing(error)) return publish(client, post);
    if (notOurs(error)) {
      await client.rest.delete(route).catch(() => null);
      return publish(client, post);
    }
    throw error;
  }
}

/** Deletes the card of a post. */
async function remove(client, post) {
  if (!enabled() || !post?.discord_message_id) return null;
  await client.rest.delete(Routes.channelMessage(channelOf(post), post.discord_message_id)).catch((error) => { if (!missing(error)) throw error; });
  return null;
}

/** Draws again the card of every post that has one (after the old bot is turned off, so every card is Petto's and its buttons answer). Returns how many. */
async function republishAll(client, { pauseMs = 1200 } = {}) {
  let count = 0;
  for (const post of (await db.postsWithCard()).reverse()) {
    try {
      await update(client, post);
      count += 1;
    } catch (error) {
      logger.warn(`The card of feedback post ${post.id} could not be drawn again: ${error.message}`);
    }
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return count;
}

module.exports = { enabled, publish, update, remove, republishAll, cardOf };
