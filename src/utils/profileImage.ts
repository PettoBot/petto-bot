// i18n-ignore-file: nothing here is a text of its own; every word on the picture (labels, title) comes in from the command, already in the language of the server.
// The image of `/profile`: the banner and avatar of the person, their name with the star of their plan, four numbers, and the showcase of badges
// (hexagons: the ones they put, empty ones, and locked ones for the places their plan does not give). The avatar has no ring around it.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileImage.js.
import type { Image } from '@napi-rs/canvas';
const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const { registerCardFonts, canvasFont, printable } = require('../imgutils/cardFonts') as {
  registerCardFonts: () => void; canvasFont: (family: string, weight: number, size: number) => string; printable: (text: string) => string;
};

export interface ShowcaseBadge { id: string; art: Image | null; color: string; /** Drawn on a badge with no art. */ label?: string; /** `normal`, `bright` or `divine` (see FRAMES of utils/ceramos.ts). */ frame?: string; /** The picture of that frame (iron, gold or mithril ring); with none, the ring is a plain line. */ frameArt?: Image | null }
export interface ProfileImageData {
  name: string;
  avatar: Image | null;
  banner: Image | null;
  /** The star of the plan next to the name, already loaded, or null with no plan. */
  planStar: Image | null;
  /** Exactly four of them: a label and the value as text. */
  stats: { label: string; value: string }[];
  showcase: ShowcaseBadge[];
  /** How many places the plan gives (the rest of the six are drawn locked). */
  slots: number;
  /** The word on top of the showcase, such as `Badges`. */
  showcaseTitle: string;
  /** The family of the name font the person put on (a font of the shop, already registered), or nothing for the usual one. */
  nameFont?: string | null;
}

export const WIDTH = 1024;
export const HEIGHT = 420;
const BANNER_H = 250;
const FONT = 'Poppins';

/** How much bigger than the badge the picture of its frame is drawn (1.16: 8% more on each side). The same number as the website (inset -8%). */
const FRAME_SCALE = 1.16;

export function hexPath(ctx: import('@napi-rs/canvas').SKRSContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}


/**
 * One badge in a hexagon: its art, or its colour with its text, and over it the frame it was upgraded to (a ring of iron, gold or mithril, a picture). The star of a plan has
 * no hexagon and no frame: it is drawn alone. Without the picture of a frame, a plain ring is drawn instead.
 */
