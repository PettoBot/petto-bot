// The addresses Petto points people to. The docs of Petto Code can be moved with PETTO_CODE_DOCS_URL.
const DASHBOARD_URL = 'https://petto.sbs/dash';
const SUPPORT_URL = 'https://petto.sbs/support';
const CODE_DOCS_URL = (process.env.PETTO_CODE_DOCS_URL || 'https://code.petto.sbs').replace(/\/+$/, '');

/** One quiet line of links, for the end of a message (a small text, nothing else). */
const helpLinksLine = () => `-# [Dashboard](${DASHBOARD_URL}) · [Support server](${SUPPORT_URL}) · [Petto Code docs](${CODE_DOCS_URL})`;

module.exports = { DASHBOARD_URL, SUPPORT_URL, CODE_DOCS_URL, helpLinksLine };
