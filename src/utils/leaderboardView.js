// The leaderboard of `/top` laid out as an embed with two generated pictures, both small and cached: on the first page a podium strip with the top
// three (avatar, medal, name, level and XP), and at the bottom the position of the person who asked, with the same progress bar picture as `/rank`.
// The other places are an aligned table (position, name, level, XP) in a code block. When a picture cannot be had, the embed still answers: the
// table then lists everybody and the bar is a thin line of plain characters.
const crypto = require('node:crypto');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const levelUsersDb = require('../db/levelUsers');
const periods = require('../db/levelPeriods');
const { totalXpForLevel, xpNeeded } = require('./levelCurve');
const { buildLevelData } = require('./levelData');
const { buildThinBar } = require('./levelProgressBar');
const { renderRankBar } = require('./rankBar');
const { loadAvatar, avatarLink } = require('./avatarCache');
const { createPictureCache } = require('./renderQueue');
const { drawPodium } = require('../imgutils/podiumImage');
const { t, tn, formatNumber, currentLanguage } = require('../i18n');

const PER_PAGE = 10;
const COLOR = 0x4b4f59;
const NAME_WIDTH = 12;
const PODIUM_FILE = 'podium.webp';
const NUMBER_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu;
const TITLES = {
  messages: { all: 'leveling.top.title', week: 'leveling.top.titleWeek', month: 'leveling.top.titleMonth' },
  voice: { all: 'leveling.top.titleVoice', week: 'leveling.top.titleVoiceWeek', month: 'leveling.top.titleVoiceMonth' },
};

// BOARD_IMAGE_CACHE_TTL_MS (default 30000, 1000 to 600000): how long a finished podium is reused for the same top three.
const podiums = createPictureCache({ ttlMs: Math.min(600_000, Math.max(1_000, Math.floor(Number(process.env.BOARD_IMAGE_CACHE_TTL_MS)) || 30_000)), maxEntries: 100 });

/** 2400000 as `2.4M`, written the way the language does it. */
function compact(lang, value) {
  return new Intl.NumberFormat(NUMBER_LOCALES[lang] ?? 'en-US', { notation: 'compact' }).format(Number(value) || 0);
}

