// POST /internal/guild-language with `{ "guildId": "<server id>", "language": "en" | "es" | "pt-BR" }`: the dashboard saves
// `guilds.language` itself, then tells the bot so the new language is used at once instead of when the 5 minute cache runs out.
// Protected like the other dashboard routes, with the `x-petto-dashboard-key` header. It writes nothing to the database: it refreshes
// the cache, then `onChange` (the bot redraws the panels it posted in that server, see src/utils/panelRefresh.js) runs after the answer.
const { LANGUAGES, setCachedGuildLanguage } = require('../i18n');

function registerGuildLanguageRoute(app, { isAuthorized, limiter, onChange = null }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/internal/guild-language', ...middleware, (req, res) => {
    if (!isAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const guildId = typeof req.body?.guildId === 'string' ? req.body.guildId : '';
    const language = req.body?.language;
    if (!/^\d{15,25}$/.test(guildId)) {
      res.status(400).json({ ok: false, error: 'invalid_guild' });
      return;
    }
    // Exactly one of the codes the database keeps; "pt", "ES" or "spanish" are refused so the dashboard and the bot never disagree.
    if (typeof language !== 'string' || !LANGUAGES.includes(language)) {
      res.status(400).json({ ok: false, error: 'invalid_language', languages: LANGUAGES });
      return;
    }
    setCachedGuildLanguage(guildId, language);
    res.json({ ok: true, guildId, language });
    if (onChange) Promise.resolve().then(() => onChange(guildId, language)).catch(() => {});
  });
}

module.exports = { registerGuildLanguageRoute };
