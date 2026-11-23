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
const profileDb = require('../db/userProfile') as typeof import('../db/userProfile');
const levelUsersDb = require('../db/levelUsers') as { getUser: (g: string, u: string) => Promise<Record<string, unknown> | null>; getRank: (g: string, xp: number) => Promise<number> };
const { t, formatNumber } = require('../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; formatNumber: (lang: string, n: number) => string };

const ART_DIR = path.join(__dirname, '..', 'assets', 'badges');
const artCache = new Map<string, Image>();

async function artOf(file: string | null): Promise<Image | null> {
  if (!file) return null;
  const cached = artCache.get(file);
  if (cached) return cached;
  try {
    const image = await loadImage(path.join(ART_DIR, file));
    artCache.set(file, image);
    return image;
  } catch { return null; }
}

/** The plan a person pays for, or null. The plans of a person are not sold yet, so nobody has one until that table exists. */
export async function planOfUser(_userId: string): Promise<PlanKey | null> {
  return null;
}

/** What a person has: their badges (saved plus the one of their plan), the places their plan gives and the list they put in the showcase. */
export async function profileState(userId: string): Promise<{ plan: PlanKey | null; owned: string[]; slots: number; showcase: string[] }> {
  const [plan, saved, chosen] = await Promise.all([planOfUser(userId), profileDb.getSavedBadges(userId), profileDb.getShowcase(userId)]);
  const owned = badgesRules.ownedBadges(saved, plan);
  const slots = badgesRules.slotsFor(plan);
  return { plan, owned, slots, showcase: badgesRules.normalizeShowcase(chosen, owned, slots) };
}

async function picture(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  try { return await loadImageFromLink(url); } catch { return null; }
}

interface UserLike { id: string; username: string; displayAvatarURL: (o: object) => string; bannerURL?: (o: object) => string | null | undefined }

/** The PNG of the profile of `user` in a server. `member` gives the nickname and the avatar of the server when they have them. */
export async function buildProfileImage(opts: { guildId: string; user: UserLike; member?: { displayName?: string; displayAvatarURL: (o: object) => string } | null; lang: string }): Promise<Buffer> {
  const { guildId, user, member, lang } = opts;
  const [state, row] = await Promise.all([profileState(user.id), levelUsersDb.getUser(guildId, user.id).catch(() => null)]);
  const xp = Number(row?.xp ?? 0);
  const rank = xp > 0 ? await levelUsersDb.getRank(guildId, xp).catch(() => null) : null;
  const dash = '–';
  const [avatar, banner] = await Promise.all([
    picture((member ?? user).displayAvatarURL({ size: 256, extension: 'png' })),
    picture(user.bannerURL?.({ size: 1024, extension: 'png' })),
  ]);
  const planStar = state.plan ? await artOf(`plan-${state.plan}.png`) : null;
  const showcase: ShowcaseBadge[] = [];
  for (const id of state.showcase) {
    const def = badgesRules.badgeById(id);
    if (def) showcase.push({ id, art: await artOf(def.art), color: def.color });
  }
  return renderProfileImage({
    name: member?.displayName ?? user.username,
    avatar, banner, planStar,
    stats: [
      { label: t(lang, 'profiles.image.level'), value: row ? formatNumber(lang, Number(row.level ?? 0)) : dash },
      { label: t(lang, 'profiles.image.rank'), value: rank ? `#${formatNumber(lang, rank)}` : dash },
      { label: t(lang, 'profiles.image.messages'), value: row ? formatNumber(lang, Number(row.messages ?? 0)) : dash },
      { label: t(lang, 'profiles.image.voice'), value: row ? formatNumber(lang, Number(row.voice_level ?? 0)) : dash },
    ],
    showcase, slots: state.slots, showcaseTitle: t(lang, 'profiles.image.badges'),
  });
}
