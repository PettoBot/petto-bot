"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEIGHT = exports.WIDTH = void 0;
exports.hexPath = hexPath;
exports.drawBadge = drawBadge;
exports.renderProfileImage = renderProfileImage;
const { createCanvas } = require('@napi-rs/canvas');
const { registerCardFonts, canvasFont, printable } = require('../imgutils/cardFonts');
exports.WIDTH = 1024;
exports.HEIGHT = 420;
const BANNER_H = 250;
const FONT = 'Poppins';
function hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
        if (i === 0)
            ctx.moveTo(x, y);
        else
            ctx.lineTo(x, y);
    }
    ctx.closePath();
}
/** One badge in a hexagon: its art, or its colour with its text; and the frame it was upgraded to (a gold ring, or a double rainbow ring that glows). */
function drawBadge(ctx, badge, cx, cy, r) {
    hexPath(ctx, cx, cy, r);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    if (badge.art) {
        ctx.save();
        hexPath(ctx, cx, cy, r);
        ctx.clip();
        ctx.drawImage(badge.art, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
    }
    else {
        hexPath(ctx, cx, cy, r);
        ctx.fillStyle = badge.color;
        ctx.fill();
        hexPath(ctx, cx, cy, r - 8);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        if (badge.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = canvasFont(FONT, 700, Math.round(r * 0.62));
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(printable(badge.label), cx, cy + 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    }
    if (badge.frame === 'bright') {
        ctx.save();
        ctx.shadowColor = 'rgba(255,214,102,0.9)';
        ctx.shadowBlur = 14;
        hexPath(ctx, cx, cy, r + 3);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#ffd666';
        ctx.stroke();
        ctx.restore();
    }
    else if (badge.frame === 'divine') {
        ctx.save();
        ctx.shadowColor = 'rgba(255,255,255,0.95)';
        ctx.shadowBlur = 20;
        const rainbow = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        ['#ff7aa8', '#ffd666', '#8affc1', '#7ad0ff', '#c79bff'].forEach((color, i, all) => rainbow.addColorStop(i / (all.length - 1), color));
        hexPath(ctx, cx, cy, r + 6);
        ctx.lineWidth = 5;
        ctx.strokeStyle = rainbow;
        ctx.stroke();
        hexPath(ctx, cx, cy, r + 1);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
    }
}
function cover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth)
        return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth)
        out = out.slice(0, -1);
    return `${out}…`;
}
/** Draws the profile and returns the PNG. Never throws for a missing picture: it is just left out. */
function renderProfileImage(data) {
    registerCardFonts();
    const canvas = createCanvas(exports.WIDTH, exports.HEIGHT);
    const ctx = canvas.getContext('2d');
    // Background: the banner, dimmed, or a plain gradient.
    const bg = ctx.createLinearGradient(0, 0, exports.WIDTH, exports.HEIGHT);
    bg.addColorStop(0, '#17141f');
    bg.addColorStop(1, '#2a2140');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, exports.WIDTH, exports.HEIGHT);
    if (data.banner) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, exports.WIDTH, BANNER_H);
        ctx.clip();
        cover(ctx, data.banner, 0, 0, exports.WIDTH, BANNER_H);
        ctx.restore();
        // The banner fades into the dark of the card, so it has no hard edge.
        const fade = ctx.createLinearGradient(0, 0, 0, BANNER_H);
        fade.addColorStop(0, 'rgba(14,12,20,0.1)');
        fade.addColorStop(0.55, 'rgba(14,12,20,0.55)');
        fade.addColorStop(1, '#17141f');
        ctx.fillStyle = fade;
        ctx.fillRect(0, 0, exports.WIDTH, BANNER_H);
    }
    // Avatar: a circle, no ring.
    const ax = 48, ay = 62, size = 150;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#4e5058';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (data.avatar)
        ctx.drawImage(data.avatar, ax, ay, size, size);
    ctx.restore();
    // Name and the star of the plan.
    const nx = ax + size + 32;
    ctx.fillStyle = '#ffffff';
    ctx.font = data.nameFont ? `48px "${data.nameFont}", ${canvasFont(FONT, 700, 48)}` : canvasFont(FONT, 700, 48);
    ctx.textBaseline = 'alphabetic';
    const name = fitText(ctx, printable(data.name), exports.WIDTH - nx - 130);
    ctx.fillText(name, nx, ay + 58);
    if (data.planStar) {
        const w = ctx.measureText(name).width;
        ctx.drawImage(data.planStar, nx + w + 14, ay + 16, 52, 52);
    }
    // Four numbers.
    const gap = 14, boxW = (exports.WIDTH - nx - 48 - gap * 3) / 4, boxH = 82, by = ay + 82;
    data.stats.slice(0, 4).forEach((stat, i) => {
        const x = nx + i * (boxW + gap);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.roundRect(x, by, boxW, boxH, 14);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = canvasFont(FONT, 600, 18);
        ctx.fillText(fitText(ctx, printable(stat.label).toUpperCase(), boxW - 32), x + 16, by + 30);
        ctx.fillStyle = '#ffffff';
        ctx.font = canvasFont(FONT, 700, 32);
        ctx.fillText(fitText(ctx, stat.value, boxW - 32), x + 16, by + 66);
    });
    // Showcase: six hexagons.
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = canvasFont(FONT, 600, 18);
    ctx.fillText(printable(data.showcaseTitle).toUpperCase(), 48, 272);
    const r = 48, cy = 338, step = (exports.WIDTH - 96) / 6, startX = 48 + step / 2;
    for (let i = 0; i < 6; i += 1) {
        const cx = startX + i * step;
        const badge = data.showcase[i];
        const locked = i >= data.slots;
        if (badge) {
            drawBadge(ctx, badge, cx, cy, r);
        }
        else {
            hexPath(ctx, cx, cy, r);
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fill();
            ctx.setLineDash([6, 6]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = locked ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.35)';
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = locked ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)';
            if (locked) {
                ctx.beginPath();
                ctx.roundRect(cx - 11, cy - 4, 22, 17, 3);
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(255,255,255,0.25)';
                ctx.beginPath();
                ctx.arc(cx, cy - 4, 7, Math.PI, 0);
                ctx.stroke();
            }
            else {
                ctx.font = canvasFont(FONT, 600, 34);
                ctx.textAlign = 'center';
                ctx.fillText('+', cx, cy + 12);
                ctx.textAlign = 'left';
            }
        }
    }
    return canvas.toBuffer('image/png');
}
