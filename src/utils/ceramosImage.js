"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLET_HEIGHT = void 0;
exports.drawCoin = drawCoin;
exports.renderWalletImage = renderWalletImage;
exports.renderShopImage = renderShopImage;
exports.renderItemShopImage = renderItemShopImage;
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont, printable } = require('../imgutils/cardFonts');
const { drawBadge } = require('./profileImage');
const FONT = 'Poppins';
const WIDTH = 1024;
function background(ctx, height) {
    const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
    bg.addColorStop(0, '#17141f');
    bg.addColorStop(1, '#2a2140');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, height);
}
function fit(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth)
        return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth)
        out = out.slice(0, -1);
    return `${out}…`;
}
/** A ceramo: a gold coin with a rim, a shine and an embossed C (the letter is left out on a tiny coin, where it would only be a smudge). */
function drawCoin(ctx, cx, cy, r) {
    // The rim.
    const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    rim.addColorStop(0, '#fff0a8');
    rim.addColorStop(0.5, '#f0b53a');
    rim.addColorStop(1, '#b8741a');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();
    // The face, a little lighter at the top left.
    const face = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 0.84);
    face.addColorStop(0, '#ffe48a');
    face.addColorStop(1, '#eaa72b');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.strokeStyle = 'rgba(150,90,10,0.5)';
    ctx.stroke();
    if (r >= 20) {
        // The C: a dark copy a little down and right, a light one up and left, then the gold on top, so it looks pressed into the coin.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = canvasFont(FONT, 700, Math.round(r * 1.15));
        const o = Math.max(1, r * 0.035);
        ctx.fillStyle = 'rgba(255,248,205,0.85)';
        ctx.fillText('C', cx - o, cy + r * 0.04 - o);
        ctx.fillStyle = 'rgba(140,80,8,0.75)';
        ctx.fillText('C', cx + o, cy + r * 0.04 + o);
        ctx.fillStyle = '#e3a128';
        ctx.fillText('C', cx, cy + r * 0.04);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
    // The shine.
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.4, cy - r * 0.5, r * 0.2, r * 0.1, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
}
exports.WALLET_HEIGHT = 320;
function renderWalletImage(data) {
    registerCardFonts();
    const canvas = createCanvas(WIDTH, exports.WALLET_HEIGHT);
    const ctx = canvas.getContext('2d');
    background(ctx, exports.WALLET_HEIGHT);
    // Left: avatar, name, the balance.
    const size = 96, ax = 48, ay = 44;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#4e5058';
    ctx.fill();
    ctx.clip();
    if (data.avatar)
        ctx.drawImage(data.avatar, ax, ay, size, size);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = canvasFont(FONT, 700, 34);
    ctx.fillText(fit(ctx, printable(data.name), 340), ax + size + 24, ay + 44);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = canvasFont(FONT, 600, 18);
    ctx.fillText(printable(data.title).toUpperCase(), ax + size + 24, ay + 78);
    drawCoin(ctx, 48 + 38, 214, 38);
    ctx.fillStyle = '#ffffff';
    ctx.font = canvasFont(FONT, 700, 64);
    ctx.fillText(fit(ctx, data.balance, 360), 48 + 94, 236);
    // The daily claim.
    ctx.beginPath();
    ctx.roundRect(48, 262, 470, 40, 12);
    ctx.fillStyle = data.dailyReady ? 'rgba(138,255,193,0.18)' : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.fillStyle = data.dailyReady ? '#8affc1' : 'rgba(255,255,255,0.8)';
    ctx.font = canvasFont(FONT, 600, 18);
    ctx.fillText(fit(ctx, printable(data.daily), 440), 64, 288);
    // Right: the last movements.
    const px = 560, pw = WIDTH - px - 48;
    ctx.beginPath();
    ctx.roundRect(px, 40, pw, exports.WALLET_HEIGHT - 80, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = canvasFont(FONT, 600, 18);
    ctx.fillText(printable(data.movementsTitle).toUpperCase(), px + 24, 78);
    if (!data.movements.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = canvasFont(FONT, 500, 20);
        ctx.fillText(fit(ctx, printable(data.noMovements), pw - 48), px + 24, 136);
    }
    data.movements.slice(0, 4).forEach((move, i) => {
        const y = 124 + i * 40;
        ctx.fillStyle = '#ffffff';
        ctx.font = canvasFont(FONT, 500, 20);
        ctx.fillText(fit(ctx, printable(move.text), pw - 150), px + 24, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = move.positive ? '#8affc1' : '#ff8fa3';
        ctx.font = canvasFont(FONT, 700, 20);
        ctx.fillText(move.amount, px + pw - 24, y);
        ctx.textAlign = 'left';
    });
    return canvas.toBuffer('image/png');
}
const COLS = 6;
function renderShopImage(data) {
    registerCardFonts();
    const rows = Math.max(1, Math.ceil(data.items.length / COLS));
    const height = 110 + rows * 190 + 20;
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    background(ctx, height);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = canvasFont(FONT, 700, 36);
    ctx.fillText(printable(data.title), 48, 66);
    ctx.textAlign = 'right';
    ctx.font = canvasFont(FONT, 700, 26);
    const w = ctx.measureText(data.balanceText).width;
    ctx.fillText(data.balanceText, WIDTH - 48, 64);
    ctx.textAlign = 'left';
    drawCoin(ctx, WIDTH - 48 - w - 28, 54, 16);
    const step = (WIDTH - 96) / COLS, r = 46;
    data.items.forEach((item, i) => {
        const row = Math.floor(i / COLS), inRow = Math.min(COLS, data.items.length - row * COLS);
        // A row that is not full is centred, so there is no empty corner.
        const cx = 48 + step / 2 + ((COLS - inRow) * step) / 2 + (i % COLS) * step, cy = 110 + row * 190 + 70;
        ctx.save();
        if (item.owned)
            ctx.globalAlpha = 0.6;
        drawBadge(ctx, item.badge, cx, cy, r);
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = canvasFont(FONT, 600, 16);
        ctx.fillText(fit(ctx, printable(item.name), step - 10), cx, cy + r + 30);
        ctx.fillStyle = item.owned ? '#8affc1' : '#ffd666';
        ctx.font = canvasFont(FONT, 700, 18);
        ctx.fillText(item.owned ? printable(data.ownedText) : item.price, cx, cy + r + 54);
        ctx.textAlign = 'left';
    });
    return canvas.toBuffer('image/png');
}
const CARD_W = (WIDTH - 96 - 20) / 2, CARD_H = 150;
/** The shop of banners, name fonts and packs: two cards in a row, each with its preview (the banner, a sample of the font, or the colour of the pack), its name and its price. */
function renderItemShopImage(data) {
    registerCardFonts();
    const rows = Math.max(1, Math.ceil(data.cards.length / 2));
    const height = 110 + rows * (CARD_H + 16) + 12;
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    background(ctx, height);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = canvasFont(FONT, 700, 36);
    ctx.fillText(fit(ctx, printable(data.title), WIDTH - 260), 48, 66);
    ctx.textAlign = 'right';
    ctx.font = canvasFont(FONT, 700, 26);
    const w = ctx.measureText(data.balanceText).width;
    ctx.fillText(data.balanceText, WIDTH - 48, 64);
    ctx.textAlign = 'left';
    drawCoin(ctx, WIDTH - 48 - w - 28, 54, 16);
    data.cards.forEach((card, i) => {
        const row = Math.floor(i / 2), inRow = Math.min(2, data.cards.length - row * 2);
        // A last card alone is centred, so there is no empty corner.
        const x = 48 + (inRow === 1 ? (WIDTH - 96 - CARD_W) / 2 : (i % 2) * (CARD_W + 20)), y = 100 + row * (CARD_H + 16);
        ctx.save();
        if (card.owned)
            ctx.globalAlpha = 0.65;
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        ctx.roundRect(x, y, CARD_W, CARD_H, 18);
        ctx.fill();
        const px = x + 14, py = y + 14, pw = 210, ph = CARD_H - 28;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 12);
        ctx.clip();
        if (card.picture) {
            const scale = Math.max(pw / card.picture.width, ph / card.picture.height);
            ctx.drawImage(card.picture, px + (pw - card.picture.width * scale) / 2, py + (ph - card.picture.height * scale) / 2, card.picture.width * scale, card.picture.height * scale);
        }
        else if (card.fontFamily !== undefined) {
            ctx.fillStyle = '#17141f';
            ctx.fillRect(px, py, pw, ph);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = card.fontFamily ? `40px "${card.fontFamily}", ${canvasFont(FONT, 700, 40)}` : canvasFont(FONT, 700, 40);
            ctx.fillText(fit(ctx, printable(data.sample), pw - 20), px + pw / 2, py + ph / 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
        else {
            const tile = ctx.createLinearGradient(px, py, px + pw, py + ph);
            tile.addColorStop(0, card.color ?? '#8f7bd6');
            tile.addColorStop(1, '#17141f');
            ctx.fillStyle = tile;
            ctx.fillRect(px, py, pw, ph);
        }
        ctx.restore();
        const tx = px + pw + 18, tw = CARD_W - pw - 14 - 18 - 14;
        ctx.fillStyle = '#ffffff';
        ctx.font = canvasFont(FONT, 700, 22);
        ctx.fillText(fit(ctx, printable(card.name), tw), tx, y + 54);
        if (card.line) {
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.font = canvasFont(FONT, 500, 16);
            ctx.fillText(fit(ctx, printable(card.line), tw), tx, y + 82);
        }
        ctx.fillStyle = card.owned ? '#8affc1' : '#ffd666';
        ctx.font = canvasFont(FONT, 700, 22);
        ctx.fillText(card.owned ? printable(data.ownedText) : card.price, tx, y + CARD_H - 30);
        ctx.restore();
    });
    return canvas.toBuffer('image/png');
}
