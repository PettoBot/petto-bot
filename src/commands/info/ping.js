const { SlashCommandBuilder, MessageFlags, Routes } = require('discord.js');
const { performance } = require('node:perf_hooks');
const perf = require('../../utils/perf');
const { textCard } = require('../../utils/caseCard');
const { SUPPORT_URL } = require('../../utils/links');
const { t, formatNumber, languageOf } = require('../../i18n');

const STATUS_URL = 'https://petto.sbs/status';
const GREEN = 0xa5ea7a;
const YELLOW = 0xfed53c;
const RED = 0xff6b6b;

/** The color follows the slowest of the two latencies: green is fast, yellow is slow, red is bad. */
function colorFor(guildMs, apiMs) {
  const worst = Math.max(guildMs, Number.isFinite(apiMs) ? apiMs : 0);
  return worst < 300 ? GREEN : worst < 700 ? YELLOW : RED;
}

/** The card of the ping: both latencies, the links and the number of servers (never the number of members, that is private). Pure, so it can be checked without Discord. */
function buildPingCard({ guildMs, apiMs, probeMs = null, shard, shardCount, guilds, lang = 'en' }) {
  const api = Number.isFinite(apiMs) ? `${Math.round(apiMs)}ms` : t(lang, 'info.ping.unknown');
  return textCard([
    t(lang, 'info.ping.guild', { ms: `${Math.max(0, Math.round(guildMs))}ms` }),
    t(lang, 'info.ping.api', { ms: api }),
    ...(Number.isFinite(probeMs) ? [t(lang, 'info.ping.probe', { ms: `${Math.round(probeMs)}ms` })] : []),
    t(lang, 'info.ping.links', { statusUrl: STATUS_URL, supportUrl: SUPPORT_URL }),
    t(lang, 'info.ping.footer', { shard, shardCount, guilds: formatNumber(lang, guilds) }),
  ].join('\n'), colorFor(guildMs, apiMs));
}

module.exports = {
  // A prefix command: its slash entry is inside `/levels` or `/bot` (utils/umbrella.js).
  aliases: ['p'],
  buildPingCard,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDMPermission(false)
    .setDescription("Shows Petto's latency and how big it is."),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    // The time of sending ONE message, measured with one clock on this host (never a time of Discord against the clock of the host: a host whose clock is off
    // would show a number that is not the speed of anything). It includes any wait in the queue of requests; the probe below is the network alone.
    const startedAt = performance.now();
    await interaction.reply({ components: [textCard(t(lang, 'info.ping.pinging'))], flags: MessageFlags.IsComponentsV2 });
    const guildMs = Math.max(0, performance.now() - startedAt);
    const { client } = interaction;
    // `GET /gateway` needs no token and no database: how long Discord takes to answer from here.
    const probeStarted = performance.now();
    const probeMs = await Promise.resolve().then(() => perf.runWith(perf.newContext({ kind: 'probe', name: 'ping-probe', interactive: true }), () => client.rest.get(Routes.gateway()))).then(() => performance.now() - probeStarted, () => null);
    const shardCount = client.shard?.count ?? 1;
    const shard = (client.shard?.ids?.[0] ?? 0) + 1;
    await interaction.editReply({
      components: [buildPingCard({ guildMs, apiMs: client.ws.ping, probeMs, shard, shardCount, guilds: client.guilds.cache.size, lang })],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
