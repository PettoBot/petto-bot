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

/** What the operator can read in the log about each delivery, with no secret and no signature in it. */
function describeRefusal(result, req, rawBody) {
  const how = {
    bad_signature: 'the signature does not match: the secret saved in Omniplex must be the same as OMNIPLEX_WEBHOOK_SECRET', // i18n-ignore: text of the operator log, not shown to members
    bad_authorization: 'the Authorization header is not the secret: it must be the same as OMNIPLEX_WEBHOOK_SECRET', // i18n-ignore: text of the operator log, not shown to members
    no_signature: 'the signature header is missing', // i18n-ignore: text of the operator log, not shown to members
    no_authorization: 'the Authorization header is missing', // i18n-ignore: text of the operator log, not shown to members
    unsupported_protocol: 'the signing method is not one Petto reads (use "HMAC signature" in the webhook settings of Omniplex)', // i18n-ignore: text of the operator log, not shown to members
    no_credentials: 'no signature and no Authorization header came with it (set "HMAC signature" and the secret in Omniplex)', // i18n-ignore: text of the operator log, not shown to members
    no_body: 'the body did not arrive', // i18n-ignore: text of the operator log, not shown to members
    no_secret: 'OMNIPLEX_WEBHOOK_SECRET is not set', // i18n-ignore: text of the operator log, not shown to members
  }[result.reason] || result.reason;
  const bodySize = Buffer.isBuffer(rawBody) ? rawBody.byteLength : 0;
  const contentType = String(req.get('content-type') ?? 'none').slice(0, 60);
  return `omniplex webhook refused (${result.reason}, method ${result.protocol}, body ${bodySize} bytes, content-type ${contentType}): ${how}`; // i18n-ignore: text of the operator log, not shown to members
}

let noVoteChannelSaid = false;

function createOmniplexHandler(client) {
  return async function omniplexWebhook(req, res) {
    const rawBody = rawBodyOf(req);
    const checked = omniplex.checkDelivery({ secret: config.omniplexWebhookSecret, header: (name) => req.get(name), rawBody });
    if (!checked.ok) {
      logger.warn(describeRefusal(checked, req, rawBody));
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }
    const event = omniplex.readEvent(checked.payload);
    if (!event.vote) {
      if (event.ignored === 'test') logger.info('omniplex webhook test received: the route, the secret and the signing method work.');
      else logger.info(`omniplex webhook received and not counted (${event.ignored}${checked.payload?.type ? `, type ${String(checked.payload.type).slice(0, 30)}` : ''}).`);
      res.status(200).json({ ok: true, ignored: true, reason: event.ignored });
      return;
    }
    try {
      const isNew = await votesDb.recordVote(event.vote);
      logger.info(`omniplex vote ${isNew ? 'stored' : 'received again (already stored)'}: user ${event.vote.userId}.`);
      if (isNew && !config.voteChannelId && !noVoteChannelSaid) {
        noVoteChannelSaid = true;
        logger.info('VOTE_CHANNEL_ID is not set, so votes are stored and counted but nobody is thanked in a channel.');
      }
      res.status(200).json({ ok: true, duplicate: !isNew });
      await afterVote(client, event.vote, isNew);
    } catch (err) {
      logger.error('Could not store an omniplex vote:', err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'vote_failed' });
    }
  };
}

module.exports = { createTopggHandler, createOmniplexHandler };
