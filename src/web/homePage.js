/**
 * The root landing page, same Claude/Anthropic-inspired dark editorial look as
 * verifyPage.js (warm near-black, serif headline, hairline borders), so a visitor
 * hitting the bare domain sees a real branded page instead of Express's default
 * 404. Purely informational, no captcha widget, no state.
 */
function renderHomePage({ guildCount }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Petto</title>
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
    --green: #a5ea7a;
    --green-wash: rgba(165, 234, 122, 0.12);
    --yellow: #fed53c;
    --yellow-wash: rgba(254, 213, 60, 0.12);
    --red: #fe6465;
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

  @keyframes cardIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes duckHop {
    0% { transform: translateY(0) rotate(0deg); }
    30% { transform: translateY(-10px) rotate(-6deg); }
    50% { transform: translateY(0) rotate(4deg); }
    70% { transform: translateY(-4px) rotate(-2deg); }
    100% { transform: translateY(0) rotate(0deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }
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
    margin: 0 0 30px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 10px 18px;
    border-radius: 999px;
    background: var(--green-wash);
    color: var(--green);
    font-size: 14px;
    font-weight: 500;
  }
  .status .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 3px var(--green-wash);
  }
  .links {
    margin-top: 30px;
    display: flex;
    justify-content: center;
    gap: 22px;
    font-size: 14px;
  }
  .links a { color: var(--accent); text-decoration: none; font-weight: 500; }
  .links a:hover { text-decoration: underline; }

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
    <div class="eyebrow">Petto</div>
    <h1>A duck-shaped Discord bot, keeping your server in order.</h1>
    <p class="sub">Moderation, tickets, leveling, giveaways, and more. This page is just its home base on the web, nothing to do here directly.</p>

    <div class="status"><span class="dot"></span>Online &middot; serving ${guildCount} server${guildCount === 1 ? '' : 's'}</div>

    <footer>Cloudflare &middot; Discord &middot; <b>Petto</b></footer>
  </div>
</body>
</html>`;
}

module.exports = { renderHomePage };
