"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildActivitySummaryCard = buildActivitySummaryCard;
const canvas_1 = require("@napi-rs/canvas");
const WIDTH = 1_360;
const HEIGHT = 480;
const BACKGROUND = '#0b0d10';
const CARD = '#12151a';
const CARD_BORDER = '#20262e';
const TEXT = '#f1f4f7';
const MUTED = '#6f7a89';
const GRID = '#242b34';
const MESSAGES = '#43e58a';
const REACTIONS = '#ffad18';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'Consolas, "Cascadia Code", monospace';
const LEFT_X = 40;
const LEFT_W = 294;
const MAIN_X = 358;
const MAIN_Y = 22;
const MAIN_W = WIDTH - MAIN_X - 40;
const MAIN_H = HEIGHT - 44;
const PLOT_X = MAIN_X + 88;
const PLOT_Y = MAIN_Y + 86;
const PLOT_W = MAIN_W - 128;
const PLOT_H = 286;
function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}
function fillRoundedRect(ctx, x, y, width, height, radius, fill) {
    roundedRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
}
function strokeRoundedRect(ctx, x, y, width, height, radius, stroke) {
    roundedRect(ctx, x, y, width, height, radius);
    ctx.strokeStyle = stroke;
    ctx.stroke();
}
function number(value) {
    return Number(value ?? 0) || 0;
}
function formatNumber(value) {
    return Math.round(value).toLocaleString('en-US');
}
function formatCompact(value) {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000)
        return `${(value / 1_000_000).toFixed(1).replace('.0', '')}m`;
    if (absolute >= 1_000)
        return `${(value / 1_000).toFixed(1).replace('.0', '')}k`;
    return formatNumber(value);
}
function formatDuration(seconds) {
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
function formatDay(day) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    });
}
function dateRange(days) {
    const count = Math.max(1, Math.min(31, Math.floor(days) || 7));
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const result = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
        const day = new Date(end);
        day.setUTCDate(day.getUTCDate() - offset);
        result.push({ day: day.toISOString().slice(0, 10), messages: 0, reactions: 0 });
    }
    return result;
}
function buildDailyPoints(rows, days) {
    const points = dateRange(days);
    const byDay = new Map(points.map((point) => [point.day, point]));
    for (const row of rows) {
        const point = byDay.get(row.day);
        if (!point)
            continue;
        point.messages += number(row.messages);
        point.reactions += number(row.reactions);
    }
    return points;
}
function seriesPoints(values, max) {
    const step = values.length > 1 ? PLOT_W / (values.length - 1) : 0;
    return values.map((value, index) => ({
        x: PLOT_X + (values.length === 1 ? PLOT_W / 2 : index * step),
        y: PLOT_Y + PLOT_H - (value / max) * (PLOT_H - 10) - 5,
    }));
}
function drawSmoothPath(ctx, points, close = false) {
    if (!points.length)
        return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
        ctx.arc(points[0].x, points[0].y, 1, 0, Math.PI * 2);
    }
    else if (points.length === 2) {
        ctx.lineTo(points[1].x, points[1].y);
    }
    else {
        for (let index = 0; index < points.length - 1; index += 1) {
            const p0 = points[index === 0 ? 0 : index - 1];
            const p1 = points[index];
            const p2 = points[index + 1];
            const p3 = points[index + 2 < points.length ? index + 2 : index + 1];
            let c1x = p1.x + (p2.x - p0.x) / 6;
            let c1y = p1.y + (p2.y - p0.y) / 6;
            let c2x = p2.x - (p3.x - p1.x) / 6;
            let c2y = p2.y - (p3.y - p1.y) / 6;
            const yLo = Math.min(p1.y, p2.y);
            const yHi = Math.max(p1.y, p2.y);
            c1y = Math.max(yLo, Math.min(yHi, c1y));
            c2y = Math.max(yLo, Math.min(yHi, c2y));
            c1x = Math.max(p1.x, Math.min(p2.x, c1x));
            c2x = Math.max(p1.x, Math.min(p2.x, c2x));
            ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
        }
    }
    if (close) {
        ctx.lineTo(points[points.length - 1].x, PLOT_Y + PLOT_H);
        ctx.lineTo(points[0].x, PLOT_Y + PLOT_H);
        ctx.closePath();
    }
}
function drawMetricIcon(ctx, kind, x, y, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'messages') {
        roundedRect(ctx, x, y + 1, 22, 17, 5);
        ctx.moveTo(x + 6, y + 18);
        ctx.lineTo(x + 5, y + 22);
        ctx.lineTo(x + 10, y + 18);
        ctx.moveTo(x + 6, y + 8);
        ctx.lineTo(x + 16, y + 8);
    }
    else if (kind === 'reactions') {
        ctx.arc(x + 11, y + 11, 9, 0, Math.PI * 2);
        ctx.moveTo(x + 7, y + 10);
        ctx.lineTo(x + 8, y + 10);
        ctx.moveTo(x + 14, y + 10);
        ctx.lineTo(x + 15, y + 10);
        ctx.moveTo(x + 7, y + 14);
        ctx.quadraticCurveTo(x + 11, y + 18, x + 15, y + 14);
    }
    else if (kind === 'voice') {
        ctx.arc(x + 10, y + 10, 7, 0, Math.PI * 2);
        ctx.moveTo(x + 10, y + 10);
        ctx.lineTo(x + 10, y + 5);
        ctx.moveTo(x + 10, y + 10);
        ctx.lineTo(x + 14, y + 13);
    }
    else {
        roundedRect(ctx, x, y + 1, 22, 6, 2);
        roundedRect(ctx, x, y + 10, 22, 6, 2);
        ctx.moveTo(x + 5, y + 20);
        ctx.lineTo(x + 17, y + 20);
    }
    ctx.stroke();
    ctx.restore();
}
function drawMetricCard(ctx, y, label, value, color, kind) {
    fillRoundedRect(ctx, LEFT_X, y, LEFT_W, 88, 15, CARD);
    strokeRoundedRect(ctx, LEFT_X, y, LEFT_W, 88, 15, CARD_BORDER);
    drawMetricIcon(ctx, kind, LEFT_X + 20, y + 21, color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(label, LEFT_X + 59, y + 18);
    ctx.font = `600 25px ${SERIF}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(value, LEFT_X + 59, y + 39);
}
function drawLegend(ctx, x, y, color, label) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y + 6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(label, x + 14, y - 2);
}
function truncate(value, maxLength) {
    if (value.length <= maxLength)
        return value;
    return `${value.slice(0, maxLength - 1)}…`;
}
function drawChart(ctx, points) {
    const maxValue = Math.max(1, ...points.map((point) => Math.max(point.messages, point.reactions)));
    const messagePoints = seriesPoints(points.map((point) => point.messages), maxValue);
    const reactionPoints = seriesPoints(points.map((point) => point.reactions), maxValue);
    ctx.save();
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const y = PLOT_Y + PLOT_H * fraction;
        ctx.beginPath();
        ctx.moveTo(PLOT_X, y);
        ctx.lineTo(PLOT_X + PLOT_W, y);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = MUTED;
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const y = PLOT_Y + PLOT_H * fraction;
        ctx.fillText(formatCompact(maxValue * (1 - fraction)), PLOT_X - 16, y);
    }
    const messagesGradient = ctx.createLinearGradient(0, PLOT_Y, 0, PLOT_Y + PLOT_H);
    messagesGradient.addColorStop(0, 'rgba(67,229,138,0.28)');
    messagesGradient.addColorStop(1, 'rgba(67,229,138,0)');
    drawSmoothPath(ctx, messagePoints, true);
    ctx.fillStyle = messagesGradient;
    ctx.fill();
    const reactionsGradient = ctx.createLinearGradient(0, PLOT_Y, 0, PLOT_Y + PLOT_H);
    reactionsGradient.addColorStop(0, 'rgba(255,173,24,0.24)');
    reactionsGradient.addColorStop(1, 'rgba(255,173,24,0)');
    drawSmoothPath(ctx, reactionPoints, true);
    ctx.fillStyle = reactionsGradient;
    ctx.fill();
    drawSmoothPath(ctx, messagePoints);
    ctx.strokeStyle = MESSAGES;
    ctx.lineWidth = 3;
    ctx.stroke();
    drawSmoothPath(ctx, reactionPoints);
    ctx.strokeStyle = REACTIONS;
    ctx.lineWidth = 3;
    ctx.stroke();
    for (const [series, color] of [[messagePoints, MESSAGES], [reactionPoints, REACTIONS]]) {
        for (const point of series) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = CARD;
            ctx.fill();
        }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = MUTED;
    const labelCount = Math.min(10, points.length);
    const labelIndexes = new Set();
    for (let index = 0; index < labelCount; index += 1) {
        labelIndexes.add(labelCount === 1 ? 0 : Math.round((index * (points.length - 1)) / (labelCount - 1)));
    }
    for (const index of labelIndexes) {
        const point = points[index];
        const x = PLOT_X + (points.length === 1 ? PLOT_W / 2 : (index / (points.length - 1)) * PLOT_W);
        ctx.fillText(formatDay(point.day), x, PLOT_Y + PLOT_H + 18);
    }
    ctx.restore();
}
function buildActivitySummaryCard({ guildName, days, rows, totals, activeChannels }) {
    const canvas = (0, canvas_1.createCanvas)(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawMetricCard(ctx, 22, `Messages (${days}d)`, formatNumber(totals.messages), MESSAGES, 'messages');
    drawMetricCard(ctx, 126, `Reactions (${days}d)`, formatNumber(totals.reactions), REACTIONS, 'reactions');
    drawMetricCard(ctx, 230, `Voice time (${days}d)`, formatDuration(totals.voiceSeconds), '#8399ff', 'voice');
    drawMetricCard(ctx, 334, 'Active channels', formatNumber(activeChannels), '#5eead4', 'channels');
    fillRoundedRect(ctx, MAIN_X, MAIN_Y, MAIN_W, MAIN_H, 16, CARD);
    strokeRoundedRect(ctx, MAIN_X, MAIN_Y, MAIN_W, MAIN_H, 16, CARD_BORDER);
    drawLegend(ctx, MAIN_X + 20, MAIN_Y + 21, MESSAGES, 'Messages');
    drawLegend(ctx, MAIN_X + 154, MAIN_Y + 21, REACTIONS, 'Reactions');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(`Last ${days} day${days === 1 ? '' : 's'}`, MAIN_X + MAIN_W - 20, MAIN_Y + 20);
    ctx.textAlign = 'left';
    ctx.font = `600 27px ${SERIF}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(truncate(`Activity overview · ${guildName}`, 52), MAIN_X + 20, MAIN_Y + 47);
    drawChart(ctx, buildDailyPoints(rows, days));
    return canvas.toBuffer('image/png');
}
