// i18n-ignore-file: the words on the picture come from the i18n catalog (`profiles.image.*`); the rest are ids and numbers.
// Puts together what `/profile` draws for a person: reads their level numbers of the server, their badges and showcase, loads the pictures
// and gives the PNG. The drawing itself is utils/profileImage.ts (no database), the rules of the badges are utils/profileBadges.ts.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileView.js.
import type { Image } from '@napi-rs/canvas';
import type { ProfileImageData, ShowcaseBadge } from './profileImage';
import type { PlanKey } from './profileBadges';
const path = require('node:path') as typeof import('node:path');
const { loadImage } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const { loadImageFromLink } = require('./safeImage') as { loadImageFromLink: (url: string) => Promise<Image> };
const { renderProfileImage } = require('./profileImage') as { renderProfileImage: (data: ProfileImageData) => Buffer };
const badgesRules = require('./profileBadges') as typeof import('./profileBadges');
const registry = require('./badgeRegistry') as typeof import('./badgeRegistry');
const profileDb = require('../db/userProfile') as typeof import('../db/userProfile');
const shopDb = require('../db/shop') as typeof import('../db/shop');
const levelUsersDb = require('../db/levelUsers') as { getUser: (g: string, u: string) => Promise<Record<string, unknown> | null>; getRank: (g: string, xp: number) => Promise<number> };
const { t, formatNumber } = require('../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; formatNumber: (lang: string, n: number) => string };

const ART_DIR = path.join(__dirname, '..', 'assets', 'badges');
const artCache = new Map<string, Image>();

export async function artOf(file: string | null): Promise<Image | null> {
  if (!file) return null;
  const cached = artCache.get(file);
  if (cached) return cached;
  try {
    const image = await loadImage(path.join(ART_DIR, file));
    artCache.set(file, image);
    return image;
  } catch { return null; }
}

const flagCache = new Map<string, Image | null>();
const FLAGS_DIR = ((): string | null => { try { return path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '1x1'); } catch { return null; } })();

/** The flag of a country (the open `flag-icons` package, square), or null when it is not there: the badge is then drawn with its code. */
async function flagOf(region: string): Promise<Image | null> {
  const code = region.toLowerCase();
  if (!FLAGS_DIR || !/^[a-z]{2}$/.test(code)) return null;
  if (flagCache.has(code)) return flagCache.get(code) ?? null;
  try {
    const image = await loadImage(await require('node:fs/promises').readFile(path.join(FLAGS_DIR, `${code}.svg`)));
    if (flagCache.size >= 300) flagCache.delete(flagCache.keys().next().value as string);
    flagCache.set(code, image);
    return image;
  } catch { flagCache.set(code, null); return null; }
}

/** The picture of a badge: the flag of its country, or its art file, or nothing (it is drawn with its colour and its code). */
export async function artOfBadge(def: import('./profileBadges').BadgeDef): Promise<Image | null> {
  if (def.region) return flagOf(def.region);
  if (def.custom) return registry.customArt(def);
  return artOf(def.art);
}

/** A voice time with its unit, short: `45 min`, `5 h 20 m`, `12 h`, `3 d 4 h`. Never a bare number. */
export function formatVoice(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 10) return minutes % 60 ? `${hours} h ${minutes % 60} m` : `${hours} h`;
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** The plan a person pays for, or null. The plans of a person are not sold yet, so nobody has one until that table exists. */
export async function planOfUser(_userId: string): Promise<PlanKey | null> {
  return null;
}

