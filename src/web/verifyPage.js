function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Renders the self-contained verification page. Styled after Claude/Anthropic's
 * dark editorial look (warm near-black background, serif headline, hairline
 * borders, one restrained accent color) rather than a typical "AI product"
 * purple/blue gradient, uses Petto's own icon set (src/web/public) instead of
 * stock icons, and the Petto mark is shown plain (no icon-tile background).
 */
function renderVerifyPage({ token, siteKey }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify · Petto</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #1e1d1b;
    --card: #262523;
    --border: #3c3a36;
    --text: #f3f1ea;
    --text-muted: #9c968a;
    --accent: #8399ff;
    --accent-hover: #9aacff;
    --green: #a5ea7a;
    --green-wash: rgba(165, 234, 122, 0.12);
    --red: #fe6465;
    --red-wash: rgba(254, 100, 101, 0.12);
    --yellow: #fed53c;
    --yellow-wash: rgba(254, 213, 60, 0.12);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  @keyframes cardIn {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes duckHop {
    0% { transform: translateY(0) rotate(0deg); }
    30% { transform: translateY(-10px) rotate(-6deg); }
    50% { transform: translateY(0) rotate(4deg); }
    70% { transform: translateY(-4px) rotate(-2deg); }
    100% { transform: translateY(0) rotate(0deg); }
  }
  @keyframes statusIn {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
  }

  .card {
    width: 100%;
    max-width: 480px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 56px 48px;
    text-align: center;
    animation: cardIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .logo {
    width: 72px;
    height: 72px;
    margin: 0 auto 28px;
    cursor: default;
    animation: duckHop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.35s both;
  }
  .logo:hover { animation: duckHop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .eyebrow {
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 14px;
  }
  h1 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-weight: 600;
    font-size: 30px;
    line-height: 1.28;
    margin: 0 0 14px;
    letter-spacing: -0.01em;
  }
  p.sub {
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1.6;
    margin: 0 0 34px;
  }
  .widget-wrap {
    display: flex;
    justify-content: center;
    margin-bottom: 26px;
    min-height: 65px;
  }
  button#continue-btn {
    width: 100%;
    padding: 14px 18px;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #1e1d1b;
    font-family: inherit;
    font-size: 16px;
    font-weight: 600;
    cursor: not-allowed;
    opacity: 0.4;
    transform: scale(1);
    transition: background 0.15s ease, opacity 0.2s ease, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  button#continue-btn.ready {
    cursor: pointer;
    opacity: 1;
  }
  button#continue-btn.ready:hover { background: var(--accent-hover); transform: translateY(-1px) scale(1.015); }
  button#continue-btn.ready:active { transform: translateY(0) scale(0.98); }

  .status {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 15px 18px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 500;
    margin-top: 18px;
    text-align: left;
  }
  .status.show { display: flex; animation: statusIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .status.success img { animation: duckHop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
  .status img { width: 22px; height: 22px; flex-shrink: 0; }
  .status.success { background: var(--green-wash); color: var(--green); }
  .status.error { background: var(--red-wash); color: var(--red); }

  footer {
    margin-top: 30px;
    font-size: 13px;
    color: var(--text-muted);
  }
  footer b { color: var(--text); font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="/assets/favicon.png" alt="Petto"></div>
    <div class="eyebrow">Petto Verification</div>
    <h1>Let's confirm you're human</h1>
    <p class="sub">Complete the check below and you'll get access to the rest of the server right away.</p>

    <div class="widget-wrap">
      <div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-callback="onTurnstileSuccess" data-theme="dark"></div>
    </div>

    <button id="continue-btn" disabled>Verify</button>

    <div class="status success" id="status-success">
      <img src="/assets/icon-approve.png" alt="">
      <span id="status-success-text">You're verified. You can close this tab.</span>
    </div>
    <div class="status error" id="status-error">
      <img src="/assets/icon-deny.png" alt="">
      <span id="status-error-text">Something went wrong.</span>
    </div>

    <footer>Cloudflare &middot; Discord &middot; <b>Petto</b></footer>
  </div>

  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    let turnstileToken = null;
    const btn = document.getElementById('continue-btn');
    const successBox = document.getElementById('status-success');
    const errorBox = document.getElementById('status-error');
    const errorText = document.getElementById('status-error-text');

    window.onTurnstileSuccess = function (t) {
      turnstileToken = t;
      btn.disabled = false;
      btn.classList.add('ready');
    };

    btn.addEventListener('click', async () => {
      if (!turnstileToken || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      errorBox.classList.remove('show');

      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN, turnstileToken }),
        });
        const data = await res.json();

        if (data.ok) {
          btn.style.display = 'none';
          document.querySelector('.widget-wrap').style.display = 'none';
          successBox.classList.add('show');
        } else {
          errorText.textContent = data.error || 'Verification failed.';
          errorBox.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Verify';
        }
      } catch {
        errorText.textContent = 'Network error. Please try again.';
        errorBox.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Verify';
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderVerifyPage };
