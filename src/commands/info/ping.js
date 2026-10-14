const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { SUPPORT_URL } = require('../../utils/links');

const STATUS_URL = 'https://petto.sbs/status';
const GREEN = 0xa5ea7a;
const YELLOW = 0xffd563;
const RED = 0xff6b6b;

const compact = (n) => Number(n).toLocaleString('en-US');

/** The color follows the slowest of the two latencies: green is fast, yellow is slow, red is bad. */
function colorFor(guildMs, apiMs) {
  const worst = Math.max(guildMs, Number.isFinite(apiMs) ? apiMs : 0);
  return worst < 300 ? GREEN : worst < 700 ? YELLOW : RED;
}

/** The card of the ping: both latencies, the links and the size of Petto. Pure, so it can be checked without Discord. */
function buildPingCard({ guildMs, apiMs, shard, shardCount, guilds, members }) {
  const api = Number.isFinite(apiMs) ? `${Math.round(apiMs)}ms` : 'N/A';
  return textCard([
    `**Guild Ping:** \`${Math.max(0, Math.round(guildMs))}ms\``,
    `**API Ping:** \`${api}\``,
    `[Status Page](${STATUS_URL}) · [Support Server](${SUPPORT_URL})`,
    `-# Shard ${shard}/${shardCount} • Guilds: ${compact(guilds)} • Members: ${compact(members)}`,
  ].join('\n'), colorFor(guildMs, apiMs));
}

module.exports = {
  aliases: ['p'],
  buildPingCard,
  data: new SlashCommandBuilder().setName('ping').setDescription("Shows Petto's latency and how big it is."),

  async execute(interaction) {
    const startedAt = Date.now();
    await interaction.reply({ components: [textCard('Pinging...', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    const sent = await interaction.fetchReply().catch(() => null);
    const guildMs = Math.max(0, (sent?.createdTimestamp ?? Date.now()) - startedAt);
    const { client } = interaction;
    const shardCount = client.shard?.count ?? 1;
    const shard = (client.shard?.ids?.[0] ?? 0) + 1;
    const members = client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount ?? 0), 0);
    await interaction.editReply({
      components: [buildPingCard({ guildMs, apiMs: client.ws.ping, shard, shardCount, guilds: client.guilds.cache.size, members })],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
