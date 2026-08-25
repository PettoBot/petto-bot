// Renders the Spotify-style playback card used by the music status command.
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

GlobalFonts.registerFromPath(path.join(__dirname, 'Chewy.ttf'), 'Chewy');

const W = 1000;
const H = 315;
const RADIUS = 20;

// Spotify icon sits at ~x:930, so title must stay left of it
const TEXT_X = 379.9;
const TITLE_MAX_X = 910; // right edge before Spotify icon

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2); // never exceed half of width or height
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

async function buildSpCard({ albumArtUrl, songName, artistName, elapsed, total, progressRatio }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  roundRect(ctx, 0, 0, W, H, RADIUS);
  ctx.clip();
  const bg = await loadImage(path.join(__dirname, 'fondosp.png'));
  ctx.drawImage(bg, 0, 0, W, H);
  try {
    const art = await loadImage(albumArtUrl);
    ctx.drawImage(art, 0, 0, 313.8, 315);
  } catch {
    // No album art URL, or it failed to load — leave the background showing through.
  }
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = `bold 62px Chewy, sans-serif`;

  const maxTitleW = TITLE_MAX_X - TEXT_X;
  let song = songName;
  while (ctx.measureText(song).width > maxTitleW && song.length > 1) song = song.slice(0, -1);
  if (song !== songName) song = song.slice(0, -2) + '…';
  ctx.fillText(song, TEXT_X, 31.5);
  ctx.font = `21px Chewy, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';

  const maxArtistW = TITLE_MAX_X - TEXT_X;
  let artist = artistName;
  while (ctx.measureText(artist).width > maxArtistW && artist.length > 1) artist = artist.slice(0, -1);
  if (artist !== artistName) artist = artist.slice(0, -2) + '…';
  ctx.fillText(artist, TEXT_X, 111.2);
  const barX = 423.1;
  const barW = 458.1;
  const barH = 5;
  const centerY = 187; // common midpoint
  const barY = centerY - barH / 2; // 184.5
  const fontSize = 13;
  const timeY = centerY - fontSize / 2; // 180.5
  const gap = 8;
  ctx.font = `${fontSize}px Chewy, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textBaseline = 'top';

  ctx.textAlign = 'right';
  ctx.fillText(elapsed, barX - gap, timeY); // right-edge just before bar

  ctx.textAlign = 'left';
  ctx.fillText(total, barX + barW + gap, timeY); // left-edge just after bar

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();
  const ratio = Math.min(Math.max(progressRatio, 0), 1);
  const fillW = Math.max(barH, barW * ratio); // minimum = pill width
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, barX, barY, fillW, barH, barH / 2);
  ctx.fill();
  const thumbR = 6;
  const thumbX = Math.min(barX + fillW, barX + barW); // clamp to bar end
  const thumbY = barY + barH / 2;
  ctx.beginPath();
  ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  return canvas.toBuffer('image/png');
}

module.exports = { buildSpCard };
