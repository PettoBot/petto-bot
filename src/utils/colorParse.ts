// Reads a color the way people write it (hex, rgb, hsl, hsv, cmyk, a number, a name, "random") and does the arithmetic the `!color` card needs: the other writings of
// the same color, how readable white and black text are on it (WCAG contrast), its lighter and darker shades, its complement and the nearest CSS name.
// Pure functions with no Discord and no I/O, so they are checked on their own (scripts/check-color.js). `commands/info/color.js` draws the answer.

export type ColorSource = 'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk' | 'decimal' | 'name' | 'random';
export type Rgb = [number, number, number];

export interface ParsedColor {
  r: number;
  g: number;
  b: number;
  /** 0 to 1 when the writing had an alpha (`#ff880080`, `rgba(...)`), else null. The color itself ignores it. */
  alpha: number | null;
  source: ColorSource;
  /** The CSS or common name it was written as (`orange`, `rojo`), else null. */
  name: string | null;
}

// The 148 CSS color names, `name:rrggbb`.
const CSS_NAMES = 'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

// The basic colors in Spanish and Portuguese, written without accents and pointing at the CSS name they stand for.
const OTHER_NAMES: Record<string, string> = {
  rojo: 'red', azul: 'blue', verde: 'green', amarillo: 'yellow', naranja: 'orange', rosa: 'pink', rosado: 'pink', morado: 'purple', violeta: 'violet', purpura: 'purple',
  negro: 'black', blanco: 'white', gris: 'gray', marron: 'brown', cafe: 'brown', celeste: 'skyblue', turquesa: 'turquoise', dorado: 'gold', plateado: 'silver', plata: 'silver',
  oro: 'gold', fucsia: 'fuchsia', cian: 'cyan', beis: 'beige', lila: 'lavender', coral: 'coral', crema: 'ivory', salmon: 'salmon', menta: 'mintcream', lima: 'lime', granate: 'maroon',
  vermelho: 'red', amarelo: 'yellow', laranja: 'orange', roxo: 'purple', preto: 'black', branco: 'white', cinza: 'gray', marrom: 'brown', dourado: 'gold', prata: 'silver', ciano: 'cyan',
};

const CSS_HEX = new Map<string, string>(CSS_NAMES.split(',').map((entry) => entry.split(':') as [string, string]));
/** The names offered as the nearest one: the gray spellings are listed once. */
const NEAR_NAMES: [string, Rgb][] = [...CSS_HEX.entries()].filter(([name]) => !name.includes('grey')).map(([name, hex]) => [name, fromInt(parseInt(hex, 16))]);

export const RANDOM_WORDS = ['random', 'rand', 'rnd', 'aleatorio', 'aleatoria', 'aleatorio', 'sorteio'];
export const COLOR_NAMES: string[] = [...CSS_HEX.keys()];

function fromInt(value: number): Rgb {
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const make = (rgb: Rgb, source: ColorSource, alpha: number | null = null, name: string | null = null): ParsedColor => ({ r: rgb[0], g: rgb[1], b: rgb[2], alpha, source, name });

/** The number a color is stored as (`0xff8800` is 16746496): what Discord roles and embeds take. */
export const toDecimal = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
/** `#ff8800`. */
export const hexOf = (r: number, g: number, b: number): string => `#${toDecimal(r, g, b).toString(16).padStart(6, '0')}`;

export function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, Math.round(lightness * 100)];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return [Math.round(hueOf(rn, gn, bn, max, delta)) % 360, Math.round(saturation * 100), Math.round(lightness * 100)];
}

function hueOf(rn: number, gn: number, bn: number, max: number, delta: number): number {
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return (hue * 60 + 360) % 360;
}

/** Hue, saturation and value (HSB): the writing of Photoshop and most color pickers. */
export function toHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const delta = max - min;
  const hue = delta === 0 ? 0 : hueOf(rn, gn, bn, max, delta);
  return [Math.round(hue) % 360, Math.round((max === 0 ? 0 : delta / max) * 100), Math.round(max * 100)];
}

