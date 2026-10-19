// The addresses Petto points people to. The docs of Petto Code can be moved with PETTO_CODE_DOCS_URL.
const DASHBOARD_URL = 'https://petto.sbs/dash';
const SUPPORT_URL = 'https://petto.sbs/support';
// The docs of Petto (the wiki): every module, command and setting explained.
const WIKI_URL = 'https://wiki.petto.sbs';
const CODE_DOCS_URL = (process.env.PETTO_CODE_DOCS_URL || 'https://code.petto.sbs').replace(/\/+$/, '');

/** One quiet line of links, for the end of a message (a small text, nothing else). */
const helpLinksLine = (lang = require('../i18n').currentLanguage()) => require('../i18n').t(lang, 'core.links', { dashboard: DASHBOARD_URL, support: SUPPORT_URL, docs: CODE_DOCS_URL });

module.exports = { DASHBOARD_URL, SUPPORT_URL, WIKI_URL, CODE_DOCS_URL, helpLinksLine };
