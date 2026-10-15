const { t, currentLanguage, normalizeLanguage, DEFAULT_LANGUAGE } = require('../i18n');

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The texts of the page (`web.verify.<field>`), in this order: the script of the page gets them as one object.
const COPY_FIELDS = [
  'title', 'eyebrow', 'heading', 'sub', 'forServer', 's1', 's1d', 's2', 's2d', 's3', 's3d', 'checkTitle', 'checkTitleTwo', 'turnstile',
  'lettersTitle', 'lettersHint', 'refresh', 'lettersLabel', 'button', 'verifying', 'done', 'cfLoad', 'cfExpired', 'wrong', 'locked', 'expired',
  'network', 'failed', 'loadPic', 'privacy', 'handled', 'rolesIn', 'footer', 'service',
];

/** The short language code (`es`, `pt` or `en`) of an Accept-Language header. The route itself uses requestLanguage() of src/i18n. */
function pickLanguage(header) {
  const first = String(header ?? '').toLowerCase().split(',').map((part) => part.trim().slice(0, 2));
  return first.find((code) => ['en', 'es', 'pt'].includes(code)) ?? 'en';
}

/**
 * `method` is `turnstile` (the Cloudflare check), `letters` (type the letters of a picture) or `both`. `guildName` and `guildIcon`
 * say which server the visitor is verifying for.
 */