/** What a person has: their badges (saved plus the one of their plan), the places their plan gives and the list they put in the showcase. */
export async function profileState(userId: string): Promise<{ plan: PlanKey | null; owned: string[]; slots: number; showcase: string[]; frames: Record<string, string>; items: { kind: 'banner' | 'font'; id: string }[]; active: { banner: string | null; font: string | null } }> {
  await registry.ensure();
  const [plan, saved, chosen, granted, items, active] = await Promise.all([planOfUser(userId), profileDb.getBadgeRows(userId), profileDb.getShowcase(userId), registry.grantedFor(userId), shopDb.getUserItems(userId), shopDb.getActive(userId)]);
  // A badge that is given by itself is had while the person is what it says: it is saved when they first are (so it can have a frame) and left out when they stop.
  const ruled = new Set(badgesRules.allBadges().filter((def) => def.custom && def.grantRule).map((def) => def.id));
  const rows = [...saved];
  for (const id of granted) {
    if (rows.some((row) => row.id === id)) continue;
    await profileDb.addBadge(userId, id, 'status').catch(() => false);
    rows.push({ id, frame: 'normal', source: 'status' });
  }
  const effective = rows.filter((row) => !(ruled.has(row.id) && !granted.includes(row.id)));
  const owned = badgesRules.ownedBadges(effective.map((row) => row.id), plan);
  const frames = Object.fromEntries(effective.map((row) => [row.id, row.frame]));
  const slots = badgesRules.slotsFor(plan);
  return { plan, owned, slots, showcase: badgesRules.normalizeShowcase(chosen, owned, slots), frames, items, active };
}

async function picture(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  try { return await loadImageFromLink(url); } catch { return null; }
}

interface UserLike { id: string; username: string; displayAvatarURL: (o: object) => string; bannerURL?: (o: object) => string | null | undefined }

/** The PNG of the profile of `user` in a server. `member` gives the nickname and the avatar of the server when they have them. */
export async function buildProfileImage(opts: { guildId: string; user: UserLike; member?: { displayName?: string; displayAvatarURL: (o: object) => string } | null; lang: string }): Promise<Buffer> {
  const { guildId, user, member, lang } = opts;
  const [state, row, voiceSeconds] = await Promise.all([profileState(user.id), levelUsersDb.getUser(guildId, user.id).catch(() => null), profileDb.getVoiceSeconds(guildId, user.id).catch(() => 0)]);
  const xp = Number(row?.xp ?? 0);
  const rank = xp > 0 ? await levelUsersDb.getRank(guildId, xp).catch(() => null) : null;
  const dash = '–';
  // A banner of the shop that the person put on goes over the banner of their Discord; a name font of the shop changes how their name is drawn.
  const ownsItem = (kind: 'banner' | 'font', id: string | null): id is string => Boolean(id) && state.items.some((item) => item.kind === kind && item.id === id);
  const [avatar, banner, shopBanner, nameFont] = await Promise.all([
    picture((member ?? user).displayAvatarURL({ size: 256, extension: 'png' })),
    picture(user.bannerURL?.({ size: 1024, extension: 'png' })),
    ownsItem('banner', state.active.banner) ? registry.bannerImage(state.active.banner) : Promise.resolve(null),
    ownsItem('font', state.active.font) ? registry.fontFamily(state.active.font) : Promise.resolve(null),
  ]);
  const planStar = state.plan ? await artOf(`plan-${state.plan}.png`) : null;
  const showcase: ShowcaseBadge[] = [];
  for (const id of state.showcase) {
    const def = badgesRules.badgeById(id);
    if (def) showcase.push({ id, art: await artOfBadge(def), color: def.color, label: badgesRules.badgeLabel(def) || undefined, frame: state.frames[id] ?? 'normal' });
  }
  return renderProfileImage({
    name: member?.displayName ?? user.username,
    avatar, banner: shopBanner ?? banner, planStar, nameFont,
    stats: [
      { label: t(lang, 'profiles.image.level'), value: row ? formatNumber(lang, Number(row.level ?? 0)) : dash },
      { label: t(lang, 'profiles.image.rank'), value: rank ? `#${formatNumber(lang, rank)}` : dash },
      { label: t(lang, 'profiles.image.messages'), value: row ? formatNumber(lang, Number(row.messages ?? 0)) : dash },
      { label: t(lang, 'profiles.image.voice'), value: voiceSeconds > 0 ? formatVoice(voiceSeconds) : dash },
    ],
    showcase, slots: state.slots, showcaseTitle: t(lang, 'profiles.image.badges'),
  });
}
