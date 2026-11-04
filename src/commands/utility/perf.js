// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder, MessageFlags, Routes } = require('discord.js');
const config = require('../../config');
const { isPettoOperator } = require('../../utils/autoModControl');
const { textCard } = require('../../utils/caseCard');
const perf = require('../../utils/perf');
const loadGuard = require('../../utils/loadGuard');
const watchdog = require('../../utils/watchdog');
const processGuards = require('../../utils/processGuards');
const { commandLimiter } = require('../../utils/rateLimits');

const SECTIONS = ['summary', 'rest', 'slow', 'jobs', 'listeners', 'limits', 'level', 'probe'];
const ms = (value) => (Number.isFinite(value) ? `${Math.round(value)} ms` : 'n/a');
const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
const pad = (value, length) => String(value).slice(0, length).padEnd(length);
const ago = (at) => (at ? `${Math.round((Date.now() - at) / 1000)} s ago` : 'never');
const duration = (milliseconds) => (milliseconds >= 3_600_000 ? `${(milliseconds / 3_600_000).toFixed(1)} h` : milliseconds >= 60_000 ? `${Math.round(milliseconds / 60_000)} min` : `${Math.round(milliseconds / 1000)} s`);

/** Two REST requests timed right now, so the network can be told from the queue: `GET /gateway` (no token) and `GET /users/@me`. */
async function probeRest(client) {
  const results = [];
  for (const [label, route] of [['GET /gateway', Routes.gateway()], ['GET /users/@me', Routes.user('@me')]]) {
    const context = perf.newContext({ kind: 'probe', name: 'perf-probe', interactive: true });
    const started = perf.nowMs();
    let error = null;
    try { await perf.runWith(context, () => client.rest.get(route)); } catch (err) { error = err; }
    results.push({ label, total: perf.nowMs() - started, gate: context.rest.gate, net: context.rest.net, retries: context.rest.retries, error: error ? String(error.message ?? error).slice(0, 80) : null });
  }
  return results;
}

const probeLines = (results) => results.map((row) => `${pad(row.label, 16)} total ${ms(row.total)} · our queue ${ms(row.gate)} · network ${ms(row.net)}${row.retries ? ` · ${row.retries} retries` : ''}${row.error ? ` · ERROR ${row.error}` : ''}`);

