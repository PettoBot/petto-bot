// i18n-ignore-file: the names of the channels are written for the support server of Petto, they are not an answer of a command.
// The category "@ stats" of the support server: two voice channels that everybody sees and nobody can join, one with the members of all the servers
// of Petto and one with the number of servers. The numbers are whole (12,480, never 12K). The names are changed at most every 10 minutes, because
// Discord only lets a channel be renamed twice in 10 minutes. The category and the channels are made again when they are deleted.
// Written in TypeScript: `npm run build:ts` compiles it over utils/statsCategory.js.
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { CategoryChannel, Client, Guild, VoiceChannel } from 'discord.js';

export const CATEGORY_NAME = '@ stats';
export const STATS_EVERY_MS = 10 * 60_000;

export type StatKey = 'members' | 'servers';

/** The name of a channel: the label, a dot and the whole number (`Members • 12,480`). */
export function channelName(key: StatKey, value: number): string {
  const label = key === 'members' ? 'Members' : 'Servers';
  return `${label} • ${Math.max(0, Math.floor(value)).toLocaleString('en-US')}`;
}

/** Which of the two channels a name belongs to, from its label (so the channels are found again even when the number changed). */
export function keyOfName(name: string): StatKey | null {
  if (/^members\b/i.test(name)) return 'members';
  if (/^servers\b/i.test(name)) return 'servers';
  return null;
}

/** The numbers of every server of the bot: how many there are and how many members they have together (from the cache, it costs nothing). */
export function readNumbers(client: Client): Record<StatKey, number> {
  const guilds = [...client.guilds.cache.values()];
  return { servers: guilds.length, members: guilds.reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0) };
}

/** Everybody sees the channel, nobody joins it (the permissions of the category go to its channels). */
function lockedPermissions(guild: Guild) {
  return [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] }];
}

export interface Report { created: string[]; renamed: string[]; skipped: string | null }

/**
 * Makes sure the category and its two channels exist and shows the numbers. Only a channel whose name changed is renamed.
 * `skipped` says why nothing was done (no server set, the server is not in the cache, Petto cannot manage channels there).
 */
export async function updateStatsCategory(client: Client, guildId: string | null, numbers: Record<StatKey, number> = readNumbers(client)): Promise<Report> {
  const report: Report = { created: [], renamed: [], skipped: null };
  if (!guildId) { report.skipped = 'no support server set (PETTO_SUPPORT_GUILD_ID)'; return report; }
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) { report.skipped = 'the support server is not reachable'; return report; }
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) { report.skipped = 'Petto cannot manage channels in the support server'; return report; }

  await guild.channels.fetch();
  let category = guild.channels.cache.find((channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === CATEGORY_NAME) ?? null;
  if (!category) {
    category = await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory, permissionOverwrites: lockedPermissions(guild), reason: 'Petto stats' });
    report.created.push(CATEGORY_NAME);
  }
  const inside = guild.channels.cache.filter((channel): channel is VoiceChannel => channel.type === ChannelType.GuildVoice && channel.parentId === category!.id);
  for (const key of ['members', 'servers'] as StatKey[]) {
    const wanted = channelName(key, numbers[key]);
    const found = inside.find((channel) => keyOfName(channel.name) === key);
    if (!found) {
      await guild.channels.create({ name: wanted, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: lockedPermissions(guild), reason: 'Petto stats' });
      report.created.push(wanted);
    } else if (found.name !== wanted) {
      await found.setName(wanted, 'Petto stats');
      report.renamed.push(wanted);
    }
  }
  return report;
}
