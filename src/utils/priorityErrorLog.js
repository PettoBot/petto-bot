// i18n-ignore-file: the priority error log is for the Petto team (English only).
// The PRIORITY errors channel: an error that Petto cannot explain or fix by itself, for the team to investigate. The same problem again inside ten
// minutes edits its card (a count) instead of posting again. The team is pinged at most once per problem every 30 minutes and at most 5 times an
// hour; past that the card is still posted, without a ping. Nobody can be pinged by the text of an error: every field loses its mentions.
const { ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');
const { classify, findError, redactSecrets, stackFrames, stripMentions, textOf, EXPLAIN_UNKNOWN } = require('./errorTriage');

const REPEAT_WINDOW_MS = 10 * 60_000;
const PING_PER_PROBLEM_MS = 30 * 60_000;
const PINGS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;
const SEND_GAP_MS = 1_500;
const EDIT_GAP_MS = 2_000;
const MAX_QUEUE = 30;
const CARD_COLOR = 0xfe6465;
// Discord counts every character of every text of a Components V2 message together, and accepts 4000.
const TEXT_BUDGET = 3_900;
const SCALES = [1, 0.8, 0.65, 0.5, 0.35, 0.2];

const ID_RE = /^\d{15,25}$/;
const idList = (values) => [...new Set((values ?? []).map(String).filter((id) => ID_RE.test(id)))];

function version() {
  try { return require('../../package.json').version; } catch { return 'unknown'; }
}

/** Cuts a text to a length (counting the ellipsis), on one line when `line` is set. */
function clip(value, length, { line = false } = {}) {
  let text = String(value ?? '');
  if (line) text = text.replace(/\s+/g, ' ').trim();
  const max = Math.max(1, Math.floor(length));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What is allowed to reach the channel: no secrets, no way to ping, and no way to close a code block early. */
const safe = (value, length, options) => clip(stripMentions(redactSecrets(value)), length, options).replace(/```/g, `\`${'​'}\`\``);

// --------------------------------------------------------------------------------------------------------------------
// The ping policy.
// --------------------------------------------------------------------------------------------------------------------

/** One ping per problem every 30 minutes, 5 an hour in all. `allow(fingerprint)` says yes (and counts it) or no. */
function createPingPolicy({ now = () => Date.now(), perProblemMs = PING_PER_PROBLEM_MS, perHour = PINGS_PER_HOUR } = {}) {
  const byProblem = new Map();
  let recent = [];
  return {
    allow(fingerprint) {
      const at = now();
      recent = recent.filter((time) => at - time < HOUR_MS);
      const last = byProblem.get(fingerprint);
      if (last !== undefined && at - last < perProblemMs) return false;
      if (recent.length >= perHour) return false;
      recent.push(at);
      byProblem.set(fingerprint, at);
      if (byProblem.size > 500) for (const [key, time] of byProblem) if (at - time >= perProblemMs) byProblem.delete(key);
      return true;
    },
  };
}

/** The ping text and the `allowedMentions` that match it exactly: the users and the role that are configured, and nothing else. */
function pingParts({ userIds, roleId } = {}) {
  const users = idList(userIds);
  const roles = ID_RE.test(String(roleId ?? '')) ? [String(roleId)] : [];
  const text = [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' ');
  return { text, allowedMentions: { parse: [], users, roles, repliedUser: false } };
}
const NO_PING = Object.freeze({ text: '', allowedMentions: Object.freeze({ parse: [] }) });

// --------------------------------------------------------------------------------------------------------------------
// The card.
// --------------------------------------------------------------------------------------------------------------------

const when = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const named = (name, id) => (id ? `${name ? `${name} ` : ''}(\`${id}\`)` : 'Not available');

/**
 * The card of one priority error. `entry` has what happened: { level, args, stamp, context, triage, names, count, firstAt, lastAt, recent,
 * pingText, fallback }. Returns the message payload (a Components V2 card, red) with `allowedMentions` for the ping text it carries.
 */
function buildPriorityCard(entry, { allowedMentions = NO_PING.allowedMentions } = {}) {
  const error = findError(entry.args);
  const triage = entry.triage ?? classify(error, { args: entry.args });
  const context = entry.context ?? {};
  const names = entry.names ?? {};
  const text = textOf(error, entry.args);
  const label = (entry.args ?? []).filter((arg) => typeof arg === 'string').join(' ').trim() || text || 'No description provided.';
  const command = context.command ?? context.source ?? null;
  const frames = stackFrames(error, 6);
  const detail = error ? [error.message, error.rawError?.message && error.rawError.message !== error.message ? `api=${error.rawError.message}` : null, error.code !== undefined ? `code=${error.code}` : null, error.status !== undefined ? `status=${error.status}` : null, error.method ? `method=${error.method}` : null].filter(Boolean).join(' · ') : text;
  const count = entry.count ?? 1;
  const meaning = triage.explanation || EXPLAIN_UNKNOWN;

  const build = (scale) => {
    const s = (value, length, options) => safe(value, length * scale, options);
    const copy = {
      bot: `Petto ${version()}`,
      node: process.version,
      time: new Date(entry.lastAt ?? Date.now()).toISOString(),
      fingerprint: triage.fingerprint,
      kind: triage.kind,
      code: triage.code ?? undefined,
      status: triage.status ?? undefined,
      command: command ? s(command, 80) : undefined,
      guildId: context.guildId ?? context.serverId ?? undefined,
      channelId: context.channelId ?? undefined,
      userId: context.userId ?? context.memberId ?? undefined,
      occurrences: `${count} in the last 10 minutes`,
      message: s(detail || label, 220, { line: true }),
      meaning: s(meaning, 150, { line: true }),
      stack: frames.map((frame) => s(frame, 95, { line: true })),
      recentLog: (entry.recent ?? []).slice(-5).map((line) => s(line, 110, { line: true })),
    };
    const copyText = JSON.stringify(copy, (key, value) => (Array.isArray(value) && !value.length ? undefined : value), 1);
    const parts = [
      `${entry.pingText ? `${entry.pingText}\n` : ''}## ${EMOJI.DENY} Petto priority error${entry.fallback ? '\n-# Posted in the general log because the priority channel is not set or cannot be reached.' : ''}`,
      [
        `**Event**\n${s(label, 200, { line: true })}`,
        `**What it probably means**\n${s(meaning, 300, { line: true })}`,
      ].join('\n'),
      [
        `**Server** ${s(named(names.guild, context.guildId ?? context.serverId), 90, { line: true })}   **Channel** ${s(named(names.channel, context.channelId), 80, { line: true })}   **User** ${s(named(names.user, context.userId ?? context.memberId), 70, { line: true })}`,
        `**Command / source** ${command ? `\`${s(command, 80, { line: true }).replace(/`/g, "'")}\`` : 'Not specified'}${context.action ? `   **Action** \`${s(context.action, 60, { line: true }).replace(/`/g, "'")}\`` : ''}`,
        `**Count in the last 10 minutes** ${count}   **First seen** ${when(entry.firstAt ?? Date.now())}   **Last seen** ${when(entry.lastAt ?? Date.now())}`,
      ].join('\n'),
      `**Details**\n\`\`\`text\n${s(detail || label, 330)}\n\`\`\``,
      `**Stack (top ${Math.max(frames.length, 0)} frames)**\n\`\`\`text\n${frames.length ? frames.map((frame) => s(frame, 105, { line: true })).join('\n') : 'No stack available.'}\n\`\`\``,
      `**Copy this to investigate**\n\`\`\`json\n${copyText}\n\`\`\``,
      `-# Petto diagnostics · ${process.version} · bot ${version()} · fingerprint ${triage.fingerprint}`,
    ];
    return parts;
  };

  let parts = build(1);
  for (const scale of SCALES) {
    parts = build(scale);
    if (parts.reduce((sum, part) => sum + part.length, 0) <= TEXT_BUDGET) break;
  }

  const container = new ContainerBuilder().setAccentColor(CARD_COLOR);
  parts.forEach((part, index) => {
    if (index) container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(part));
  });
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions };
}

