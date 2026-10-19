const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { SUPPORT_URL } = require('../../utils/links');
const { t, formatNumber, languageOf } = require('../../i18n');

const STATUS_URL = 'https://petto.sbs/status';
const GREEN = 0xa5ea7a;
const YELLOW = 0xffd563;
const RED = 0xff6b6b;

/** The color follows the slowest of the two latencies: green is fast, yellow is slow, red is bad. */
function colorFor(guildMs, apiMs) {
  const worst = Math.max(guildMs, Number.isFinite(apiMs) ? apiMs : 0);
  return worst < 300 ? GREEN : worst < 700 ? YELLOW : RED;
}

/** The card of the ping: both latencies, the links and the size of Petto. Pure, so it can be checked without Discord. */
function buildPingCard({ guildMs, apiMs, shard, shardCount, guilds, members, lang = 'en' }) {
  const api = Number.isFinite(apiMs) ? `${Math.round(apiMs)}ms` : t(lang, 'info.ping.unknown');
  return textCard([
    t(lang, 'info.ping.guild', { ms: `${Math.max(0, Math.round(guildMs))}ms` }),
    t(lang, 'info.ping.api', { ms: api }),
    t(lang, 'info.ping.links', { statusUrl: STATUS_URL, supportUrl: SUPPORT_URL }),
    t(lang, 'info.ping.footer', { shard, shardCount, guilds: formatNumber(lang, guilds), members: formatNumber(lang, members) }),
  ].join('\n'), colorFor(guildMs, apiMs));
}

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  aliases: ['p'],
  buildPingCard,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDMPermission(false)
    .setDescription("Shows Petto's latency and how big it is."),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const startedAt = Date.now();
    await interaction.reply({ components: [textCard(t(lang, 'info.ping.pinging'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    const sent = await interaction.fetchReply().catch(() => null);
    const guildMs = Math.max(0, (sent?.createdTimestamp ?? Date.now()) - startedAt);
    const { client } = interaction;
    const shardCount = client.shard?.count ?? 1;
    const shard = (client.shard?.ids?.[0] ?? 0) + 1;
    const members = client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount ?? 0), 0);
    await interaction.editReply({
      components: [buildPingCard({ guildMs, apiMs: client.ws.ping, shard, shardCount, guilds: client.guilds.cache.size, members, lang })],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