export function toCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return [0, 0, 0, 100];
  return [Math.round(((1 - rn - k) / (1 - k)) * 100), Math.round(((1 - gn - k) / (1 - k)) * 100), Math.round(((1 - bn - k) / (1 - k)) * 100), Math.round(k * 100)];
}

/** From hue in degrees and saturation, lightness in 0..1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  return hueToRgb(hue, chroma, x, m);
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  return hueToRgb(hue, chroma, x, v - chroma);
}

function hueToRgb(hue: number, chroma: number, x: number, m: number): Rgb {
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function cmykToRgb(c: number, m: number, y: number, k: number): Rgb {
  return [Math.round(255 * (1 - c) * (1 - k)), Math.round(255 * (1 - m) * (1 - k)), Math.round(255 * (1 - y) * (1 - k))];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(...a), lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Grade = 'AAA' | 'AA' | 'large' | 'fail';
/** What a ratio allows: AAA 7:1, AA 4.5:1 for normal text, `large` 3:1 (large text and controls only), below that it fails. */
export function gradeOf(ratio: number): Grade {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'large';
  return 'fail';
}

/** The text color that reads best on this one. */
export function bestText(rgb: Rgb): 'white' | 'black' {
  return contrastRatio(rgb, [255, 255, 255]) >= contrastRatio(rgb, [0, 0, 0]) ? 'white' : 'black';
}

/** Mixes a color toward another by `amount` (0 is the color, 1 is the target). */
export function mix(rgb: Rgb, target: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(rgb[i] + (target[i] - rgb[i]) * clamp(amount, 0, 1))) as Rgb;
}

/** `count` shades from darker to lighter through the color itself (the middle one). */
export function shades(rgb: Rgb, count = 7, spread = 0.7): Rgb[] {
  const middle = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => (i === middle ? rgb : i < middle ? mix(rgb, [0, 0, 0], ((middle - i) / middle) * spread) : mix(rgb, [255, 255, 255], ((i - middle) / (count - 1 - middle)) * spread)));
}

/** The color opposite on the wheel (the hue turned half a circle, same saturation and lightness). */
export function complement(rgb: Rgb): Rgb {
  const [h, s, l] = toHsl(...rgb);
  return hslToRgb(h + 180, s / 100, l / 100);
}

/** The nearest CSS color name and how it is written. */
export function nearestName(rgb: Rgb): string {
  let best = NEAR_NAMES[0][0];
  let bestDistance = Infinity;
  for (const [name, value] of NEAR_NAMES) {
    // Weighted so greens count more, as the eye does.
    const distance = 2 * (rgb[0] - value[0]) ** 2 + 4 * (rgb[1] - value[1]) ** 2 + 3 * (rgb[2] - value[2]) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = name; }
  }
  return best;
}

const NUMBER = /^(-?(?:\d+\.?\d*|\.\d+))(%|deg|°|turn|rad|grad)?$/;
interface Part { value: number; unit: string }

function parts(text: string): Part[] | null {
  const tokens = text.split(/[\s,;/]+/).filter(Boolean);
  const out: Part[] = [];
  for (const token of tokens) {
    const match = NUMBER.exec(token);
    if (!match) return null;
    out.push({ value: Number(match[1]), unit: match[2] ?? '' });
  }
  return out.length ? out : null;
}

function alphaOf(part: Part | undefined): number | null {
  if (!part) return null;
  const value = part.unit === '%' ? part.value / 100 : part.value;
  return value >= 0 && value <= 1 ? value : null;
}

function hueOfPart(part: Part): number | null {
  if (part.unit === '%' ) return null;
  const turns = part.unit === 'turn' ? part.value * 360 : part.unit === 'rad' ? (part.value * 180) / Math.PI : part.unit === 'grad' ? part.value * 0.9 : part.value;
  return Number.isFinite(turns) ? ((turns % 360) + 360) % 360 : null;
}

/** A 0..100 value, with or without `%`. */
function percentOf(part: Part): number | null {
  if (part.unit && part.unit !== '%') return null;
  return part.value >= 0 && part.value <= 100 ? part.value / 100 : null;
}

function channelOf(part: Part): number | null {
  const value = part.unit === '%' ? (part.value / 100) * 255 : part.unit ? NaN : part.value;
  return value >= 0 && value <= 255 ? Math.round(value) : null;
}

