// Moves a channel's sticky message back to the bottom after someone posts, as fast as Discord allows and without the races a
// fast repost invites. One reposter keeps a small state for each channel:
//
//  - a short quiet time (`quietMs`) after the last message, so one message brings the sticky back in about half a second; a
//    burst keeps pushing it back, but never past `maxWaitMs` after the first message of the burst, so a long conversation still
//    gets the sticky now and then instead of never;
//  - one job at a time for each channel (the lock): messages that arrive while it runs are not new jobs, they are looked at once
//    when it ends;
//  - the new sticky is sent FIRST and the old one deleted after, together with the database write, so there is never a moment
//    without a sticky and the swap is one visible step;
//  - nothing is fetched to know if the sticky is the last message: the ids of the messages the gateway announced are compared
//    with the id of the sticky that was just posted (snowflakes grow with time). A message newer than the sticky means the sticky
//    landed above it, and one more pass puts it below. A message older than the sticky is above it already: nothing to do.
// Channels never wait for each other (the state is per channel); the requests of all of them still share the bot's own request
// limit in discord.js, which also waits out a 429 by itself.

const GONE_CODES = new Set([10003, 10004, 50001, 50013]); // unknown channel or guild, no access, missing permission: nothing to do here
const UNKNOWN_MESSAGE = 10008;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10_000;
const MAX_REMEMBERED = 5_000;

function newer(a, b) {
  try { return BigInt(a) > BigInt(b); } catch { return false; }
}

/** The wait a 429 asks for, in milliseconds, or null when the error is not a rate limit. */
function rateLimitWaitMs(error) {
  if (!error) return null;
  const limited = error.status === 429 || error.code === 429 || error.name === 'RateLimitError';
  if (!limited) return null;
  const seconds = Number(error.retryAfter ?? error.retry_after ?? error.data?.retry_after);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Number(error.timeToReset);
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(100, Number.isFinite(ms) ? ms : 1000));
}

function createStickyReposter({
  getSticky, setMessageId, buildPayload, react = async () => {}, logger,
  quietMs, maxWaitMs,
  now = Date.now,
  setTimer = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; },
  clearTimer = clearTimeout,
}) {
  const states = new Map();
  // The sticky this process posted last in each channel, kept after the channel's state is gone: if the database missed the new id,
  // the next pass still deletes it instead of leaving two stickies. Capped, oldest first.
  const posted = new Map();
  const remember = (channelId, id) => {
    posted.delete(channelId);
    posted.set(channelId, id);
    if (posted.size > MAX_REMEMBERED) posted.delete(posted.keys().next().value);
  };

  function arm(state, extraMs = 0) {
    clearTimer(state.timer);
    const untilMax = state.firstAt + maxWaitMs - now();
    const wait = Math.max(extraMs, Math.max(0, Math.min(quietMs, untilMax)));
    state.timer = setTimer(() => { state.timer = null; run(state); }, wait);
  }

  async function deleteOld(channel, id) {
    try {
      await channel.messages.delete(id);
    } catch (error) {
      if (error?.code !== UNKNOWN_MESSAGE && !GONE_CODES.has(error?.code)) logger.warn(`Sticky: the old message ${id} was not deleted: ${error?.message ?? error}`);
    }
  }

  async function run(state) {
    state.running = true;
    state.firstAt = null;
    const message = state.latest;
    const { channel, guild } = message;
    let again = null;
    try {
      const sticky = await getSticky(guild.id, channel.id);
      if (!sticky) return; // turned off while it waited
      const me = guild.members?.me;
      if (me && channel.permissionsFor && !channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) return;
      const payload = await buildPayload(sticky, message);
      if (!payload) return;

      const sent = await channel.send(payload);
      const old = [...new Set([sticky.message_id, posted.get(channel.id)].filter((id) => id && id !== sent.id))];
      remember(channel.id, sent.id);
      // The database write and the deletion of the old sticky do not wait for each other.
      await Promise.all([
        Promise.resolve(setMessageId(guild.id, channel.id, sent.id)).catch((error) => logger.error(`Sticky: the new message id of channel ${channel.id} was not saved:`, error)),
        ...old.map((id) => deleteOld(channel, id)),
      ]);
      if (payload.reactions?.length) Promise.resolve(react(sent, payload.reactions)).catch(() => {});

      state.retries = 0;
      // A message that the gateway announced after the sticky was posted is below it: one more pass.
      if (state.latestId && newer(state.latestId, sent.id)) state.firstAt = now();
    } catch (error) {
      const wait = rateLimitWaitMs(error);
      if (wait != null && state.retries < MAX_RATE_LIMIT_RETRIES) {
        state.retries += 1;
        state.firstAt = now();
        again = wait;
      } else if (!GONE_CODES.has(error?.code)) {
        logger.error(`Sticky message repost failed in channel ${channel.id}:`, error);
      }
    } finally {
      state.running = false;
      if (state.firstAt != null) arm(state, again ?? 0);
      else if (!state.timer) states.delete(channel.id);
    }
  }

  return {
    /** A message of a member arrived in a channel that has a sticky. */
    schedule(message) {
      const key = message.channel.id;
      let state = states.get(key);
      if (!state) {
        state = { timer: null, firstAt: null, running: false, latest: message, latestId: null, retries: 0 };
        states.set(key, state);
      }
      state.latest = message;
      if (!state.latestId || newer(message.id, state.latestId)) state.latestId = message.id;
      if (state.running) return; // the end of the job looks at it
      if (state.firstAt == null) state.firstAt = now();
      arm(state);
    },
    /** True for the message the reposter itself posted (the sticky), which must not start another pass. */
    isOwn(message) {
      return posted.get(message.channel?.id) === message.id;
    },
    pending() { return states.size; },
  };
}

module.exports = { createStickyReposter, rateLimitWaitMs };
