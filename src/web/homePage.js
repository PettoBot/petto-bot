function renderHomePage({ guildCount }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Petto</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<style>
  :root { color-scheme:dark; --bg:#111214; --surface:#15171b; --surface-2:#191b20; --border:#2a2d35; --text:#f3f1ea; --muted:#9c968a; --dim:#6f6a62; --accent:#8399ff; --accent-soft:rgba(131,153,255,.14); --green:#a5ea7a; --green-soft:rgba(165,234,122,.14); --font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  * { box-sizing:border-box; } html,body { margin:0; min-height:100%; } body { min-height:100vh; padding:14px; background:var(--bg); color:var(--text); font:15px/1.55 var(--font); -webkit-font-smoothing:antialiased; }
  @keyframes rise { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } } @keyframes duckHop { 0% { transform:translateY(0) rotate(0); } 30% { transform:translateY(-7px) rotate(-5deg); } 55% { transform:translateY(0) rotate(3deg); } 100% { transform:translateY(0) rotate(0); } } @media (prefers-reduced-motion:reduce) { * { animation-duration:.001ms !important; animation-iteration-count:1 !important; } }
  .shell { width:min(100%,1180px); min-height:calc(100vh - 28px); margin:0 auto; display:flex; flex-direction:column; } .topbar { display:flex; align-items:center; justify-content:space-between; min-height:64px; padding:9px 12px; border:1px solid var(--border); border-radius:18px; background:rgba(17,18,20,.9); box-shadow:0 18px 50px -34px rgba(0,0,0,.8); } .brand { display:flex; align-items:center; gap:10px; color:var(--text); font-size:17px; font-weight:700; letter-spacing:-.02em; } .brand img { width:32px; height:32px; object-fit:contain; } .service { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; } .dot { width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px var(--green-soft); }
  .main { width:min(100%,760px); margin:auto; padding:58px 0 42px; animation:rise .45s cubic-bezier(.16,1,.3,1) both; } .card { padding:42px; border:1px solid var(--border); border-radius:18px; background:var(--surface); box-shadow:0 24px 64px -42px rgba(0,0,0,.8); } .intro { display:flex; align-items:flex-start; gap:18px; } .logo { width:70px; height:70px; flex:0 0 70px; padding:11px; border:1px solid var(--border); border-radius:17px; background:var(--surface-2); animation:duckHop .7s cubic-bezier(.34,1.56,.64,1) .25s both; } .logo img { width:100%; height:100%; object-fit:contain; } .eyebrow { margin:4px 0 8px; color:var(--dim); font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; } h1 { margin:0; max-width:620px; font-size:clamp(28px,5vw,45px); line-height:1.08; letter-spacing:-.045em; } .sub { max-width:620px; margin:14px 0 0; color:var(--muted); font-size:16px; }
  .status { display:inline-flex; align-items:center; gap:9px; margin-top:28px; padding:10px 14px; border:1px solid rgba(165,234,122,.25); border-radius:10px; color:var(--green); background:var(--green-soft); font-size:13px; font-weight:600; } .links { display:flex; flex-wrap:wrap; gap:9px; margin-top:24px; } .links a { padding:10px 13px; border:1px solid var(--border); border-radius:10px; color:var(--text); text-decoration:none; font-size:13px; font-weight:600; } .links a:hover { border-color:var(--accent); background:var(--accent-soft); } footer { margin-top:22px; color:var(--dim); font-size:12px; } footer b { color:var(--text); }
  @media (max-width:640px) { body { padding:8px; } .topbar { min-height:58px; border-radius:15px; } .main { padding:26px 0 18px; } .card { padding:23px 18px; border-radius:15px; } .intro { gap:13px; } .logo { width:54px; height:54px; flex-basis:54px; padding:8px; border-radius:13px; } }
</style>
</head>
<body>
  <div class="shell">
    <header class="topbar"><div class="brand"><img src="/assets/favicon.png" alt=""> <span>Petto</span></div><div class="service"><span class="dot" aria-hidden="true"></span>Discord bot online</div></header>
    <main class="main"><section class="card"><div class="intro"><div class="logo"><img src="/assets/favicon.png" alt="Petto"></div><div><div class="eyebrow">Petto for Discord</div><h1>A duck shaped bot for servers that want things under control.</h1><p class="sub">Moderation, tickets, leveling, giveaways and useful server tools in one place. This is the service home page, while the actual setup happens in Discord.</p></div></div><div class="status"><span class="dot" aria-hidden="true"></span>Online · serving ${Number(guildCount) || 0} server${Number(guildCount) === 1 ? '' : 's'}</div><nav class="links" aria-label="Petto links"><a href="https://discord.com">Open Discord</a><a href="/">Refresh status</a></nav></section><footer>Cloudflare · Discord · <b>Petto</b></footer></main>
  </div>
</body>
</html>`;
}

module.exports = { renderHomePage };
