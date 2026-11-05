// The routes of the vote webhooks (top.gg and omniplex.gg): check the signature, store the vote once, start the vote boost at once,
// give the voter role and thank the voter in the vote channel.
const config = require('../config');
const { sendAs } = require('./senderIdentity');
const votesDb = require('../db/votes');
const topgg = require('./topgg');
const omniplex = require('./omniplexVotes');
const { voteUrl, listName } = require('./voteLists');
const { noteVote, expiryOfVote, VOTE_BOOST_PERCENT, VOTE_BOOST_HOURS } = require('./voteBoost');
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { grantVoteRole } = require('./voteRole');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

async function thank(client, vote) {
  if (!config.voteChannelId) return;
  const channel = await client.channels.fetch(config.voteChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const [{ mine, total }, user] = await Promise.all([votesDb.voteTotals(vote.userId), client.users.fetch(vote.userId).catch(() => null)]);
  const link = voteUrl(vote.source, client.user?.id ?? config.clientId);
  // The thanks are posted in a server's channel, in that server's language (a webhook has no language of its own).
  const lang = await guildLanguage(channel.guildId ?? channel.guild?.id);
  // The counts are written as plain numbers, as they always were, so the plural form is picked here instead of with tn().
  const form = (count) => (Number(count) === 1 ? 'one' : 'other');
  const text = [
    `<@${vote.userId}>`,
    t(lang, 'votes.thanks.title', { name: user?.displayName ?? user?.username ?? t(lang, 'votes.thanks.someone'), list: listName(vote.source) }),
    t(lang, `votes.thanks.${vote.weight > 1 ? 'timesDouble' : 'times'}.${form(mine)}`, { count: mine, weight: vote.weight }),
    t(lang, 'votes.thanks.every', { link, list: listName(vote.source) }),
    t(lang, 'votes.thanks.boost', { percent: VOTE_BOOST_PERCENT, hours: VOTE_BOOST_HOURS }),
    t(lang, `votes.thanks.total.${form(total)}`, { count: total }),
  ].join('\n');
  const body = new TextDisplayBuilder().setContent(text);
  const container = new ContainerBuilder().setAccentColor(0xa5ea7a);
  const avatar = user?.displayAvatarURL?.({ size: 128 });
  if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(body).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else container.addTextDisplayComponents(body);
  container
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${vote.userId} | <t:${Math.floor(new Date(vote.votedAt).getTime() / 1000)}:f>`));
  await sendAs(channel, 'votes', {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [vote.userId] },
  }).catch((err) => logger.warn('Could not thank a voter:', err.message));
}

/** What follows a vote that was stored: the boost starts now, the voter gets the role, and the thanks go out. */
async function afterVote(client, vote, isNew) {
  // Also for a vote that arrives again: the expiry is the same and it costs nothing (a vote that has already ended changes nothing).
  const endsAt = expiryOfVote(vote);
  if (endsAt !== null) noteVote(vote.userId, endsAt);
  if (!isNew) return;
  await grantVoteRole(client, vote.userId, listName(vote.source)).catch((err) => logger.warn('Voter role failed:', err.message));
  await thank(client, vote);
}

function createTopggHandler(client) {
  return async function topggWebhook(req, res) {
    if (!topgg.verifySignature({ secret: config.topggWebhookSecret, header: req.get('x-topgg-signature'), rawBody: req.rawBody })) {
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }
    if (req.body?.type === 'webhook.test') {
      logger.info('top.gg webhook test received.');
      res.status(200).json({ ok: true, test: true });
      return;
    }
    const vote = topgg.parseVote(req.body);
    if (!vote) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    try {
      const isNew = await votesDb.recordVote(vote);
      res.status(200).json({ ok: true, duplicate: !isNew });
      await afterVote(client, vote, isNew);
    } catch (err) {
      logger.error('Could not store a top.gg vote:', err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'vote_failed' });
    }
  };
}

/** The raw bytes of a request: the ones the JSON parser kept, or the whole body when another parser read it as a buffer. */
function rawBodyOf(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  return Buffer.isBuffer(req.body) ? req.body : null;
}

function createOmniplexHandler(client) {
  return async function omniplexWebhook(req, res) {
    const rawBody = rawBodyOf(req);
    if (!omniplex.verifySignature({ secret: config.omniplexWebhookSecret, header: req.get('x-webhook-signature'), rawBody })) {
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }
    let payload = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Signed but not JSON: nothing to do, and nothing to send again.
    }
    const event = omniplex.readEvent(payload);
    if (!event.vote) {
      if (event.ignored === 'test') logger.info('omniplex webhook test received.');
      res.status(200).json({ ok: true, ignored: true, reason: event.ignored });
      return;
    }
    try {
      const isNew = await votesDb.recordVote(event.vote);
      res.status(200).json({ ok: true, duplicate: !isNew });
      await afterVote(client, event.vote, isNew);
    } catch (err) {
      logger.error('Could not store an omniplex vote:', err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'vote_failed' });
    }
  };
}

module.exports = { createTopggHandler, createOmniplexHandler };
