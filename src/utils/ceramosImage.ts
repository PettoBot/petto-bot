// i18n-ignore-file: every word on the pictures comes in from the command, already in the language of the person.
// The pictures of the ceramos: the wallet (`/ceramos`) and the shop of badges (`/ceramos shop`). Dark, no ring on the avatar, no empty corners.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ceramosImage.js.
import type { Image } from '@napi-rs/canvas';
import type { ShowcaseBadge } from './profileImage';
const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const { registerCardFonts, canvasFont, printable } = require('../imgutils/cardFonts') as {
  registerCardFonts: () => void; canvasFont: (family: string, weight: number, size: number) => string; printable: (text: string) => string;
};
const { drawBadge } = require('./profileImage') as { drawBadge: (ctx: import('@napi-rs/canvas').SKRSContext2D, badge: ShowcaseBadge, cx: number, cy: number, r: number) => void };

const FONT = 'Poppins';
const WIDTH = 1024;
type Ctx = import('@napi-rs/canvas').SKRSContext2D;

function background(ctx: Ctx, height: number): void {
  const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
  bg.addColorStop(0, '#17141f'); bg.addColorStop(1, '#2a2140');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, height);
}

function fit(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** A ceramo: a gold coin with a ring and a shine. */
export function drawCoin(ctx: Ctx, cx: number, cy: number, r: number): void {
  const gold = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  gold.addColorStop(0, '#ffe58a'); gold.addColorStop(1, '#e8a92c');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = gold; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.lineWidth = Math.max(2, r * 0.1); ctx.strokeStyle = 'rgba(150,90,10,0.55)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.16, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
}

export interface WalletImageData {
  name: string;
  avatar: Image | null;
  balance: string;
  /** What the wallet is called, such as `Ceramos`. */
  title: string;
  /** The line about the daily claim: when it can be claimed. */
  daily: string;
  dailyReady: boolean;
  movementsTitle: string;
  /** The last movements: the text and the signed amount, newest first (at most 4 are drawn). */
  movements: { text: string; amount: string; positive: boolean }[];
  noMovements: string;
}

export const WALLET_HEIGHT = 320;

export function renderWalletImage(data: WalletImageData): Buffer {
  registerCardFonts();
  const canvas = createCanvas(WIDTH, WALLET_HEIGHT);
  const ctx = canvas.getContext('2d');
  background(ctx, WALLET_HEIGHT);

  // Left: avatar, name, the balance.
  const size = 96, ax = 48, ay = 44;
  ctx.save(); ctx.beginPath(); ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2); ctx.fillStyle = '#4e5058'; ctx.fill(); ctx.clip();
  if (data.avatar) ctx.drawImage(data.avatar, ax, ay, size, size);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 700, 34);
  ctx.fillText(fit(ctx, printable(data.name), 340), ax + size + 24, ay + 44);
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = canvasFont(FONT, 600, 18);
  ctx.fillText(printable(data.title).toUpperCase(), ax + size + 24, ay + 78);

  drawCoin(ctx, 48 + 38, 214, 38);
  ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 700, 64);
  ctx.fillText(fit(ctx, data.balance, 360), 48 + 94, 236);

  // The daily claim.
  ctx.beginPath(); ctx.roundRect(48, 262, 470, 40, 12); ctx.fillStyle = data.dailyReady ? 'rgba(138,255,193,0.18)' : 'rgba(255,255,255,0.08)'; ctx.fill();
  ctx.fillStyle = data.dailyReady ? '#8affc1' : 'rgba(255,255,255,0.8)'; ctx.font = canvasFont(FONT, 600, 18);
  ctx.fillText(fit(ctx, printable(data.daily), 440), 64, 288);

  // Right: the last movements.
  const px = 560, pw = WIDTH - px - 48;
  ctx.beginPath(); ctx.roundRect(px, 40, pw, WALLET_HEIGHT - 80, 18); ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = canvasFont(FONT, 600, 18);
  ctx.fillText(printable(data.movementsTitle).toUpperCase(), px + 24, 78);
  if (!data.movements.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = canvasFont(FONT, 500, 20);
    ctx.fillText(fit(ctx, printable(data.noMovements), pw - 48), px + 24, 136);
  }
  data.movements.slice(0, 4).forEach((move, i) => {
    const y = 124 + i * 40;
    ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 500, 20);
    ctx.fillText(fit(ctx, printable(move.text), pw - 150), px + 24, y);
    ctx.textAlign = 'right'; ctx.fillStyle = move.positive ? '#8affc1' : '#ff8fa3'; ctx.font = canvasFont(FONT, 700, 20);
    ctx.fillText(move.amount, px + pw - 24, y); ctx.textAlign = 'left';
  });
  return canvas.toBuffer('image/png');
}

export interface ShopItem { badge: ShowcaseBadge; name: string; price: string; owned: boolean }
export interface ShopImageData { title: string; balanceText: string; items: ShopItem[]; ownedText: string }

const COLS = 6;

export function renderShopImage(data: ShopImageData): Buffer {
  registerCardFonts();
  const rows = Math.max(1, Math.ceil(data.items.length / COLS));
  const height = 110 + rows * 190 + 20;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  background(ctx, height);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 700, 36);
  ctx.fillText(printable(data.title), 48, 66);
  ctx.textAlign = 'right'; ctx.font = canvasFont(FONT, 700, 26);
  const w = ctx.measureText(data.balanceText).width;
  ctx.fillText(data.balanceText, WIDTH - 48, 64); ctx.textAlign = 'left';
  drawCoin(ctx, WIDTH - 48 - w - 28, 54, 16);

  const step = (WIDTH - 96) / COLS, r = 46;
  data.items.forEach((item, i) => {
    const row = Math.floor(i / COLS), inRow = Math.min(COLS, data.items.length - row * COLS);
    // A row that is not full is centred, so there is no empty corner.
    const cx = 48 + step / 2 + ((COLS - inRow) * step) / 2 + (i % COLS) * step, cy = 110 + row * 190 + 70;
    ctx.save();
    if (item.owned) ctx.globalAlpha = 0.6;
    drawBadge(ctx, item.badge, cx, cy, r);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.font = canvasFont(FONT, 600, 16);
    ctx.fillText(fit(ctx, printable(item.name), step - 10), cx, cy + r + 30);
    ctx.fillStyle = item.owned ? '#8affc1' : '#ffd666'; ctx.font = canvasFont(FONT, 700, 18);
    ctx.fillText(item.owned ? printable(data.ownedText) : item.price, cx, cy + r + 54);
    ctx.textAlign = 'left';
  });
  return canvas.toBuffer('image/png');
}