/** A name that fits a column of a code block: no emoji or backticks (they would break the alignment or the block), cut with an ellipsis. */
function columnName(name, width = NAME_WIDTH) {
  const clean = Array.from(String(name).replace(EMOJI, '').replace(/`/g, "'").replace(/\s+/g, ' ').trim());
  if (!clean.length) return '?';
  return clean.length > width ? `${clean.slice(0, width - 1).join('').trimEnd()}…` : clean.join('');
}

/** The rows of a page: who, level, XP and what is needed, for the all-time ranking or for a week or a month. */
async function loadEntries(guild, { page, source, period, config }) {
  const offset = (page - 1) * PER_PAGE;
  const voice = source === 'voice';
  const rows = period === 'all'
    ? await (voice ? levelUsersDb.getVoiceLeaderboardPage : levelUsersDb.getLeaderboardPage)(guild.id, { offset, limit: PER_PAGE })
    : await periods.boardPage(guild.id, period, voice ? 'voice' : 'text', { offset, limit: PER_PAGE });
  return rows.map((row, i) => {
    const member = guild.members?.cache?.get(row.user_id);
    const user = member?.user ?? guild.client?.users?.cache?.get(row.user_id) ?? null;
    const entry = {
      position: offset + i + 1,
      id: row.user_id,
      name: member?.displayName ?? user?.displayName ?? user?.username ?? `…${String(row.user_id).slice(-4)}`,
      avatarUrl: (member ?? user)?.displayAvatarURL?.({ extension: 'webp', size: 128, forceStatic: true }) ?? null,
      level: null, xp: Number(row.xp ?? 0), current: null, needed: null,
    };
    if (period === 'all') {
      entry.xp = Number(voice ? row.voice_xp ?? 0 : row.xp ?? 0);
      entry.level = Number(voice ? row.voice_level ?? 0 : row.level ?? 0);
      entry.current = Math.max(0, entry.xp - totalXpForLevel(entry.level, config));
      entry.needed = xpNeeded(entry.level, config);
    }
    return entry;
  });
}

/** The podium picture of the first three as `{ buffer, name }`, from the cache when the same three were drawn a moment ago, or null. */
async function podiumFile(top, lang) {
  const ready = top.map((entry) => ({
    position: entry.position, name: entry.name,
    line1: entry.level === null ? `${compact(lang, entry.xp)} XP` : t(lang, 'leveling.board.podiumLevel', { level: formatNumber(lang, entry.level) }),
    line2: entry.level === null ? '' : `${compact(lang, entry.xp)} XP`,
    avatarUrl: entry.avatarUrl,
  }));
  const key = crypto.createHash('sha1').update(JSON.stringify(ready.map((e) => [e.position, e.name, e.line1, e.line2, avatarLink(e.avatarUrl)]))).digest('hex');
  try {
    return await podiums.get(key, async () => {
      const avatars = await Promise.all(ready.map((entry) => (entry.avatarUrl ? loadAvatar(entry.avatarUrl, 128) : null)));
      const canvas = drawPodium(ready.map((entry, i) => ({ ...entry, avatar: avatars[i] })));
      return { buffer: await canvas.encode('webp', 88), name: PODIUM_FILE };
    });
  } catch {
    return null;
  }
}

/** The aligned table of the rows that are not on the podium, as a code block. */
function buildTable(entries, lang) {
  const hasLevel = entries.every((entry) => entry.level !== null);
  const pos = Math.max(2, String(entries[entries.length - 1].position).length);
  const levels = entries.map((entry) => (hasLevel ? String(entry.level) : ''));
  const xps = entries.map((entry) => compact(lang, entry.xp));
  const lvW = hasLevel ? Math.max(2, ...levels.map((v) => v.length)) : 0;
  const xpW = Math.max(2, ...xps.map((v) => v.length));
  const line = (a, b, c, d) => `${a} ${b}${hasLevel ? ` ${c.padStart(lvW)}` : ''} ${d.padStart(xpW)}`;
  const header = line('#'.padStart(pos), t(lang, 'leveling.board.colMember').padEnd(NAME_WIDTH), t(lang, 'leveling.board.colLevel'), t(lang, 'leveling.board.colXp'));
  const body = entries.map((entry, i) => line(String(entry.position).padStart(pos, '0'), columnName(entry.name).padEnd(NAME_WIDTH), levels[i], xps[i]));
  return `\`\`\`\n${[header, ...body].join('\n')}\n\`\`\``;
}

/** The position of the person who asked, as the text under the table and the progress bar picture (null for a week or a month: it has no level). */
async function viewerBlock({ guild, viewerId, source, period, config, total, lang }) {
  if (!viewerId) return null;
  const voice = source === 'voice';
  try {
    if (period !== 'all') {
      const standing = await periods.memberStanding(guild.id, viewerId, period, voice ? 'voice' : 'text');
      return standing ? { text: t(lang, 'leveling.board.youPeriod', { position: formatNumber(lang, standing.position), total: formatNumber(lang, total), xp: formatNumber(lang, standing.xp) }) } : null;
    }
    const userData = await levelUsersDb.getUser(guild.id, viewerId);
    const xp = Number(voice ? userData?.voice_xp ?? 0 : userData?.xp ?? 0);
    if (!userData || xp <= 0) return null;
    const rank = await (voice ? levelUsersDb.getVoiceRank : levelUsersDb.getRank)(guild.id, xp);
    const data = buildLevelData({ config, userData, source: voice ? 'voice' : 'messages', rank, total });
    const n = (value) => formatNumber(lang, value);
    const text = `${t(lang, 'leveling.board.youLine', { rank: n(rank), total: n(total), level: n(data.level) })}\n-# ${t(lang, 'leveling.board.youXp', { current: n(data.xpCurrent), needed: n(data.xpNeeded), percent: data.progress })}`;
    return { text, progress: data.progress, voice };
  } catch {
    return null;
  }
}

/**
 * The reply for one page: `{ embeds, files, attachments }` (the last one empties the old files when a page is edited in place).
 * `total` and `totalPages` come from the command. `viewerId` is who asked, for the "You" line. Database errors are the caller's, as before; a
 * picture that cannot be had never makes the page fail.
 */
async function buildLeaderboardReply({ guild, page, totalPages, total, source = 'messages', period = 'all', config, lang = currentLanguage(), viewerId = null }) {
  const entries = await loadEntries(guild, { page, source, period, config });
  const title = t(lang, TITLES[source === 'voice' ? 'voice' : 'messages'][period], { server: guild.name });
  const footer = tn(lang, 'leveling.top.footer', total, { page: formatNumber(lang, page), pages: formatNumber(lang, totalPages) });
  const files = [];
  // The server's icon and the title in one line at the top (a thumbnail would leave a gap above the picture).
  const header = new EmbedBuilder().setColor(COLOR).setAuthor({ name: title, iconURL: guild.iconURL?.() ?? undefined });

  const podium = page === 1 && entries.length ? await podiumFile(entries.slice(0, 3), lang) : null;
  if (podium) { files.push(new AttachmentBuilder(podium.buffer, { name: podium.name })); header.setImage(`attachment://${podium.name}`); }
  const rest = podium ? entries.slice(3) : entries;

  const list = podium ? new EmbedBuilder().setColor(COLOR) : header;
  const parts = [];
  if (!entries.length) parts.push(t(lang, 'leveling.top.noData'));
  if (rest.length) parts.push(buildTable(rest, lang));
  const viewer = await viewerBlock({ guild, viewerId, source, period, config, total, lang });
  if (viewer) {
    parts.push(viewer.text);
    const bar = viewer.progress === undefined ? null : await renderRankBar({ percent: viewer.progress, voice: viewer.voice }).catch(() => null);
    if (bar) { files.push(new AttachmentBuilder(bar.buffer, { name: bar.name })); list.setImage(`attachment://${bar.name}`); }
    else if (viewer.progress !== undefined) parts.push(buildThinBar(viewer.progress));
  }
  if (parts.length) list.setDescription(parts.join('\n'));
  list.setFooter({ text: footer });
  return { embeds: podium ? [header, list] : [list], files, attachments: [] };
}

module.exports = { PER_PAGE, compact, columnName, buildTable, buildLeaderboardReply, clearBoardImages: () => podiums.clear(), boardImageCacheSize: () => podiums.stats() };
