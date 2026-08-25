// Renders the activity card used by the activity commands.
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { ActivityType } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');

GlobalFonts.registerFromPath(path.join(__dirname, 'Chewy.ttf'), 'Chewy');

const TYPE_LABEL = {
  [ActivityType.Playing]: 'Playing',
  [ActivityType.Streaming]: 'Streaming',
  [ActivityType.Listening]: 'Listening to',
  [ActivityType.Watching]: 'Watching',
  [ActivityType.Competing]: 'Competing in',
};

const W = 1000;
const H = 315;
const RADIUS = 20;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function fmtElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Tries the activity's built-in large image, then Discord's external/app-asset CDN shapes, then the app icon, in that order. */
async function getActivityImage(activity) {
  const urls = [];

  try {
    const builtIn = activity.assets?.largeImageURL({ size: 512 });
    if (builtIn) urls.push(builtIn);
  } catch (err) {
    logger.warn('[acCard] largeImageURL() threw:', err?.message);
  }

  const img = activity.assets?.largeImage;
  const appId = activity.applicationId;

  if (img && img.startsWith('mp:external/')) {
    const parts = img.replace('mp:external/', '').split('/');
    const scheme = parts[1] ?? 'https';
    urls.push(`${scheme}://${parts.slice(2).join('/')}`);
  } else if (img && appId) {
    const base = `https://cdn.discordapp.com/app-assets/${appId}/${img}`;
    urls.push(`${base}.png`, `${base}.webp`, base);
  } else if (appId) {
    try {
      const app = await activity.client?.application?.fetch?.();
      if (app?.icon) urls.push(`https://cdn.discordapp.com/app-icons/${appId}/${app.icon}.png`);
    } catch {
      // No app icon available either — falls through to the caller's avatar fallback.
    }
  }

  for (const url of urls) {
    try {
      return await loadImage(url);
    } catch {
      // Try the next candidate URL.
    }
  }
  return null;
}

async function buildAcCard({ activity, member }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  roundRect(ctx, 0, 0, W, H, RADIUS);
  ctx.clip();
  const bg = await loadImage(path.join(__dirname, 'fondoac.png'));
  ctx.drawImage(bg, 0, 0, W, H);
  let art = await getActivityImage(activity);
  if (!art && member) {
    try {
      const avatarURL = member.displayAvatarURL({ size: 512, extension: 'png' });
      art = await loadImage(avatarURL);
    } catch {
      // No avatar to fall back to either — background stays plain.
    }
  }
  if (art) ctx.drawImage(art, 0, 0, 313.8, 315);

  const TEXT_X = 379.9;
  const MAX_X = 910;
  const maxW = MAX_X - TEXT_X;

  ctx.textBaseline = 'top';
  const typeLabel = TYPE_LABEL[activity.type] ?? 'Activity';
  ctx.font = `16px Chewy, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(typeLabel.toUpperCase(), TEXT_X, 22);
  ctx.font = `bold 58px Chewy, sans-serif`;
  ctx.fillStyle = '#ffffff';
  let name = activity.name ?? 'Unknown';
  while (ctx.measureText(name).width > maxW && name.length > 1) name = name.slice(0, -1);
  if (name !== activity.name) name = name.slice(0, -2) + '…';
  ctx.fillText(name, TEXT_X, 42);
  const detailStr = activity.details || activity.assets?.largeText || null;
  if (detailStr) {
    ctx.font = `20px Chewy, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    let det = detailStr;
    while (ctx.measureText(det).width > maxW && det.length > 1) det = det.slice(0, -1);
    if (det !== detailStr) det = det.slice(0, -2) + '…';
    ctx.fillText(det, TEXT_X, 116);
  }
  if (activity.state) {
    ctx.font = `17px Chewy, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.60)';
    let st = activity.state;
    while (ctx.measureText(st).width > maxW && st.length > 1) st = st.slice(0, -1);
    if (st !== activity.state) st = st.slice(0, -2) + '…';
    ctx.fillText(st, TEXT_X, 142);
  }
  const party = activity.party;
  if (party?.size) {
    const [cur, max] = party.size;
    ctx.font = `15px Chewy, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(`${cur} / ${max} players`, TEXT_X, 165);
  }
  const smallText = activity.assets?.smallText;
  if (smallText) {
    ctx.font = `14px Chewy, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.fillText(smallText, TEXT_X, party?.size ? 184 : 165);
  }
  const barX = 423.1;
  const barW = 458.1;
  const barH = 5;
  const centerY = 225;
  const barY = centerY - barH / 2;
  const timeY = centerY - 7;
  const fontSize = 13;

  if (activity.timestamps?.start) {
    const elapsed = Date.now() - activity.timestamps.start.getTime();
    const elapsedStr = fmtElapsed(elapsed);

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fill();

    ctx.font = `${fontSize}px Chewy, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'right';
    ctx.fillText(elapsedStr, barX - 8, timeY);
    ctx.textAlign = 'left';
    ctx.fillText('elapsed', barX + barW + 8, timeY);
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

module.exports = { buildAcCard };
