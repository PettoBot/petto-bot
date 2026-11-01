// The safety net around every ticket button, menu and form. What it does, so a ticket fixes itself and nobody has to read the error log:
//  - It answers Discord first (`ack`), so a slow database or host does not become "This interaction failed" (the 3 second window).
//  - A second press of the same button while the first is still working is harmless (`lockKey`).
//  - "Unknown Channel" / "Unknown Message" (10003, 10008) means the ticket is already gone: it is the same as done. The bookkeeping is finished
//    (`onGone`) and the member hears it kindly; no error is reported.
//  - An expired interaction (10062) is not an error. The work still runs, and the member gets one normal message instead of the dead reply.
//  - A timeout, a rate limit, a 5xx or a lost connection is tried once more (after 1.5 s, or what Discord asked).
//  - When it still fails the member gets a short friendly message (private if the interaction is alive, else a message in the channel or a
//    DM), the ticket is left safe (`onFail`) and the failure goes to the PRIORITY log through the triage.
const { MessageFlags } = require('discord.js');
const defaultLogger = require('./logger');
const { classify, isExpired, isGone, retryAfterMs } = require('./errorTriage');
const { isPermissionError, permissionHelp } = require('./permissionErrors');
const { EMOJI } = require('./emojis');

const RETRY_DELAY_MS = 1_500;
const MAX_RETRY_DELAY_MS = 10_000;
const DEADLINE_MS = 2_000;

const TIMED_OUT = Symbol('timed-out');
const inFlight = new Set();
const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function translator() {
  const { t, languageOf } = require('../i18n');
  return { t, languageOf };
}

const asPayload = (payload) => (typeof payload === 'string' ? { content: payload } : { ...payload });

/**
 * Runs `fn(ctx)` for an interaction with the net described above. `name` is the action (`tk_delete`, `rating`...).
 * options: ack ('reply' private, 'reply-public', 'update', or 'none'), lang (a code or a function), lockKey, retry (false to never retry),
 * goneIsDone (false when "gone" is not a success, as when opening a ticket), onGone(error, ctx) -> true | false | { text }, onFail(error, ctx),
 * label (the start of the logged message), context (more of what to log), silentWhenExpired, expiredKey (what to say when the interaction died).
 * deps (for the checks): logger, sleep, retryDelayMs, notify.
 * Returns { status: 'ok' | 'busy' | 'refused' | 'gone' | 'expired' | 'failed', value, error }.
 */
