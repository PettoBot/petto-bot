"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULTS = exports.FONTS = exports.PRICES = void 0;
exports.normalize = normalize;
exports.costOf = costOf;
exports.toBasic = toBasic;
exports.backgroundOf = backgroundOf;
/** What costs ceramos: the bar in two colors is paid once and kept for good. Everything else on the page is free. */
exports.PRICES = { gradient: 40 };
exports.FONTS = [
    'Poppins', 'Inter', 'Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Roboto Mono', 'Fredoka', 'Caveat', 'Anton', 'Pacifico', 'Lobster', 'Righteous', 'Bangers',
    'Permanent Marker', 'Press Start 2P', 'Nunito', 'Quicksand', 'Space Grotesk', 'Orbitron', 'Dancing Script', 'Comfortaa', 'Rubik', 'Russo One', 'Cinzel',
];
exports.DEFAULTS = {
    barColor: '#ffb199', barColor2: null, textColor: null, font: 'Poppins', layout: 'side', avatarShape: 'circle', theme: 'dark', background: 'default',
};
const HEX = /^#[0-9a-f]{6}$/i;
const DESIGN = /^design:[a-z0-9-]{3,30}$/;
const SHOP = /^shop:[a-z0-9][a-z0-9-]{2,39}$/;
const UPLOAD = /^upload:own$/;
const hex = (value) => (typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : null);
/** The settings of a person, checked: anything missing or wrong becomes the default. `designExists` says whether a design of Petto exists (the page only offers real ones). */
function normalize(raw, designExists = () => true) {
    const input = (raw && typeof raw === 'object' ? raw : {});
    const font = typeof input.font === 'string' && exports.FONTS.includes(input.font) ? input.font : exports.DEFAULTS.font;
    const background = typeof input.background === 'string' && (input.background === 'default' || input.background === 'banner' || UPLOAD.test(input.background) || SHOP.test(input.background) || (DESIGN.test(input.background) && designExists(input.background.slice(7))))
        ? input.background : exports.DEFAULTS.background;
    return {
        barColor: hex(input.barColor) ?? exports.DEFAULTS.barColor,
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
function costOf(next, gradientPaid) {
    return next.barColor2 && !gradientPaid ? exports.PRICES.gradient : 0;
}
/**
 * The `basic` settings of the rank card of the bot for these settings, plus the extras the background needs. `bannerUrl` is true when the person has a banner on
 * (the `banner` background falls back to the default picture without it).
 */
function toBasic(settings) {
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
function backgroundOf(settings) {
    if (settings.background === 'banner')
        return { kind: 'banner' };
    if (settings.background === 'upload:own')
        return { kind: 'upload' };
    if (settings.background.startsWith('shop:'))
        return { kind: 'shop', id: settings.background.slice(5) };
    if (settings.background.startsWith('design:'))
        return { kind: 'design', id: settings.background.slice(7) };
    return { kind: 'default' };
}