export function drawBadge(ctx: import('@napi-rs/canvas').SKRSContext2D, badge: ShowcaseBadge, cx: number, cy: number, r: number): void {
  if (badge.id.startsWith('plan-') && badge.art) {
    ctx.drawImage(badge.art, cx - r, cy - r, r * 2, r * 2);
    return;
  }
  hexPath(ctx, cx, cy, r); ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
  if (badge.art) {
    ctx.save(); hexPath(ctx, cx, cy, r); ctx.clip();
    ctx.drawImage(badge.art, cx - r, cy - r, r * 2, r * 2); ctx.restore();
  } else {
    hexPath(ctx, cx, cy, r); ctx.fillStyle = badge.color; ctx.fill();
    hexPath(ctx, cx, cy, r - 8); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    if (badge.label) {
      ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 700, Math.round(r * 0.62)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(printable(badge.label), cx, cy + 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  if (badge.frameArt) {
    // The picture of the ring is a little bigger than the badge (FRAME_SCALE), so the art keeps its whole size and only its edge goes under the ring.
    const w = r * Math.sqrt(3) * FRAME_SCALE, h = r * 2 * FRAME_SCALE;
    ctx.drawImage(badge.frameArt, cx - w / 2, cy - h / 2, w, h);
  } else if (badge.frame === 'bright') {
    ctx.save(); hexPath(ctx, cx, cy, r + 3); ctx.lineWidth = 5; ctx.strokeStyle = '#ffd666'; ctx.stroke(); ctx.restore();
  } else if (badge.frame === 'divine') {
    ctx.save(); hexPath(ctx, cx, cy, r + 3); ctx.lineWidth = 5; ctx.strokeStyle = '#8fd6ff'; ctx.stroke(); ctx.restore();
  }
}

function cover(ctx: import('@napi-rs/canvas').SKRSContext2D, img: Image, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function fitText(ctx: import('@napi-rs/canvas').SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** Draws the profile and returns the PNG. Never throws for a missing picture: it is just left out. */
export function renderProfileImage(data: ProfileImageData): Buffer {
  registerCardFonts();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background: the banner, dimmed, or a plain gradient.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#17141f'); bg.addColorStop(1, '#2a2140');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (data.banner) {
    // The banner is the whole card (as on the profile of Vetox), darker toward the bottom so the numbers and the badges stay easy to read; no band of another color under it.
    cover(ctx, data.banner, 0, 0, WIDTH, HEIGHT);
    const shade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    shade.addColorStop(0, 'rgba(10,8,16,0.12)'); shade.addColorStop(0.5, 'rgba(10,8,16,0.38)'); shade.addColorStop(1, 'rgba(10,8,16,0.72)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Avatar: a circle, no ring.
  const ax = 48, ay = 62, size = 150;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.beginPath(); ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2); ctx.fillStyle = '#4e5058'; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  if (data.avatar) ctx.drawImage(data.avatar, ax, ay, size, size);
  ctx.restore();

  // Name and the star of the plan.
  const nx = ax + size + 32;
  ctx.fillStyle = '#ffffff'; ctx.font = data.nameFont ? canvasFont(FONT, 700, 48).replace('48px ', `48px "${data.nameFont}", `) : canvasFont(FONT, 700, 48); ctx.textBaseline = 'alphabetic';
  const name = fitText(ctx, printable(data.name), WIDTH - nx - 130);
  if (data.banner) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2; }
  ctx.fillText(name, nx, ay + 58);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (data.planStar) {
    const w = ctx.measureText(name).width;
    ctx.drawImage(data.planStar, nx + w + 14, ay + 16, 52, 52);
  }

  // Four numbers.
  const gap = 14, boxW = (WIDTH - nx - 48 - gap * 3) / 4, boxH = 82, by = ay + 82;
  data.stats.slice(0, 4).forEach((stat, i) => {
    const x = nx + i * (boxW + gap);
    ctx.fillStyle = data.banner ? 'rgba(8,6,14,0.5)' : 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.roundRect(x, by, boxW, boxH, 14); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = canvasFont(FONT, 600, 18);
    ctx.fillText(fitText(ctx, printable(stat.label).toUpperCase(), boxW - 32), x + 16, by + 30);
    ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 700, 32);
    ctx.fillText(fitText(ctx, stat.value, boxW - 32), x + 16, by + 66);
  });

  // Showcase: six hexagons.
  ctx.fillStyle = 'rgba(8,6,14,0.4)'; ctx.beginPath(); ctx.roundRect(28, 246, WIDTH - 56, HEIGHT - 246 - 22, 22); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = canvasFont(FONT, 600, 18);
  ctx.fillText(printable(data.showcaseTitle).toUpperCase(), 48, 272);
  const r = 48, cy = 338, step = (WIDTH - 96) / 6, startX = 48 + step / 2;
  for (let i = 0; i < 6; i += 1) {
    const cx = startX + i * step;
    const badge = data.showcase[i];
    const locked = i >= data.slots;
    if (badge) {
      drawBadge(ctx, badge, cx, cy, r);
    } else {
      hexPath(ctx, cx, cy, r); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.strokeStyle = locked ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.35)'; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = locked ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)';
      if (locked) {
        ctx.beginPath(); ctx.roundRect(cx - 11, cy - 4, 22, 17, 3); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(cx, cy - 4, 7, Math.PI, 0); ctx.stroke();
      } else {
        ctx.font = canvasFont(FONT, 600, 34); ctx.textAlign = 'center'; ctx.fillText('+', cx, cy + 12); ctx.textAlign = 'left';
      }
    }
  }
  return canvas.toBuffer('image/png');
}
