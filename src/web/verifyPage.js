function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Self-contained verification page using the same Petto visual system as the
 * public website: neutral dark surfaces, compact rounded navigation, blue
 * accent, local mascot asset, and no external font dependency.
 */
function renderVerifyPage({ token, siteKey }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Verify &middot; Petto</title>
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
</style>
</head>
<body>
  <div class="shell">
    <header class="topbar"><a class="brand" href="/" aria-label="Petto home"><img src="/assets/favicon.png" alt=""> <span>Petto</span></a><div class="service"><span class="service-dot" aria-hidden="true"></span>Discord verification</div></header>
    <main class="main"><section class="card" aria-labelledby="page-title">
      <div class="intro"><div class="logo"><img src="/assets/favicon.png" alt="Petto"></div><div><div class="eyebrow">Server access</div><h1 id="page-title">Let's confirm you're human</h1><p class="sub">Complete this quick check and Petto will give you access to the rest of the server.</p></div></div>
      <div class="steps" aria-label="Verification progress"><div class="step active"><b>1. Check</b>Confirm you are human</div><div class="step"><b>2. Discord</b>Petto checks your link</div><div class="step"><b>3. Access</b>Roles update</div></div>
      <div class="check"><p class="check-title">One small check</p><p class="check-copy">Cloudflare protects this page from automated abuse. Petto does not ask for your Discord password.</p><div class="widget-wrap"><div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-callback="onTurnstileSuccess" data-error-callback="onTurnstileError" data-expired-callback="onTurnstileExpired" data-theme="dark"></div></div><button id="continue-btn" disabled>Verify with Petto</button></div>
      <div class="status success" id="status-success" role="status" aria-live="polite"><img src="/assets/icon-approve.png" alt=""><span id="status-success-text">You're verified. You can close this tab and return to Discord.</span></div>
      <div class="status error" id="status-error" role="alert"><img src="/assets/icon-deny.png" alt=""><span id="status-error-text">Something went wrong. Please try again.</span></div>
      <p class="privacy">Protected by <b>Cloudflare Turnstile</b> · handled by <b>Petto</b> · roles are changed in Discord</p>
    </section><footer>Petto · Discord server verification</footer></main>
  </div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    let turnstileToken = null;
    const btn = document.getElementById('continue-btn');
    const widget = document.querySelector('.widget-wrap');
    const successBox = document.getElementById('status-success');
    const errorBox = document.getElementById('status-error');
    const errorText = document.getElementById('status-error-text');

    function setReady(value) {
      btn.disabled = !value;
      btn.classList.toggle('ready', value);
    }
    function showError(message) {
      errorText.textContent = message;
      errorBox.classList.add('show');
    }
    window.onTurnstileSuccess = function (value) {
      turnstileToken = value;
      errorBox.classList.remove('show');
      setReady(true);
    };
    window.onTurnstileError = function () {
      turnstileToken = null;
      setReady(false);
      showError('Cloudflare could not load the check. Refresh the page and try again.');
    };
    window.onTurnstileExpired = function () {
      turnstileToken = null;
      setReady(false);
      showError('The check expired. Complete it again to continue.');
    };
    btn.addEventListener('click', async () => {
      if (!turnstileToken || btn.disabled) return;
      setReady(false);
      btn.textContent = 'Verifying...';
      errorBox.classList.remove('show');
      try {
        const response = await fetch('/api/verify', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ token: TOKEN, turnstileToken }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'Verification failed.');
        btn.style.display = 'none';
        widget.style.display = 'none';
        successBox.classList.add('show');
      } catch (error) {
        turnstileToken = null;
        btn.textContent = 'Verify with Petto';
        showError(error.message || 'Network error. Please try again.');
        setReady(false);
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderVerifyPage };
