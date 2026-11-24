// i18n-ignore-file: rules and defaults of the rank card of a person, nothing here is shown to anyone.
// The rank card a person designs for themselves (the page "Rank card" of the dashboard): the colors of the bar and the text, the font, the layout, the shape of the
// avatar, the theme and the background. It is the card every server that has not designed its own shows for them. What is free and what costs ceramos lives here, so the
// page, the bot and the checks agree. Written in TypeScript: `npm run build:ts` compiles it over utils/userRankCard.js.
export interface RankCardSettings {
  barColor: string;
  barColor2: string | null;
  textColor: string | null;
  font: string;
  layout: 'side' | 'below';
  avatarShape: 'circle' | 'rounded' | 'square';
  theme: 'dark' | 'light';
  /** `default` (the picture that comes with Petto), `banner` (the banner of the profile that is on), `shop:<id>` (a banner of the shop the person has) or `design:<id>` (one of the designs of Petto). */
  background: string;
}

/** What costs ceramos: the bar in two colors is paid once and kept for good. Everything else on the page is free. */
export const PRICES = { gradient: 40 } as const;

export const FONTS = [
  'Poppins', 'Inter', 'Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Roboto Mono', 'Fredoka', 'Caveat', 'Anton', 'Pacifico', 'Lobster', 'Righteous', 'Bangers',
  'Permanent Marker', 'Press Start 2P', 'Nunito', 'Quicksand', 'Space Grotesk', 'Orbitron', 'Dancing Script', 'Comfortaa', 'Rubik', 'Russo One', 'Cinzel',
] as const;

export const DEFAULTS: RankCardSettings = {
  barColor: '#ffb199', barColor2: null, textColor: null, font: 'Poppins', layout: 'side', avatarShape: 'circle', theme: 'dark', background: 'default',
};

const HEX = /^#[0-9a-f]{6}$/i;
const DESIGN = /^design:[a-z0-9-]{3,30}$/;
const SHOP = /^shop:[a-z0-9][a-z0-9-]{2,39}$/;
const UPLOAD = /^upload:own$/;
const hex = (value: unknown): string | null => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : null);

/** The settings of a person, checked: anything missing or wrong becomes the default. `designExists` says whether a design of Petto exists (the page only offers real ones). */
export function normalize(raw: unknown, designExists: (id: string) => boolean = () => true): RankCardSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const font = typeof input.font === 'string' && (FONTS as readonly string[]).includes(input.font) ? input.font : DEFAULTS.font;
  const background = typeof input.background === 'string' && (input.background === 'default' || input.background === 'banner' || UPLOAD.test(input.background) || SHOP.test(input.background) || (DESIGN.test(input.background) && designExists(input.background.slice(7))))
    ? input.background : DEFAULTS.background;
  return {
    barColor: hex(input.barColor) ?? DEFAULTS.barColor,
    barColor2: hex(input.barColor2),
    textColor: hex(input.textColor),
    font,
    layout: input.layout === 'below' ? 'below' : 'side',
    avatarShape: input.avatarShape === 'rounded' || input.avatarShape === 'square' ? input.avatarShape : 'circle',
    theme: input.theme === 'light' ? 'light' : 'dark',
    background,
  };
}

/** What saving `next` costs: the gradient the first time it is used (never again once paid). */
export function costOf(next: RankCardSettings, gradientPaid: boolean): number {
  return next.barColor2 && !gradientPaid ? PRICES.gradient : 0;
}

/**
 * The `basic` settings of the rank card of the bot for these settings, plus the extras the background needs. `bannerUrl` is true when the person has a banner on
 * (the `banner` background falls back to the default picture without it).
 */
export function toBasic(settings: RankCardSettings): Record<string, unknown> {
  const light = settings.theme === 'light';
  return {
    preset: settings.layout === 'below' ? 'rankBottom' : 'rank',
    accent: settings.barColor,
    ...(settings.barColor2 ? { accent2: settings.barColor2 } : {}),
    textColor: settings.textColor ?? (light ? '#111827' : '#ffffff'),
    font: settings.font,
    avatarShape: settings.avatarShape,
    ...(light ? { panelColor: '#ffffff', panelOpacity: 0.72 } : {}),
  };
}

/** The picture behind the card: `{ id }` for `petto:<id>`, `banner` for the one of the profile, or null for the default one of the kind. */
export function backgroundOf(settings: RankCardSettings): { kind: 'default' } | { kind: 'banner' } | { kind: 'upload' } | { kind: 'shop'; id: string } | { kind: 'design'; id: string } {
  if (settings.background === 'banner') return { kind: 'banner' };
  if (settings.background === 'upload:own') return { kind: 'upload' };
  if (settings.background.startsWith('shop:')) return { kind: 'shop', id: settings.background.slice(5) };
  if (settings.background.startsWith('design:')) return { kind: 'design', id: settings.background.slice(7) };
  return { kind: 'default' };
}