/** The characters Discord counts in a Components V2 payload (the text of every text display). */
function textLength(payload) {
  let total = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
    if (typeof json.content === 'string') total += json.content.length;
    for (const key of ['components', 'items']) if (Array.isArray(json[key])) json[key].forEach(walk);
    if (json.accessory) walk(json.accessory);
  };
  (payload.components ?? []).forEach(walk);
  return total;
}

// --------------------------------------------------------------------------------------------------------------------
// The sink.
// --------------------------------------------------------------------------------------------------------------------

/**
 * `sink(level, args, stamp, context, triage, { recent })`: posts (or updates) the card of a priority error.
 * options: channelId (the priority channel), fallbackChannelId (the general one, used when the priority one is not set or cannot be reached),
 * pingUserIds, pingRoleId, now, gapMs, editGapMs, windowMs, warn (called once when there is no priority channel).
 */
function createPriorityErrorSink(client, options = {}) {
  const {
    channelId = null,
    fallbackChannelId = null,
    pingUserIds = [],
    pingRoleId = null,
    now = () => Date.now(),
    gapMs = SEND_GAP_MS,
    editGapMs = EDIT_GAP_MS,
    windowMs = REPEAT_WINDOW_MS,
    warn = (...args) => require('./logger').warn(...args),
  } = options;
  const policy = options.pingPolicy ?? createPingPolicy({ now });
  const ping = pingParts({ userIds: pingUserIds, roleId: pingRoleId });
  const groups = new Map(); // fingerprint -> { entry, times, message, lastEditAt, timer, pingText, allowedMentions, fallback }
  let chain = Promise.resolve();
  let pending = 0;
  let warnedNoChannel = false;
  let lastFailureAt = 0;
  let dropped = 0;

  const fail = (what, error) => {
    const at = now();
    if (at - lastFailureAt < 60_000) return;
    lastFailureAt = at;
    console.error(`[Petto diagnostics] ${what}:`, error?.message ?? error);
  };

  async function fetchChannel(id) {
    if (!id || !client?.channels) return null;
    const cached = client.channels.cache?.get?.(id);
    if (cached?.isTextBased?.()) return cached;
    const channel = await Promise.resolve(client.channels.fetch?.(id)).catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
  }

  async function resolveChannel() {
    if (channelId) {
      const channel = await fetchChannel(channelId);
      if (channel) return { channel, fallback: false };
    }
    if (!channelId && !warnedNoChannel) {
      warnedNoChannel = true;
      try { warn('[Priority errors] PETTO_PRIORITY_ERRORS_CHANNEL_ID is not set: priority errors are posted in the general error log, marked as priority.'); } catch { /* the log must never break */ }
    }
    const channel = await fetchChannel(fallbackChannelId);
    return channel ? { channel, fallback: true } : { channel: null, fallback: true };
  }

  function namesFor(context) {
    const guildId = context?.guildId ?? context?.serverId;
    const userId = context?.userId ?? context?.memberId;
    return {
      guild: guildId ? client?.guilds?.cache?.get?.(guildId)?.name ?? null : null,
      channel: context?.channelId ? (client?.channels?.cache?.get?.(context.channelId)?.name ? `#${client.channels.cache.get(context.channelId).name}` : null) : null,
      user: userId ? client?.users?.cache?.get?.(userId)?.tag ?? client?.users?.cache?.get?.(userId)?.username ?? null : null,
    };
  }

  const countIn = (group, at) => group.times.filter((time) => at - time < windowMs).length;

  function payloadOf(group, at) {
    const entry = { ...group.entry, count: countIn(group, at), firstAt: group.firstAt, lastAt: group.lastAt, pingText: group.pingText, fallback: group.fallback };
    return buildPriorityCard(entry, { allowedMentions: group.allowedMentions });
  }

  async function flushEdit(group) {
    group.timer = null;
    if (!group.dirty || !group.message) return;
    group.dirty = false;
    group.lastEditAt = now();
    try {
      await group.message.edit(payloadOf(group, now()));
    } catch (error) {
      // The card was deleted: the next time it happens it is posted again.
      if (Number(error?.code) === 10008) { group.message = null; groups.delete(group.fingerprint); } else fail('Could not update a priority error card', error);
    }
  }

  function repeat(group, at) {
    group.times.push(at);
    group.times = group.times.filter((time) => at - time < windowMs);
    group.lastAt = at;
    group.dirty = true;
    const wait = group.lastEditAt + editGapMs - at;
    if (wait <= 0) return flushEdit(group);
    if (!group.timer) {
      group.timer = setTimeout(() => { chain = chain.then(() => flushEdit(group)); }, wait);
      group.timer.unref?.();
    }
    return Promise.resolve();
  }

  async function post(item) {
    const at = now();
    const { level, args, stamp, context, triage, extras } = item;
    const fingerprint = triage.fingerprint;
    const existing = groups.get(fingerprint);
    if (existing?.message && at - existing.lastAt <= windowMs) return repeat(existing, at);

    const { channel, fallback } = await resolveChannel();
    if (!channel) return;
    const allowed = ping.text && policy.allow(fingerprint);
    const group = {
      fingerprint,
      entry: { level, args, stamp, context, triage, names: namesFor(context), recent: extras?.recent ?? [] },
      times: [at],
      firstAt: at,
      lastAt: at,
      lastEditAt: at,
      dirty: false,
      timer: null,
      message: null,
      pingText: allowed ? ping.text : '',
      allowedMentions: allowed ? ping.allowedMentions : NO_PING.allowedMentions,
      fallback,
    };
    try {
      group.message = await channel.send(payloadOf(group, at));
    } catch (error) {
      fail('Could not send a priority error card', error);
      return;
    }
    groups.set(fingerprint, group);
    if (groups.size > 200) for (const [key, value] of groups) if (at - value.lastAt > windowMs) groups.delete(key);
    if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }

  const sink = (level, args, stamp, context, triage, extras) => {
    if (pending >= MAX_QUEUE) {
      dropped += 1;
      fail(`The priority error queue is full (${dropped} dropped)`, 'too many different errors at once');
      return Promise.resolve();
    }
    pending += 1;
    const resolved = triage ?? classify(findError(args), { args });
    chain = chain.then(() => post({ level, args, stamp, context, triage: resolved, extras })).catch((error) => fail('Priority error log failed', error)).finally(() => { pending -= 1; });
    return chain;
  };
  sink.groups = groups;
  return sink;
}

module.exports = {
  REPEAT_WINDOW_MS,
  PING_PER_PROBLEM_MS,
  PINGS_PER_HOUR,
  TEXT_BUDGET,
  createPingPolicy,
  pingParts,
  buildPriorityCard,
  createPriorityErrorSink,
  textLength,
  clip,
  safe,
};
