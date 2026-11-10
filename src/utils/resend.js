// i18n-ignore-file: the email of the verification code is built from the catalogs (verify.email.*); this file is markup, the API of Resend and logs
// Sends the email with the code of the verification through Resend (https://resend.com): RESEND_API_KEY and RESEND_FROM (an address of a domain verified there).
const config = require('../config');
const { t } = require('../i18n');

const API = 'https://api.resend.com/emails';
const LOGO = () => `${config.siteUrl}/assets/mascot-icon.png`;
const BANNER = () => `${config.siteUrl}/assets/mail-banner.jpg`;

const configured = () => Boolean(config.resendApiKey && config.resendFrom);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SUPPORT = 'https://discord.gg/petto';
// The colors of the email: amber. The banner at the top is a picture (`/assets/mail-banner.jpg` of the website); the cell has the same gradient as a fallback for the clients that do not load pictures.
const THEME = { from: '#ffb347', to: '#e8743b', accent: '#ffc15e', box: '#2a2013', boxBorder: '#5a4320', pill: '#3a2d18', pillText: '#ffd28a' };
const FONT = '-apple-system,Segoe UI,Roboto,sans-serif';
const pagePath = (lang, page) => `${config.siteUrl}${String(lang).startsWith('es') ? '/es' : String(lang).startsWith('pt') ? '/pt-br' : ''}/${page}`;

/**
 * The email with a code: `{ subject, html, text }`, in a language. `guildName` is the server the member verifies for.
 * Laid out like a welcome email: a banner with the mascot, a big title, the code where a button would be, a short "stay safe" part,
 * and a footer with the links (website, support server, Terms and Privacy) and the notice.
 */
function buildCodeEmail({ code, lang, guildName, minutes = 10 }) {
  const theme = THEME;
  const server = String(guildName || 'Discord').slice(0, 100);
  const copy = (key) => t(lang, `verify.email.${key}`, { server, minutes, code });
  const bold = (key) => escapeHtml(t(lang, `verify.email.${key}`, { server: '\u0001', minutes, code })).replace('\u0001', `<b style="color:#f3f1ea">${escapeHtml(server)}</b>`).replace(/\n/g, '<br>');
  const year = new Date().getFullYear();
  const digits = [...code].map((digit) => `<td style="width:46px;height:58px;border:1px solid ${theme.boxBorder};border-radius:12px;background:${theme.box};color:#ffffff;font:700 28px/58px ${FONT};text-align:center">${digit}</td>`).join('<td style="width:8px"></td>');
  const label = (text) => `<div style="font:600 12px/1.4 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:#cfcbc0">- ${escapeHtml(text)} -</div>`;
  const pill = (href, text) => `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 4px;padding:9px 16px;border-radius:10px;background:${theme.pill};color:${theme.pillText};font:600 13px/1 ${FONT};text-decoration:none">${escapeHtml(text)}</a>`;
  const link = (href, text) => `<a href="${escapeHtml(href)}" style="color:#cfcbc0;text-decoration:underline">${escapeHtml(text)}</a>`;
  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(copy('subject'))}</title></head>
<body style="margin:0;padding:0;background:#0b0c0f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(copy('preheader'))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0f"><tr><td align="center" style="padding:26px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121317;border:1px solid #23262d;border-radius:18px;overflow:hidden">
    <tr><td align="center" bgcolor="${theme.from}" style="background:${theme.from};background-image:linear-gradient(135deg,${theme.from} 0%,${theme.to} 100%);line-height:0;font-size:0">
      <img src="${escapeHtml(BANNER())}" width="520" alt="Petto" style="display:block;width:100%;max-width:520px;height:auto;border:0">
    </td></tr>
    <tr><td align="center" style="padding:30px 30px 0;font:800 34px/1.1 ${FONT};letter-spacing:-.02em;text-transform:uppercase;color:${theme.accent}">${escapeHtml(copy('heading'))}</td></tr>
    <tr><td align="center" style="padding:16px 30px 0;font:700 17px/1.4 ${FONT};color:#f3f1ea">${escapeHtml(copy('sub'))}</td></tr>
    <tr><td align="center" style="padding:12px 34px 0;font:15px/1.6 ${FONT};color:#c9c4b8">${bold('body')}</td></tr>
    <tr><td align="center" style="padding:24px 30px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td></tr>
    <tr><td align="center" style="padding:12px 30px 0;font:13px/1.5 ${FONT};color:#8d887d">${escapeHtml(copy('expires'))}</td></tr>
    <tr><td align="center" style="padding:30px 34px 0">${label(copy('safeTitle'))}</td></tr>
    <tr><td align="center" style="padding:10px 34px 0;font:14px/1.6 ${FONT};color:#c9c4b8">${escapeHtml(copy('never'))}<br>${escapeHtml(copy('ignore'))}</td></tr>
    <tr><td align="center" style="padding:28px 34px 28px;font:15px/1.6 ${FONT};color:#f3f1ea">${bold('signoff')}</td></tr>
    <tr><td style="padding:0 18px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#181a1f;border:1px solid #23262d;border-radius:14px"><tr><td align="center" style="padding:24px 18px 22px">
        <img src="${escapeHtml(LOGO())}" width="44" height="44" alt="" style="display:block;border-radius:12px;margin:0 auto 16px">
        <div style="margin:0 0 16px">${pill(config.siteUrl, copy('website'))}${pill(SUPPORT, 'Discord')}</div>
        <div style="font:13px/1.8 ${FONT};color:#8d887d">${link(pagePath(lang, 'terms'), copy('terms'))} &nbsp;|&nbsp; ${link(pagePath(lang, 'privacy'), copy('privacy'))}</div>
        <div style="padding-top:14px;font:12px/1.6 ${FONT};color:#6f6a62">${year} &copy; Petto &middot; ${escapeHtml(copy('rights'))}<br>${escapeHtml(copy('notAffiliated'))}<br>${bold('footer')}</div>
      </td></tr></table>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = [copy('heading'), copy('sub'), '', copy('body'), '', `    ${code}`, '', copy('expires'), '', copy('never'), copy('ignore'), '', copy('signoff'), '', `${pagePath(lang, 'terms')}  |  ${pagePath(lang, 'privacy')}`, copy('footer')].join('\n');
  return { subject: copy('subject'), html, text };
}

/**
 * Sends a code. Returns `{ ok: true }` or `{ ok: false, reason }` (`not_configured`, `rejected` with the status, `unreachable`); never throws.
 * `fetcher` (tests) replaces the network.
 */
async function sendCodeEmail({ to, code, lang, guildName }, { fetcher = globalThis.fetch } = {}) {
  if (!configured()) return { ok: false, reason: 'not_configured' };
  const mail = buildCodeEmail({ code, lang, guildName });
  try {
    const response = await fetcher(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.resendFrom, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      return { ok: false, reason: 'rejected', status: response.status, detail: detail?.message ?? detail?.name ?? null };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'unreachable', detail: error.message };
  }
}

module.exports = { configured, buildCodeEmail, sendCodeEmail };
