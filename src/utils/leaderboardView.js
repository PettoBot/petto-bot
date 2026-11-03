// The leaderboard of `/top` laid out as an embed with two generated pictures, both small and cached: on the first page a podium strip with the top
// three (avatar, medal, name, level and XP), and at the bottom the position of the person who asked, with the same progress bar picture as `/rank`.
// The other places are one line of text each (`04` **Name** · Lv. 70 · 1.5M XP) that wraps by itself, so a long name cannot break anything. When a
// picture cannot be had, the embed still answers: the lines then list everybody and the bar is a thin line of plain characters.
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
const NAME_WIDTH = 18; // how many columns of a name are shown; a wide character (Chinese, an emoji) takes two
const PODIUM_FILE = 'podium.webp';
const NUMBER_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const PICTOGRAPH = /^[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const WIDE = /^[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
// Characters that can reorder the text around a name or hide it: bidirectional controls and zero-width marks (the joiner of an emoji is kept).
const CONTROLS = /[\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff\u0000-\u001f\u007f]/g;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
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

/** The columns a letter takes: two for a wide character or an emoji, one for the rest. */
const columns = (grapheme) => (PICTOGRAPH.test(grapheme) || WIDE.test(grapheme) ? 2 : 1);

/**
 * A name made safe to put in bold in a line of text: bidirectional and zero-width controls removed, cut by letters (graphemes, so an emoji or an
 * accented letter is never split) to `width` columns with an ellipsis, Markdown and mentions escaped, and isolated so a right-to-left name cannot
 * reorder what is around it. A name with nothing left is a question mark.
 */
function displayName(name, width = NAME_WIDTH) {
  const letters = Array.from(SEGMENTER.segment(String(name).replace(/\s+/g, ' ').replace(CONTROLS, '').trim()), (part) => part.segment);
  if (!letters.length) return '?';
  let text = letters.join('');
  if (letters.reduce((sum, letter) => sum + columns(letter), 0) > width) {
    let used = 0;
    const kept = [];
    for (const letter of letters) {
      if (used + columns(letter) > width - 1) break; // one column is left for the ellipsis
      used += columns(letter);
      kept.push(letter);
    }
    text = `${kept.join('').trimEnd()}\u2026`;
  }
  text = text.replace(/[\\*_~|`>#@<\[\]():]/g, '\\$&');
  return `\u2068${text}\u2069`;
}

/** One place of the leaderboard as a line of text: `04` **Name** · Lv. 70 · 1.5M XP (a week or a month has no level). */
function memberLine(entry, pos, lang) {
  // The level and the XP never split (a no-break space inside each piece and around the dot), so when a line wraps, the numbers move together.
  const stats = [];
  if (entry.level !== null) stats.push(t(lang, 'leveling.board.podiumLevel', { level: formatNumber(lang, entry.level) }));
  stats.push(`${compact(lang, entry.xp)} XP`);
  return `\`${String(entry.position).padStart(pos, '0')}\` **${displayName(entry.name)}**\u00a0\u00b7 ${stats.map((text) => text.replace(/ /g, '\u00a0')).join('\u00a0\u00b7\u00a0')}`;
}

/** The places that are not on the podium, one line each. */
function buildLines(entries, lang) {
  const pos = Math.max(2, String(entries[entries.length - 1].position).length);
  return entries.map((entry) => memberLine(entry, pos, lang)).join('\n');
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
  if (rest.length) parts.push(buildLines(rest, lang));
  const viewer = await viewerBlock({ guild, viewerId, source, period, config, total, lang });
  if (viewer) {
    parts.push(`\n${viewer.text}`);
    const bar = viewer.progress === undefined ? null : await renderRankBar({ percent: viewer.progress, voice: viewer.voice }).catch(() => null);
    if (bar) { files.push(new AttachmentBuilder(bar.buffer, { name: bar.name })); list.setImage(`attachment://${bar.name}`); }
    else if (viewer.progress !== undefined) parts.push(buildThinBar(viewer.progress));
  }
  if (parts.length) list.setDescription(parts.join('\n'));
  list.setFooter({ text: footer });
  return { embeds: podium ? [header, list] : [list], files, attachments: [] };
}

module.exports = { PER_PAGE, compact, displayName, memberLine, buildLines, buildLeaderboardReply, clearBoardImages: () => podiums.clear(), boardImageCacheSize: () => podiums.stats() };
