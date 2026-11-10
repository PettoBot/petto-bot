// i18n-ignore-file: the email of the verification code is built from the catalogs (verify.email.*); this file is markup, the API of Resend and logs
// Sends the email with the code of the verification through Resend (https://resend.com): RESEND_API_KEY and RESEND_FROM (an address of a domain verified there).
const config = require('../config');
const { t } = require('../i18n');

const API = 'https://api.resend.com/emails';
const LOGO = () => `${config.siteUrl}/assets/mascot-icon.png`;

const configured = () => Boolean(config.resendApiKey && config.resendFrom);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The email with a code: `{ subject, html, text }`, in a language. `guildName` is the server the member verifies for. */
function buildCodeEmail({ code, lang, guildName, minutes = 10 }) {
  const server = String(guildName || 'Discord').slice(0, 100);
  const copy = (key) => t(lang, `verify.email.${key}`, { server, minutes, code });
  const bold = (key) => escapeHtml(t(lang, `verify.email.${key}`, { server: '\u0001', minutes, code })).replace('\u0001', `<b style="color:#f3f1ea">${escapeHtml(server)}</b>`);
  const digits = [...code].map((digit) => `<td style="width:46px;height:58px;border:1px solid #2f3340;border-radius:12px;background:#1b1d23;color:#ffffff;font:700 28px/58px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center">${digit}</td>`).join('<td style="width:8px"></td>');
  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(copy('subject'))}</title></head>
<body style="margin:0;padding:0;background:#0f1013">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(copy('preheader'))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1013"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#15171b;border:1px solid #2a2d35;border-radius:20px">
    <tr><td style="padding:30px 30px 6px" align="left">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:46px"><img src="${escapeHtml(LOGO())}" width="40" height="40" alt="Petto" style="display:block;border-radius:12px"></td>
        <td style="font:700 18px -apple-system,Segoe UI,Roboto,sans-serif;color:#f3f1ea;letter-spacing:-.02em">Petto</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:14px 30px 0;font:700 26px/1.15 -apple-system,Segoe UI,Roboto,sans-serif;color:#f3f1ea;letter-spacing:-.03em">${escapeHtml(copy('heading'))}</td></tr>
    <tr><td style="padding:10px 30px 0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#9c968a">${bold('body')}</td></tr>
    <tr><td align="center" style="padding:24px 30px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td></tr>
    <tr><td align="center" style="padding:10px 30px 0;font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#8399ff">${escapeHtml(copy('expires'))}</td></tr>
    <tr><td style="padding:24px 30px 0"><div style="height:1px;background:#262930"></div></td></tr>
    <tr><td style="padding:16px 30px 0;font:13px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#6f6a62">${escapeHtml(copy('never'))}<br>${escapeHtml(copy('ignore'))}</td></tr>
    <tr><td style="padding:18px 30px 28px;font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#55524c">${bold('footer')}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = [copy('heading'), '', copy('body'), '', `    ${code}`, '', copy('expires'), '', copy('never'), copy('ignore'), '', copy('footer')].join('\n');
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