function summary(client, probe) {
  const snapshot = perf.snapshot();
  const guard = loadGuard.stats();
  const limiter = commandLimiter().stats();
  const wd = watchdog.stats();
  const { database: db, rest, loop } = snapshot;
  const lines = [
    `**Level** ${guard.level.toUpperCase()}${guard.forced ? ' (forced)' : ''} since ${duration(Date.now() - guard.since)}${guard.reason ? `, because ${guard.reason}` : ''}`,
    `**Database** avg ${ms(db.latency.avg)} · p95 ${ms(db.latency.p95)} · ${db.latency.count} queries sampled · ${db.lastMinute}/min · errors ${db.errors}${db.pool ? ` · pool ${db.pool.total - db.pool.idle}/${db.pool.max} busy, ${db.pool.waiting} waiting, ${db.pool.backgroundWaiting} background held` : ''}`,
    `**Discord REST** avg ${ms(rest.total.avg)} · p95 ${ms(rest.total.p95)} · max ${ms(rest.longest.ms)} (${rest.longest.family ?? 'none'}) · ${rest.perMinute}/min · in flight ${rest.inFlight}`,
    `  our queue avg ${ms(rest.gate.avg)} p95 ${ms(rest.gate.p95)} · network avg ${ms(rest.net.avg)} p95 ${ms(rest.net.p95)}`,
    rest.gateState ? `  queued ${rest.gateState.queuedNormal} background + ${rest.gateState.queuedHigh} answers · oldest ${ms(rest.gateState.oldestNormalMs)} · tokens ${rest.gateState.tokens} · dropped ${rest.gateState.failed.wait} waited, ${rest.gateState.failed.full} full` : null,
    `**Rate limits (1 h)** ${rest.rateLimits.length}${rest.rateLimits.length ? `, last ${rest.rateLimits.at(-1).family} ${ms(rest.rateLimits.at(-1).waitMs)} (${rest.rateLimits.at(-1).source}/${rest.rateLimits.at(-1).scope})` : ''} · invalid 401/403/429 (10 min): ${JSON.stringify(rest.invalid.lastTenMinutes)} · warnings ${rest.invalid.warnings.count}`,
    `**Clock** host vs Discord ${rest.clockSkewMs == null ? 'n/a' : `${rest.clockSkewMs} ms (${rest.clockSamples} samples, accurate to about 1 s)`}`,
    `**Event loop** p99 ${ms(loop.minute.p99)} (1 min) · ${ms(loop.hour.p99)} (1 h) · max ${ms(loop.hour.max)} · p50 ${ms(loop.minute.p50)} · busy ${Math.round(loop.minute.elu * 100)}% · cpu ${Math.round(loop.minute.cpu)}%`,
    `**Memory** rss ${mb(loop.memory.rss)} of ${config.memoryLimitMb} MB · heap ${mb(loop.memory.heapUsed)} · up ${duration(loop.uptimeSeconds * 1000)}`,
    `**Commands running** ${limiter.running}/${limiter.max} (${limiter.waiting} waiting, ${limiter.reserve} kept for staff) · dropped (1 h) ${JSON.stringify(limiter.lastHour)}`,
    `**Shed (1 h)** ${Object.keys(guard.shedLastHour).length ? Object.entries(guard.shedLastHour).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => `${key} ${count}`).join(', ') : 'nothing'}`,
    `**Watchdog** ${wd.running ? 'on' : 'off'}${wd.thread ? ' (thread on)' : ''} · restarts in the last hour ${wd.restartsLastHour}/${config.watchdogMaxRestartsPerHour}${wd.holding ? ' · HOLDING (no restarts left)' : ''}${wd.lastDecision?.reason ? ` · last decision ${wd.lastDecision.action}: ${wd.lastDecision.reason}` : ''}`,
    `**Gateway** ${JSON.stringify((({ recentGateway, ...rest2 }) => rest2)(processGuards.stats()))} · ping ${client.ws.ping} ms`,
  ].filter(Boolean);
  if (probe) lines.push('**REST probe now**', ...probeLines(probe).map((line) => `  ${line}`));
  lines.push('**Slowest commands (1 h)**');
  const slow = snapshot.slowest.slice(0, 5);
  lines.push(...(slow.length ? slow.map((row) => `  ${pad(row.name, 22)} ${ms(row.total)} (first answer ${ms(row.ack)}) db ${row.db.n}q ${ms(row.db.ms)} · rest ${row.rest.n}req ${ms(row.rest.ms)} (queue ${ms(row.rest.gate)}, net ${ms(row.rest.net)})`) : ['  none yet']));
  lines.push('-# `!perf rest`, `slow`, `jobs`, `listeners`, `limits`, `probe`, `level <normal|degraded|critical|auto>`');
  return lines.join('\n');
}

function restSection() {
  const rest = perf.restStats();
  const lines = ['**REST by route family** (count, errors, 429s, avg, p95, longest)'];
  for (const row of [...rest.families].sort((a, b) => b.count - a.count).slice(0, 14)) lines.push(`${pad(row.family, 40)} ${pad(row.count, 6)} err ${pad(row.errors, 4)} 429 ${pad(row.rateLimited, 3)} avg ${pad(Math.round(row.avg), 5)} p95 ${pad(Math.round(row.p95), 5)} max ${Math.round(row.longest)}`);
  lines.push('**Top routes (last 10 min)**', ...rest.topRoutes.map(([key, count]) => `${pad(count, 5)} ${key}`));
  lines.push('**Top causes (last 10 min)**', ...rest.topCauses.map(([key, count]) => `${pad(count, 5)} ${key}`));
  lines.push('**Rate limits (1 h)**', ...(rest.rateLimits.slice(-8).map((event) => `${ago(event.at)} ${event.family} ${ms(event.waitMs)} ${event.source}/${event.scope}${event.global ? ' GLOBAL' : ''}`)), rest.rateLimits.length ? '' : 'none');
  lines.push(`**Invalid requests** totals ${JSON.stringify(rest.invalid.totals)} · by route (10 min) ${rest.invalid.byRoute.map(([key, count]) => `${key}: ${count}`).join('; ') || 'none'}`);
  return lines.join('\n');
}

