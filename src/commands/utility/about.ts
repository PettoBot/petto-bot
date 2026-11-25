// i18n-ignore-file: the texts are in the catalog (about.*); the builder holds the English description that scripts/i18n-commands.js copies.
// /about (and `!about`): who Petto is, in one card: the bot (version, how long it has been up, how many servers and members, its shards and where they run), the server where it was
// used (name, owner, members, channels, roles, when it was made, the shard and the instance that look after it), where the bot is hosted (CubePath and Discloud) and the links.
// A global command: it works in any server (not in direct messages, like the other global commands that are not installed on a person). Written in TypeScript: `npm run build:ts` compiles it over about.js.
import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, Guild } from 'discord.js';
import type { ShardLine } from '../../utils/botTotals';

const { infoPayload, line } = require('../../utils/infoCard') as { infoPayload: (options: Record<string, unknown>) => unknown; line: (label: string, value: unknown) => string | null };
const { t, languageOf, formatNumber } = require('../../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (i: unknown) => Promise<string>; formatNumber: (lang: string, n: number) => string };
const { formatDuration } = require('../../utils/duration') as { formatDuration: (ms: number, lang: string) => string };
const { readTotals, readShardLines } = require('../../utils/botTotals') as typeof import('../../utils/botTotals');
const { shardForPing } = require('../../utils/shardReport') as typeof import('../../utils/shardReport');
const { premiumPage } = require('./purchase') as { premiumPage: (lang: string) => string };
const { version: pettoVersion } = require('../../../package.json') as { version: string };

const SITE = 'https://petto.sbs';
const CUBEPATH = 'https://cubepath.com';
const DISCLOUD = 'https://discloud.com';

/** The place of an instance as people read it: `Miami · Florida, US`, or just what is known. */
function placeOf(line: Pick<ShardLine, 'clusterName' | 'clusterLocation'> | undefined): string | null {
  return line ? ([line.clusterName, line.clusterLocation].filter(Boolean).join(' · ') || null) : null;
}

/** How many shards the bot has and on how many instances (clusters) they run, from what the shards report (only the ones that reported lately count as running). */
function shardSummary(lines: readonly ShardLine[], configured: number): { shards: number; clusters: number | null } {
  const shards = Math.max(Number(configured) || 0, ...lines.map((each) => each.shardId + 1), 1);
  const names = new Set(lines.filter((each) => each.fresh && each.clusterName).map((each) => each.clusterName));
  return { shards, clusters: names.size || null };
}

interface CardParts { lang: string; client: ChatInputCommandInteraction['client']; guild: Guild | null }

/** The card, with every number already read. */
async function buildAboutCard({ lang, client, guild }: CardParts): Promise<unknown> {
  const [totals, lines] = await Promise.all([readTotals(client), readShardLines()]);
  const { shards, clusters } = shardSummary(lines, Number(client.options?.shardCount) || 1);
  const own = shardForPing(client as never, guild);
  const ownLine = lines.find((each) => each.shardId === own.shard - 1);
  const place = placeOf(ownLine);
  const shardCount = Math.max(shards, own.shardCount);
  const created = guild ? Math.floor(guild.createdTimestamp / 1000) : 0;

  const sections: { title: string; lines: (string | null)[]; limit?: number }[] = [
    {
      title: t(lang, 'about.bot.title'),
      lines: [
        line(t(lang, 'about.bot.version'), `v${pettoVersion}`),
        line(t(lang, 'about.bot.uptime'), formatDuration(Number(client.uptime) || 0, lang)),
        line(t(lang, 'about.bot.servers'), formatNumber(lang, totals.servers)),
        line(t(lang, 'about.bot.members'), formatNumber(lang, totals.members)),
        line(t(lang, 'about.bot.shards'), formatNumber(lang, shardCount)),
        line(t(lang, 'about.bot.clusters'), clusters === null ? null : formatNumber(lang, clusters)),
      ],
    },
  ];
  if (guild) {
    sections.push({
      title: t(lang, 'about.server.title'),
      lines: [
        line(t(lang, 'about.server.name'), guild.name),
        line(t(lang, 'about.server.owner'), guild.ownerId ? `<@${guild.ownerId}>` : null),
        line(t(lang, 'about.server.members'), formatNumber(lang, Number(guild.memberCount) || 0)),
        line(t(lang, 'about.server.channels'), formatNumber(lang, guild.channels?.cache?.size ?? 0)),
        line(t(lang, 'about.server.roles'), formatNumber(lang, guild.roles?.cache?.size ?? 0)),
        line(t(lang, 'about.server.created'), created ? `<t:${created}:D>` : null),
        line(t(lang, 'about.server.shard'), t(lang, place ? 'about.server.shard.place' : 'about.server.shard.value', { shard: own.shard, count: shardCount, place: place ?? '' })),
      ],
    });
  }
  sections.push({
    title: t(lang, 'about.hosting.title'),
    lines: [t(lang, 'about.hosting.powered', { cubepath: CUBEPATH, discloud: DISCLOUD }), t(lang, 'about.hosting.thanks')],
  });

  return infoPayload({
    title: client.user?.username ?? 'Petto',
    thumbnail: client.user?.displayAvatarURL({ size: 512 }),
    subtitle: [t(lang, 'about.subtitle')],
    sections,
    footer: t(lang, 'info.card.id', { id: client.user?.id ?? '' }),
    buttons: [
      { label: t(lang, 'about.button.web'), url: SITE },
      { label: t(lang, 'about.button.support'), url: `${SITE}/support` },
      { label: t(lang, 'about.button.status'), url: `${SITE}/status` },
      { label: t(lang, 'about.button.invite'), url: `${SITE}/invite` },
      { label: t(lang, 'about.button.premium'), url: premiumPage(lang) },
    ],
  });
}

module.exports = {
  registerSlash: true, // global: the 100 slots have room for it (it takes the 92nd)
  buildAboutCard,
  SITE,
  CUBEPATH,
  DISCLOUD,
  placeOf,
  shardSummary,
  data: new SlashCommandBuilder().setName('about').setDescription('About Petto: the bot, this server, where it runs and useful links.').setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    await interaction.reply(await buildAboutCard({ lang, client: interaction.client, guild: interaction.guild }) as never);
  },
};