async function safeTicketAction(interaction, name, fn, options = {}, deps = {}) {
  const logger = deps.logger ?? defaultLogger;
  const sleep = deps.sleep ?? sleepReal;
  const retryDelay = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const state = { kind: null, said: false, expired: false, suppressed: false };
  let langCache = typeof options.lang === 'string' ? options.lang : null;

  const lang = async () => {
    if (langCache) return langCache;
    try {
      const value = typeof options.lang === 'function' ? await options.lang() : await translator().languageOf(interaction);
      langCache = value || 'en';
    } catch { langCache = 'en'; }
    return langCache;
  };
  const text = async (key, vars) => translator().t(await lang(), key, vars);

  const ctx = {
    interaction,
    name,
    get expired() { return state.expired; },
    lang,
    text,
    /** Tells Discord the answer is coming. False when it was too late (the interaction is dead; the work goes on without it). */
    async ack(kind = 'reply') {
      if (state.expired) return false;
      if (interaction.deferred || interaction.replied || state.kind) return true;
      try {
        if (kind === 'update') await interaction.deferUpdate();
        else await interaction.deferReply(kind === 'reply-public' ? {} : { flags: MessageFlags.Ephemeral });
        state.kind = kind === 'update' ? 'update' : 'reply';
        return true;
      } catch (error) {
        if (isExpired(error)) { state.expired = true; state.suppressed = true; return false; }
        throw error;
      }
    },
    /**
     * Waits for `promise` up to `ms`; when it is slower, the interaction is acknowledged (`kind`) and the wait goes on.
     * Returns { value, late }: late means the answer can no longer be a modal.
     */
    async afterDeadline(promise, kind = 'reply', ms = deps.deadlineMs ?? DEADLINE_MS) {
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); timer.unref?.(); });
      const first = await Promise.race([promise, timeout]);
      clearTimeout(timer);
      if (first !== TIMED_OUT) return { value: first, late: false };
      await ctx.ack(kind);
      return { value: await promise, late: true };
    },
    /** A private message for the member. Through the interaction when it is alive; otherwise it is held for the one note at the end. */
    async say(payload, { force = false } = {}) {
      if (state.expired && !force) { state.suppressed = true; return null; }
      const body = asPayload(payload);
      try {
        if (state.kind === 'reply' && !state.said && !interaction.replied) {
          state.said = true;
          const { flags, ephemeral, ...rest } = body;
          return await interaction.editReply(rest);
        }
        if (interaction.deferred || interaction.replied || state.kind) return await interaction.followUp({ flags: MessageFlags.Ephemeral, ...body });
        state.said = true;
        return await interaction.reply({ flags: MessageFlags.Ephemeral, ...body });
      } catch (error) {
        if (isExpired(error)) { state.expired = true; state.suppressed = true; return null; }
        if (isGone(error)) return null;
        throw error;
      }
    },
    /** A private extra line after the message was changed; held back when the interaction is dead. */
    async followUp(payload) {
      if (state.expired) { state.suppressed = true; return null; }
      try {
        return await interaction.followUp({ flags: MessageFlags.Ephemeral, ...asPayload(payload) });
      } catch (error) {
        if (isExpired(error)) { state.expired = true; state.suppressed = true; return null; }
        if (isGone(error)) return null;
        throw error;
      }
    },
    /** Changes the message the button or menu is on (after an `update` ack, or as the answer itself). */
    async updateMessage(payload) {
      if (state.expired) return null;
      try {
        if (interaction.deferred || interaction.replied) return await interaction.editReply(asPayload(payload));
        return await interaction.update(asPayload(payload));
      } catch (error) {
        if (isExpired(error)) { state.expired = true; return null; }
        if (isGone(error)) return null;
        throw error;
      }
    },
    /** A normal message where the member is (the ticket channel, else their DMs), for when the interaction is dead. Never throws. */
    async notify(content) {
      if (deps.notify) return deps.notify(content, ctx);
      const user = interaction.user;
      const body = { content: user?.id ? `<@${user.id}> ${content}` : content, allowedMentions: { users: user?.id ? [user.id] : [] } };
      try {
        if (interaction.channel?.send) return await interaction.channel.send(body);
        if (user?.send) return await require('./dmOrigin').sendDm(user, { content }, { guild: interaction.guild ?? null, kind: 'ticket' });
      } catch { /* the channel may be gone; there is nobody left to tell */ }
      return null;
    },
  };

  const key = options.lockKey ?? null;
  if (key && inFlight.has(key)) {
    // The same press while the first is working: acknowledged, told once, and nothing is done twice.
    await ctx.ack(options.ack === 'update' ? 'update' : 'reply').catch(() => false);
    await ctx.say(await text('tickets.safe.busy')).catch(() => null);
    return { status: 'busy' };
  }
  if (key) inFlight.add(key);

  const context = () => ({
    guildId: interaction.guildId ?? interaction.guild?.id ?? undefined,
    channelId: interaction.channelId ?? interaction.channel?.id ?? undefined,
    userId: interaction.user?.id ?? undefined,
    action: name,
    command: name,
    source: 'ticket',
    ...(options.context ?? {}),
  });

  try {
    if (options.ack && options.ack !== 'none') await ctx.ack(options.ack);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const value = await fn(ctx);
        // The member was never told (the interaction died on the way): one normal message says it went through.
        if (state.expired && state.suppressed && !options.silentWhenExpired) {
          await ctx.notify(await text('tickets.safe.lateDone', { emoji: EMOJI.APPROVE }));
        }
        return { status: 'ok', value };
      } catch (error) {
        const outcome = await handle(error, attempt);
        if (outcome === 'retry') continue;
        return outcome;
      }
    }
  } finally {
    if (key) inFlight.delete(key);
  }

  async function handle(error, attempt) {
    // A refusal that is already written for the member (a reason that is required, a limit).
    if (error?.userFacing) {
      await ctx.say(error.message).catch(() => null);
      return { status: 'refused', error };
    }
    // The interaction died: not an error. The work was the point, and it does not need the interaction.
    if (isExpired(error)) {
      state.expired = true;
      logger.warn(context(), `Ticket "${name}": the interaction expired before Petto could answer it (${error.message}); nothing was lost.`);
      if (!options.silentWhenExpired) await ctx.notify(await text(options.expiredKey ?? 'tickets.safe.lateDone', { emoji: EMOJI.APPROVE })).catch(() => null);
      return { status: 'expired', error };
    }
    // The channel or the message is already gone: finished. The bookkeeping makes the database say the same.
    if (isGone(error) && options.goneIsDone !== false) {
      let healed = true;
      try { healed = options.onGone ? await options.onGone(error, ctx) : true; } catch (healError) { logger.warn(context(), `Ticket "${name}": could not finish the bookkeeping of a gone ticket: ${healError?.message ?? healError}`); }
      if (healed !== false) {
        logger.info(context(), `Ticket "${name}": the channel or message was already gone; treated as done.`);
        await ctx.say(healed?.text ?? await text('tickets.safe.alreadyGone')).catch(() => null);
        return { status: 'gone', error };
      }
    }
    // A moment of trouble (a timeout, a rate limit, a 5xx, a lost connection): once more.
    const triage = classify(error, { args: [error] });
    const transient = triage.benign && triage.fix === 'retry';
    if (transient && attempt === 1 && options.retry !== false) {
      const asked = retryAfterMs(error);
      await sleep(Math.min(MAX_RETRY_DELAY_MS, Math.max(retryDelay, asked ?? 0)));
      return 'retry';
    }

    // It did not work. The ticket is left safe, the member is told kindly and the team gets the error through the triage.
    try { await options.onFail?.(error, ctx); } catch (failError) { logger.warn(context(), `Ticket "${name}": the safe state could not be restored: ${failError?.message ?? failError}`); }
    const label = options.label ?? `Ticket action "${name}" failed:`; // i18n-ignore: log text for the team
    if (isPermissionError(error)) {
      logger.warn(context(), `${label} ${error.message}`);
      await ctx.say(permissionHelp(error, await lang()), { force: true }).catch(() => null);
    } else {
      logger.error({ ...context(), exhausted: transient && attempt > 1 }, label, error);
      const message = await text(error?.friendlyKey ?? 'tickets.safe.failed');
      const told = await ctx.say(message, { force: !state.expired }).catch(() => null);
      if (state.expired || told === null) await ctx.notify(message);
    }
    return { status: 'failed', error };
  }
}

/**
 * The same net around a handler that answers by itself (the setup wizard and the form builder of the tickets, which edit their own message): no
 * early acknowledgement and no retry (they are not safe to repeat), but an expired press is not an error and a real failure is told kindly and
 * reaches the team.
 */
function wrapTicketHandler(name, handler, options = {}) {
  return (interaction, ...rest) => safeTicketAction(interaction, name, () => handler(interaction, ...rest), { ack: 'none', retry: false, goneIsDone: false, expiredKey: 'tickets.safe.tryAgain', label: `Ticket ${name} failed:`, ...options }); // i18n-ignore: log text for the team
}

module.exports = { safeTicketAction, wrapTicketHandler, RETRY_DELAY_MS, DEADLINE_MS, inFlight };