function slowSection() {
  const rows = perf.slowestCommands(10);
  return ['**10 slowest commands (last hour)**', ...(rows.length ? rows.map((row) => `${ago(row.at)} ${pad(row.name, 22)} total ${ms(row.total)} · first answer ${ms(row.ack)}\n    ${perf.describeRecord(row)}${row.error ? ` · error ${row.error}` : ''}`) : ['none yet'])].join('\n');
}

function jobsSection() {
  const jobs = perf.jobStats().sort((a, b) => b.totalMs - a.totalMs);
  return ['**Interval jobs** (every, runs, avg, max, queries/run, requests/run)', ...jobs.map((job) => `${pad(job.name, 24)} every ${pad(duration(job.everyMs), 6)} runs ${pad(job.runs, 5)} avg ${pad(Math.round(job.avgMs), 5)} max ${pad(Math.round(job.maxMs), 6)} db ${job.dbPerRun.toFixed(1)} rest ${job.restPerRun.toFixed(1)}${job.errors ? ` ERR ${job.errors}` : ''}`)].join('\n');
}

function listenersSection() {
  const stats = perf.listenerStats();
  const row = (entry) => `${pad(entry.key, 56)} calls ${pad(entry.calls, 7)} blocked total ${pad(Math.round(entry.syncTotal), 6)} max ${pad(Math.round(entry.syncMax), 5)} · took max ${Math.round(entry.wallMax)}`;
  return [
    '**Events by type** (per second over the last minute, total)', ...stats.events.slice(0, 12).map((event) => `${pad(event.name, 28)} ${event.perSecond.toFixed(2)}/s  ${event.total}`),
    `**Top 10 listeners by time blocking the loop** (calls over ${perf.BLOCKING_LISTENER_MS} ms: ${stats.blocked})`, ...stats.byTotal.map(row),
    '**Top 10 by the longest single call**', ...stats.byMax.map(row),
  ].join('\n');
}

function limitsSection() {
  const limiter = commandLimiter();
  const guard = loadGuard.stats();
  return [
    '**Limits in use** (environment variables in brackets)',
    JSON.stringify(limiter.limits()),
    `Prefix: ${config.cmdUserBurst} commands per person then 1 every ${config.cmdUserRefillSeconds} s [PETTO_CMD_USER_BURST, PETTO_CMD_USER_REFILL_SECONDS]; server ${config.cmdGuildBurst} then ${config.cmdGuildRefillPerSecond}/s [PETTO_CMD_GUILD_BURST, PETTO_CMD_GUILD_REFILL_PER_SECOND]; staff x3; degraded halves them; critical serves staff only.`,
    `At once: ${config.cmdConcurrency} running, ${config.cmdQueue} waiting up to ${config.cmdQueueWaitSeconds} s, ${config.cmdStaffReserve} kept for staff [PETTO_CMD_CONCURRENCY, PETTO_CMD_QUEUE, PETTO_CMD_QUEUE_WAIT_SECONDS, PETTO_CMD_STAFF_RESERVE].`,
    `REST: ${config.restRequestsPerSecond}/s [PETTO_REST_RPS], background queue ${config.restMaxQueue} [PETTO_REST_MAX_QUEUE], fails after ${config.restMaxWaitSeconds} s [PETTO_REST_MAX_WAIT_SECONDS], ${config.restMaxInFlight} in flight [PETTO_REST_MAX_IN_FLIGHT].`,
    `Guard (${config.guardEnabled ? 'on' : 'off'}): loop p99 ${config.guardLoopDegradedMs}/${config.guardLoopCriticalMs} ms, longest wait ${config.guardRestWaitDegradedMs}/${config.guardRestWaitCriticalMs} ms, queue ${config.guardRestQueueDegraded}/${config.guardRestQueueCritical}, calm ${config.guardCalmSeconds} s [PETTO_GUARD_*]; level now ${guard.level}.`,
    `Watchdog (${config.watchdogEnabled ? 'on' : 'off'}): critical ${config.watchdogCriticalMinutes} min, blocked ${config.watchdogBlockedSeconds} s, rss ${config.watchdogRssPercent}% of ${config.memoryLimitMb} MB [BOT_MEMORY_LIMIT_MB], at most ${config.watchdogMaxRestartsPerHour} restarts an hour [PETTO_WATCHDOG_*].`,
    `Shed since start: ${JSON.stringify(guard.shed)}`,
    `Level history: ${guard.history.map((entry) => `${ago(entry.at)} ${entry.from}->${entry.to} (${entry.reason})`).join(' | ') || 'none'}`,
  ].join('\n');
}

