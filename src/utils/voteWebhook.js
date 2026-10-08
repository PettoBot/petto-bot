// The route of the vote webhook of top.gg: checks the signature, stores the vote once and thanks the voter in the vote channel.
const config = require('../config');
const votesDb = require('../db/votes');
const { verifySignature, parseVote } = require('./topgg');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const { MessageFlags } = require('discord.js');
const { grantVoteRole } = require('./voteRole');
const logger = require('./logger');

async function thank(client, vote) {
  if (!config.voteChannelId) return;
  const channel = await client.channels.fetch(config.voteChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const { mine, total } = await votesDb.voteTotals(vote.userId);
  const double = vote.weight > 1 ? ` It counted as **${vote.weight}** votes.` : '';
  await channel.send({
    components: [textCard(`${EMOJI.STAR} <@${vote.userId}> voted for Petto on top.gg, thank you!${double}\n-# ${mine} vote${mine === 1 ? '' : 's'} from them · ${total} in total`, 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch((err) => logger.warn('Could not thank a voter:', err.message));
}

function createTopggHandler(client) {
  return async function topggWebhook(req, res) {
    if (!verifySignature({ secret: config.topggWebhookSecret, header: req.get('x-topgg-signature'), rawBody: req.rawBody })) {
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }
    if (req.body?.type === 'webhook.test') {
      logger.info('top.gg webhook test received.');
      res.status(200).json({ ok: true, test: true });
      return;
    }
    const vote = parseVote(req.body);
    if (!vote) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    try {
      const isNew = await votesDb.recordVote(vote);
      res.status(200).json({ ok: true, duplicate: !isNew });
      if (isNew) {
        await grantVoteRole(client, vote.userId).catch((err) => logger.warn('Voter role failed:', err.message));
        await thank(client, vote);
      }
    } catch (err) {
      logger.error('Could not store a top.gg vote:', err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'vote_failed' });
    }
  };
}

module.exports = { createTopggHandler };