function renderVerifyPage({ token, siteKey, method = 'turnstile', guildName = null, guildIcon = null, lang = currentLanguage() }) {
  const language = normalizeLanguage(lang) ?? DEFAULT_LANGUAGE;
  const copy = Object.fromEntries(COPY_FIELDS.map((field) => [field, t(language, `web.verify.${field}`)]));
  const useTurnstile = method !== 'letters';
  const useLetters = method === 'letters' || method === 'both';
  // i18n-ignore: markup; the texts in it come from the catalogs
  const server = guildName ? `<div class="server">${guildIcon ? `<img src="${escapeHtml(guildIcon)}" alt="">` : ''}<span>${escapeHtml(copy.forServer)} <b>${escapeHtml(guildName)}</b></span></div>` : '';
  // i18n-ignore: markup
  const turnstileBlock = useTurnstile ? `<p class="check-copy">${escapeHtml(copy.turnstile)}</p><div class="widget-wrap"><div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-callback="onTurnstileSuccess" data-error-callback="onTurnstileError" data-expired-callback="onTurnstileExpired" data-theme="dark"></div></div>` : '';
  // i18n-ignore: markup
  const lettersBlock = useLetters ? `<div class="letters"><p class="check-title">${escapeHtml(copy.lettersTitle)}</p><img class="letters-img" id="letters-img" width="260" height="96" alt="" hidden><div class="letters-row"><input id="letters-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" aria-label="${escapeHtml(copy.lettersLabel)}"><button type="button" id="letters-new">${escapeHtml(copy.refresh)}</button></div><p class="letters-hint">${escapeHtml(copy.lettersHint)}</p></div>` : '';
  // i18n-ignore: markup and a product name
  const privacyLead = useTurnstile ? `${escapeHtml(copy.privacy)} <b>Cloudflare Turnstile</b> · ` : '';
  const turnstileScript = useTurnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''; // i18n-ignore: markup
  // i18n-ignore: the markup, styles and script of the page; every text in it comes from the catalogs
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(copy.title)} &middot; Petto</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<style>
  :root { color-scheme:dark; --bg:#111214; --surface:#15171b; --surface-2:#191b20; --border:#2a2d35; --border-soft:#202228; --text:#f3f1ea; --muted:#9c968a; --dim:#6f6a62; --accent:#8399ff; --accent-soft:rgba(131,153,255,.14); --accent-hover:#9aacff; --accent-ink:#1a1c2e; --green:#a5ea7a; --green-soft:rgba(165,234,122,.14); --red:#fe6465; --red-soft:rgba(254,100,101,.14); --font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  * { box-sizing:border-box; }
  html,body { margin:0; min-height:100%; }
  body { min-height:100vh; padding:14px; background:var(--bg); color:var(--text); font:15px/1.55 var(--font); -webkit-font-smoothing:antialiased; }
  a { color:inherit; }
  @keyframes rise { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes duckHop { 0% { transform:translateY(0) rotate(0); } 30% { transform:translateY(-7px) rotate(-5deg); } 55% { transform:translateY(0) rotate(3deg); } 100% { transform:translateY(0) rotate(0); } }
  @keyframes statusIn { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
  @media (prefers-reduced-motion:reduce) { * { animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; } }
  .shell { width:min(100%,1180px); min-height:calc(100vh - 28px); margin:0 auto; display:flex; flex-direction:column; }
  .topbar { display:flex; align-items:center; justify-content:space-between; min-height:64px; padding:9px 12px; border:1px solid var(--border); border-radius:18px; background:rgba(17,18,20,.9); box-shadow:0 18px 50px -34px rgba(0,0,0,.8); backdrop-filter:blur(14px); }
  .brand { display:flex; align-items:center; gap:10px; color:var(--text); text-decoration:none; font-size:17px; font-weight:700; letter-spacing:-.02em; } .brand img { width:32px; height:32px; object-fit:contain; }
  .service { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; } .service-dot { width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px var(--green-soft); }
  .main { width:min(100%,620px); margin:auto; padding:58px 0 42px; animation:rise .45s cubic-bezier(.16,1,.3,1) both; }
  .card { padding:34px; border:1px solid var(--border); border-radius:18px; background:var(--surface); box-shadow:0 24px 64px -42px rgba(0,0,0,.8); }
  .intro { display:flex; align-items:flex-start; gap:18px; } .logo { width:62px; height:62px; flex:0 0 62px; padding:10px; border:1px solid var(--border); border-radius:16px; background:var(--surface-2); animation:duckHop .7s cubic-bezier(.34,1.56,.64,1) .25s both; } .logo img { width:100%; height:100%; object-fit:contain; }
  .eyebrow { margin:3px 0 8px; color:var(--dim); font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; } h1 { margin:0; font-size:clamp(26px,5vw,36px); line-height:1.1; letter-spacing:-.04em; } .sub { margin:11px 0 0; color:var(--muted); font-size:15px; }
  .steps { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:28px 0 24px; } .step { padding:10px 11px; border:1px solid var(--border-soft); border-radius:10px; color:var(--dim); font-size:11px; } .step.active { color:var(--text); border-color:rgba(131,153,255,.45); background:var(--accent-soft); } .step b { display:block; margin-bottom:2px; color:inherit; font-size:12px; }
  .check { padding:17px; border:1px solid var(--border); border-radius:12px; background:var(--surface-2); } .check-title { margin:0 0 4px; font-weight:700; } .check-copy { margin:0 0 15px; color:var(--muted); font-size:13px; } .widget-wrap { display:flex; justify-content:center; min-height:65px; padding:4px 0; }
  button#continue-btn { width:100%; margin-top:12px; padding:13px 18px; border:1px solid transparent; border-radius:11px; background:var(--accent); color:var(--accent-ink); font:700 15px var(--font); cursor:not-allowed; opacity:.42; transition:background .16s ease,opacity .16s ease,transform .16s ease,box-shadow .16s ease; } button#continue-btn.ready { cursor:pointer; opacity:1; box-shadow:0 12px 28px -20px var(--accent); } button#continue-btn.ready:hover { background:var(--accent-hover); transform:translateY(-1px); box-shadow:0 16px 32px -18px var(--accent); } button#continue-btn.ready:active { transform:translateY(0); }
  .status { display:none; align-items:flex-start; gap:10px; margin-top:14px; padding:13px 14px; border-radius:10px; font-size:13px; animation:statusIn .3s cubic-bezier(.16,1,.3,1) both; } .status.show { display:flex; } .status img { width:20px; height:20px; flex:0 0 20px; } .status.success { color:var(--green); background:var(--green-soft); } .status.error { color:var(--red); background:var(--red-soft); }
  .privacy { margin:17px 0 0; color:var(--dim); font-size:12px; text-align:center; } .privacy b { color:var(--muted); font-weight:600; } footer { margin-top:20px; color:var(--dim); font-size:12px; text-align:center; } footer b { color:var(--text); }
  @media (max-width:640px) { body { padding:8px; } .topbar { min-height:58px; border-radius:15px; } .main { padding:26px 0 18px; } .card { padding:22px 17px; border-radius:15px; } .intro { gap:13px; } .logo { width:52px; height:52px; flex-basis:52px; padding:8px; border-radius:13px; } .steps { gap:5px; margin:22px 0 18px; } .step { padding:8px; } }
  .letters { margin-top:14px; } .letters-img { display:block; width:100%; max-width:260px; margin:0 auto 10px; border-radius:12px; border:1px solid var(--border); background:var(--surface); }
  .letters-row { display:flex; gap:8px; justify-content:center; } .letters-row input { flex:1 1 auto; min-width:0; max-width:190px; padding:12px 14px; border:1px solid var(--border); border-radius:11px; background:var(--surface); color:var(--text); font:700 20px/1 var(--font); letter-spacing:.32em; text-align:center; text-transform:uppercase; } .letters-row input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  .letters-row button { padding:0 14px; border:1px solid var(--border); border-radius:11px; background:var(--surface-2); color:var(--muted); font:600 13px var(--font); cursor:pointer; } .letters-row button:hover { color:var(--text); border-color:var(--accent); }
  .letters-hint { margin:8px 0 0; color:var(--dim); font-size:12px; text-align:center; } .server { margin:14px 0 0; padding:9px 12px; border:1px solid var(--border-soft); border-radius:10px; color:var(--muted); font-size:13px; display:flex; align-items:center; gap:10px; } .server img { width:24px; height:24px; border-radius:50%; } .server b { color:var(--text); }
</style>
</head>
<body>
  <div class="shell">
    <header class="topbar"><a class="brand" href="/" aria-label="${escapeHtml(t(language, 'web.verify.homeLabel'))}"><img src="/assets/favicon.png" alt=""> <span>Petto</span></a><div class="service"><span class="service-dot" aria-hidden="true"></span>${escapeHtml(copy.service)}</div></header>
    <main class="main"><section class="card" aria-labelledby="page-title">
      <div class="intro"><div class="logo"><img src="/assets/favicon.png" alt="Petto"></div><div><div class="eyebrow">${escapeHtml(copy.eyebrow)}</div><h1 id="page-title">${escapeHtml(copy.heading)}</h1><p class="sub">${escapeHtml(copy.sub)}</p>${server}</div></div>
      <div class="steps" aria-label="${escapeHtml(t(language, 'web.verify.progressLabel'))}"><div class="step active"><b>${escapeHtml(copy.s1)}</b>${escapeHtml(copy.s1d)}</div><div class="step"><b>${escapeHtml(copy.s2)}</b>${escapeHtml(copy.s2d)}</div><div class="step"><b>${escapeHtml(copy.s3)}</b>${escapeHtml(copy.s3d)}</div></div>
      <div class="check"><p class="check-title">${escapeHtml(useTurnstile && useLetters ? copy.checkTitleTwo : copy.checkTitle)}</p>${turnstileBlock}${lettersBlock}<button id="continue-btn" disabled>${escapeHtml(copy.button)}</button></div>
      <div class="status success" id="status-success" role="status" aria-live="polite"><img src="/assets/icon-approve.png" alt=""><span id="status-success-text">${escapeHtml(copy.done)}</span></div>
      <div class="status error" id="status-error" role="alert"><img src="/assets/icon-deny.png" alt=""><span id="status-error-text"></span></div>
      <p class="privacy">${privacyLead}${escapeHtml(copy.handled)} <b>Petto</b> · ${escapeHtml(copy.rolesIn)}</p>
    </section><footer>Petto · ${escapeHtml(copy.footer)}</footer></main>
  </div>
  ${turnstileScript}
  <script>
    const TOKEN = ${JSON.stringify(token).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};
    const T = ${JSON.stringify(copy).replace(/</g, '\\u003c')};
    const USE_TURNSTILE = ${useTurnstile};
    const USE_LETTERS = ${useLetters};
    let turnstileToken = null;
    let ticket = null;
    const btn = document.getElementById('continue-btn');
    const widget = document.querySelector('.widget-wrap');
    const successBox = document.getElementById('status-success');
    const errorBox = document.getElementById('status-error');
    const errorText = document.getElementById('status-error-text');
    const img = document.getElementById('letters-img');
    const input = document.getElementById('letters-input');
    const lettersNew = document.getElementById('letters-new');

    function ready() {
      return (!USE_TURNSTILE || Boolean(turnstileToken)) && (!USE_LETTERS || (Boolean(ticket) && input.value.replace(/[^a-z0-9]/gi, '').length >= 4));
    }
    function refreshButton() { const on = ready(); btn.disabled = !on; btn.classList.toggle('ready', on); }
    function showError(message) { errorText.textContent = message; errorBox.classList.add('show'); }
    function hideError() { errorBox.classList.remove('show'); }
    async function loadPicture() {
      if (!USE_LETTERS) return;
      ticket = null; input.value = ''; refreshButton();
      try {
        const response = await fetch('/api/verify/captcha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || T.loadPic);
        img.src = data.image; img.hidden = false; ticket = data.ticket; refreshButton();
      } catch (error) { showError(error.message || T.loadPic); }
    }
    window.onTurnstileSuccess = function (value) { turnstileToken = value; hideError(); refreshButton(); };
    window.onTurnstileError = function () { turnstileToken = null; refreshButton(); showError(T.cfLoad); };
    window.onTurnstileExpired = function () { turnstileToken = null; refreshButton(); showError(T.cfExpired); };
    if (USE_LETTERS) { input.addEventListener('input', refreshButton); lettersNew.addEventListener('click', () => { hideError(); loadPicture(); }); input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && ready()) btn.click(); }); loadPicture(); }
    btn.addEventListener('click', async () => {
      if (!ready() || btn.disabled) return;
      btn.disabled = true; btn.classList.remove('ready'); btn.textContent = T.verifying; hideError();
      try {
        const response = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN, turnstileToken, captchaTicket: ticket, captchaAnswer: USE_LETTERS ? input.value : undefined }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) { const error = new Error(data.error || T.failed); error.code = data.code; throw error; }
        btn.style.display = 'none'; if (widget) widget.style.display = 'none'; const letters = document.querySelector('.letters'); if (letters) letters.style.display = 'none';
        successBox.classList.add('show');
      } catch (error) {
        turnstileToken = null; btn.textContent = T.button;
        if (typeof turnstile !== 'undefined' && USE_TURNSTILE) { try { turnstile.reset(); } catch (e) {} }
        showError(error.code === 'wrong' ? T.wrong : error.code === 'locked' ? T.locked : error.code === 'expired' ? T.expired : (error.message || T.network));
        if (USE_LETTERS && error.code !== 'locked') loadPicture(); else refreshButton();
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderVerifyPage, pickLanguage };