/** Private tool of the Petto team: the numbers of the bot (database, REST, event loop, memory, commands, jobs) and the load guard. Prefix-only and hidden from !help. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  teamOnly: true,
  team: {
    summary: 'Shows how the bot is doing: database and Discord REST latency, event loop lag, memory, the slowest commands, the rate limits, the load level and the watchdog. It can also time Discord right now and force a load level to test it.',
    usage: ['!perf', '!perf rest|slow|jobs|listeners|limits|probe', '!perf level normal|degraded|critical|auto'],
    who: 'owner and developers (forcing a level: the owner)',
    area: 'bot',
    examples: ['!perf', '!perf rest', '!perf probe', '!perf level auto'],
    answers: 'a card with the numbers of the process',
    dangers: 'Forcing a level sheds work on purpose: use `!perf level auto` to give it back to the numbers.',
  },
  summaryText: summary,
  probeRest,
  data: new SlashCommandBuilder()
    .setName('perf')
    .setDescription('Private tool: how the bot is doing (latency, rate limits, load level).')
    .setDMPermission(false)
    .addStringOption((option) => option.setName('section').setDescription('rest, slow, jobs, listeners, limits, probe or level').setRequired(false))
    .addStringOption((option) => option.setName('value').setDescription('For level: normal, degraded, critical or auto').setRequired(false)),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) return undefined;
    const section = String(interaction.options.getString('section') ?? 'summary').trim().toLowerCase();
    const value = String(interaction.options.getString('value') ?? '').trim().toLowerCase();
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    let text;
    if (section === 'level') {
      if (!value) text = `Level ${loadGuard.level()} (${JSON.stringify(loadGuard.stats().history.at(-1) ?? {})}). \`!perf level normal|degraded|critical|auto\` forces one (owner only).`;
      else if (String(interaction.user.id) !== String(config.ownerId)) text = 'Only the owner forces a level.';
      else if (!['normal', 'degraded', 'critical', 'auto'].includes(value)) text = 'Use normal, degraded, critical or auto.';
      else { loadGuard.force(value); text = `The level is ${loadGuard.level()}${value === 'auto' ? ' (given back to the numbers)' : ' (forced: `!perf level auto` gives it back)'}.`; }
    } else if (section === 'rest') text = restSection();
    else if (section === 'slow') text = slowSection();
    else if (section === 'jobs') text = jobsSection();
    else if (section === 'listeners') text = listenersSection();
    else if (section === 'limits') text = limitsSection();
    else if (section === 'probe') text = probeLines(await probeRest(interaction.client)).join('\n');
    else text = summary(interaction.client, await probeRest(interaction.client).catch(() => null));
    return interaction.editReply({ components: [textCard(text.slice(0, 3900), 0x8799ff)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  },
};