function fromRgbParts(list: Part[]): ParsedColor | null {
  if (list.length !== 3 && list.length !== 4) return null;
  const channels = list.slice(0, 3).map(channelOf);
  if (channels.some((value) => value === null)) return null;
  return make(channels as Rgb, 'rgb', alphaOf(list[3]));
}

function fromHslParts(list: Part[], kind: 'hsl' | 'hsv'): ParsedColor | null {
  if (list.length !== 3 && list.length !== 4) return null;
  const h = hueOfPart(list[0]);
  const s = percentOf(list[1]);
  const x = percentOf(list[2]);
  if (h === null || s === null || x === null) return null;
  return make(kind === 'hsl' ? hslToRgb(h, s, x) : hsvToRgb(h, s, x), kind, alphaOf(list[3]));
}

function fromCmykParts(list: Part[]): ParsedColor | null {
  if (list.length !== 4) return null;
  const values = list.map(percentOf);
  if (values.some((value) => value === null)) return null;
  const [c, m, y, k] = values as number[];
  return make(cmykToRgb(c, m, y, k), 'cmyk');
}

function fromHex(digits: string, prefixed: boolean): ParsedColor | null {
  const n = digits.length;
  if (n === 3 || n === 4) {
    const expanded = digits.split('').map((d) => parseInt(d + d, 16));
    return make([expanded[0], expanded[1], expanded[2]], 'hex', n === 4 ? expanded[3] / 255 : null);
  }
  if (n === 6 || n === 8) {
    const value = parseInt(digits.slice(0, 6), 16);
    return make(fromInt(value), 'hex', n === 8 ? parseInt(digits.slice(6), 16) / 255 : null);
  }
  // `#f`, `#ff`, `#fffff`: the old way of the command, a number that is padded on the left (`#ff` is #0000ff). Only with the `#`.
  if (prefixed && (n === 1 || n === 2 || n === 5)) return make(fromInt(parseInt(digits, 16)), 'hex');
  return null;
}

const QUOTES = '`\'"“”‘’';
/** Removes the quotes around a text (a loop, not a regex: a quantifier before `$` over typed text can take quadratic time). */
function stripQuotes(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && QUOTES.includes(text[start])) start += 1;
  while (end > start && QUOTES.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/** No color is written with more than this many characters. */
const MAX_LENGTH = 120;

function normalize(text: string): string {
  return stripQuotes(text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()).trim();
}

/** `r255 g136 b0`, `h32 s100 l50`: a letter and a number each, read from left to right in one pass (every piece starts at a letter, so nothing is tried twice). */
function letterParts(text: string): { letter: string; part: Part; spaced: boolean }[] | null {
  const piece = /([a-z])[\s:]*(-?[\d.]+)(%|deg|°)?([\s,;/]*)/y;
  const out: { letter: string; part: Part; spaced: boolean }[] = [];
  let at = 0;
  while (at < text.length) {
    piece.lastIndex = at;
    const match = piece.exec(text);
    if (!match) return null;
    out.push({ letter: match[1], part: { value: Number(match[2]), unit: match[3] ?? '' }, spaced: match[4].length > 0 && !match[3] });
    at = piece.lastIndex;
  }
  return out.length ? out : null;
}

/**
 * Reads a color from what a person typed. Understands: `#ff8800`, `ff8800`, `#f80`, `#ff880080` (alpha is kept apart), `0xff8800`, a plain number (`16746496`),
 * `rgb(255, 136, 0)`, `255 136 0`, `255,136,0`, `r255 g136 b0`, `rgb 100% 50% 0%`, `hsl(32, 100%, 50%)`, `32 100% 50%`, `h32 s100 l50`, `hsv(32, 100%, 100%)`/`hsb(...)`,
 * `cmyk(0, 47, 100, 0)`, `c0 m47 y100 k0`, every CSS color name (`orange`, `light blue`), the basic ones in Spanish and Portuguese (`rojo`, `vermelho`), and `random`.
 * Three bare numbers are RGB (to say HSL write `hsl`, a `%`, or `h`/`s`/`l`); only digits with exactly 3 or 6 of them are hex, any other number is the decimal one. Null when it is none of them.
 */
export function parseColor(input: string, random: () => number = Math.random): ParsedColor | null {
  const raw = String(input ?? '');
  if (raw.length > MAX_LENGTH * 4) return null;
  const text = normalize(raw);
  if (!text || text.length > MAX_LENGTH) return null;

  if (RANDOM_WORDS.includes(text)) {
    const color = make([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)], 'random');
    return color;
  }

  const spelled = text.replace(/[\s_-]+/g, '');
  const cssName = CSS_HEX.has(spelled) ? spelled : OTHER_NAMES[spelled];
  if (cssName && CSS_HEX.has(cssName)) return make(fromInt(parseInt(CSS_HEX.get(cssName)!, 16)), 'name', null, spelled);

  // `rgb(…)`, `hsl 32 100% 50%`, `cmyk(0,47,100,0)`.
  const fn = /^(rgba?|hsla?|hsva?|hsba?|cmyk)/.exec(text);
  if (fn) {
    let body = text.slice(fn[0].length).trim();
    if (body.startsWith('(')) body = body.slice(1);
    if (body.endsWith(')')) body = body.slice(0, -1);
    if (!/[()]/.test(body)) {
      const list = parts(body);
      if (!list) return null;
      const kind = fn[1].startsWith('rgb') ? 'rgb' : fn[1].startsWith('hsl') ? 'hsl' : fn[1].startsWith('cmyk') ? 'cmyk' : 'hsv';
      return kind === 'rgb' ? fromRgbParts(list) : kind === 'cmyk' ? fromCmykParts(list) : fromHslParts(list, kind);
    }
  }

  // Letters in front of each number, in any order: `r255 g136 b0`, `h32 s100 l50`, `c0 m47 y100 k0`. Anything that is not one of these sets goes on
  // (`b0b0b0` and `f80` are hex written with letters in them).
  const lettered = letterParts(text);
  if (lettered) {
    const found = new Map<string, Part>();
    let repeated = false;
    for (const { letter, part } of lettered) {
      if (found.has(letter)) repeated = true;
      found.set(letter, part);
    }
    const letters = [...found.keys()].sort().join('');
    const get = (letter: string): Part => found.get(letter)!;
    if (!repeated) {
      if (letters === 'bgr') return fromRgbParts([get('r'), get('g'), get('b')]);
      if (letters === 'hls') return fromHslParts([get('h'), get('s'), get('l')], 'hsl');
      if (letters === 'hsv') return fromHslParts([get('h'), get('s'), get('v')], 'hsv');
      if (letters === 'ckmy') return fromCmykParts([get('c'), get('m'), get('y'), get('k')]);
    } else if (/^[rgbhslvcmyk]+$/.test([...found.keys()].join('')) && found.size >= 3 && lettered.some((piece, index) => index < lettered.length - 1 && piece.spaced) && /[g-z]/.test(text)) {
      return null; // a repeated letter in a writing like `r255 r0 b1`
    }
  }

  // Hex and numbers.
  const hex = /^(#|0x)?([0-9a-f]+)$/.exec(text);
  if (hex) {
    const digits = hex[2];
    const prefixed = Boolean(hex[1]);
    if (prefixed) return fromHex(digits, true);
    if (/^\d+$/.test(digits)) {
      // Only digits: 3 and 6 are hex (`123456`, like CSS without the `#`), the rest is the decimal number of the color.
      if (digits.length === 3 || digits.length === 6) return fromHex(digits, false);
      const value = Number(digits);
      return value <= 0xffffff ? make(fromInt(value), 'decimal') : null;
    }
    return fromHex(digits, false);
  }

  // Bare numbers: `255 136 0` is RGB; with `%` on the last two it is hue, saturation and lightness.
  const list = parts(text);
  if (list && list.length === 3) {
    if (list[1].unit === '%' && list[2].unit === '%') return fromHslParts(list, 'hsl');
    if (list.every((part) => part.unit === '' || part.unit === '%')) return fromRgbParts(list);
  }
  if (list && list.length === 4 && list.every((part) => part.unit === '%')) return fromCmykParts(list);
  return null;
}
