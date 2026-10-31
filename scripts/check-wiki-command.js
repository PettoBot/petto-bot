// Checks !wiki: the ranking of the pages (accents, stop words, three languages, a command name first), the answers from the terms
// (exact words, the anchor of the section, the index, nothing found), the picture of a page, the 30 minute caches and their limits,
// downloads that fail, are slow or are too big, and that every card is a valid Components V2 message in en, es and pt-BR.
// Nothing touches the network: `fetch` is a fake that knows the pages of the fixtures and fails on any other address.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { Collection, MessageFlags } = require('discord.js');
const guilds = require('../src/db/guilds');
guilds.ensureGuild = async () => ({ prefixes: ['!'], prefix: '!' });
const { loadCommands } = require('../src/handlers/commandHandler');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const W = require('../src/utils/wikiSearch');
const { answer } = require('../src/utils/wikiAnswer');
const { cardFor } = require('../src/utils/wikiCards');
const { CATALOGS, LANGUAGES } = require('../src/i18n');

// ------------------------------------------------------------------------------------------------------------------ the fake web

const routes = new Map();
let calls = [];
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
globalThis.fetch = (url, { signal } = {}) => new Promise((resolve, reject) => {
  const address = String(url);
  calls.push(address);
  if (!/^https:\/\/(wiki\.petto\.sbs|petto\.sbs)\//.test(address)) return reject(new Error(`unexpected address ${address}`));
  const route = routes.get(address);
  if (!route) return resolve(new Response('not found', { status: 404 }));
  const entry = typeof route === 'function' ? route() : route;
  if (entry.hang) {
    signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
    return undefined;
  }
  if (entry.fail) return reject(new Error('offline'));
  return resolve(new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers }));
});
const set = (url, entry) => routes.set(url, typeof entry === 'string' ? { body: entry } : entry);
const callsTo = (part) => calls.filter((url) => url.includes(part)).length;
const reset = () => { routes.clear(); calls = []; skew = 0; W.resetCaches(); Object.assign(W.limits, DEFAULT_LIMITS); };
const DEFAULT_LIMITS = { ...W.limits };

// ------------------------------------------------------------------------------------------------------------------ fixtures

const WIKI = 'https://wiki.petto.sbs';
const SITE = 'https://petto.sbs';
const PAGES = [
  ['Introduction', 'overview/introduction', 'Petto is a free Discord bot for moderation, security, onboarding, community and automation.'],
  ['Getting Started', 'overview/getting-started', 'Add Petto to your server, open the dashboard and set up the first things worth turning on.'],
  ['Premium', 'overview/premium', 'Petto works fully for free; Premium gives about twice the room on modules with a limit.'],
  ['Moderation', 'moderation/moderation', 'Ban, kick, mute, warn and jail members with commands that record every sanction as a numbered case.'],
  ['Jail', 'moderation/jail', 'Take a member roles away and keep them in a private jail channel with the staff.'],
  ['Anti scam', 'moderation/anti-scam', 'Spots hijacked accounts posting the same scam in many channels and takes the messages down.'],
  ['Moderation Cases', 'concepts/cases', 'How Petto records every sanction as a numbered case per server.'],
  ['Giveaways', 'community/giveaways', 'Run giveaways with a button to enter, required roles and winners picked by Petto.'],
  ['Leveling', 'community/leveling', 'XP for messages and voice, level roles and a rank card for every member.'],
  ['Welcome', 'onboarding/welcome', 'Post a greeting in the channel you choose every time someone joins.'],
  ['Prefix', 'setup/prefix', 'Change the prefix of Petto in your server and see how slash commands relate to it.'],
  ['Config Export & Reset', 'setup/config-export', 'See every setting of your server at a glance, download it as a JSON file or reset it.'],
  ['Setting Up a Ticket System', 'guides/ticket-system-setup', 'Build a support panel step by step: post it, add categories and test it.'],
  ['Tickets', 'community/tickets', 'Private support channels opened from a button, with transcripts.'],
];
const LLMS = `# Petto\n\n## Overview\n\n${PAGES.map(([title, p, description]) => `- [${title}](${WIKI}/${p}.md): ${description}`).join('\n')}\n`;

const TITLES = { en: { moderation: 'Moderation', giveaways: 'Giveaways', welcome: 'Welcome' }, es: { moderation: 'Moderación', giveaways: 'Sorteos', welcome: 'Bienvenida' }, 'pt-BR': { moderation: 'Moderação', giveaways: 'Sorteios', welcome: 'Boas-vindas' } };
const DESCRIPTIONS = { en: 'Ban, kick, mute and warn members.', es: 'Banea, expulsa, silencia y advierte miembros.', 'pt-BR': 'Bane, expulsa, silencia e adverte membros.' };
const PREFIX = { en: '', es: 'es/', 'pt-BR': 'pt-br/' };
const INDEX_NOTE = '> ## Documentation Index\n> Fetch the complete documentation index at: https://wiki.petto.sbs/llms.txt\n> Use this file to discover all available pages before exploring further.\n\n';
const markdown = (title, description, image) => `${INDEX_NOTE}# ${title}\n\n> ${description}\n\n## Overview\n\nSome text with a [link](https://wiki.petto.sbs/setup/prefix.md#slash-commands).\n\n${image ? `![${image.alt}](${image.url})\n\nIn Discord: a caption.\n` : ''}`;
const mint = (name) => `https://mintcdn.com/wikipetto/abc/images/discord/${name}.webp?fit=max\\&auto=format\\&n=abc\\&q=85\\&s=0123`;

function legalHtml(title, sections) {
  const blocks = sections.map(({ id, h, points }, index) => {
    const n = index + 1;
    const body = points.length > 1
      ? `<ol class="legal-points" data-astro-cid-x>${points.map((p, i) => `<li data-n="${n}.${i + 1}" data-astro-cid-x>${p}</li>`).join('')}</ol>`
      : `<p data-astro-cid-x>${points[0]}</p>`;
    return `<div class="legal-block" id="${id ?? `s${n}`}" data-astro-cid-x> <h2 data-astro-cid-x><span class="legal-n" data-astro-cid-x>${n}.</span> ${h}</h2> ${body} </div>`;
  });
  return `<!DOCTYPE html><html><head><title>${title}</title><style>.legal-block{color:red} /* <div class="legal-block" id="css"><h2>CSS</h2></div> */</style>
<script>window.fake = '<div class="legal-block" id="fake"><h2><span class="legal-n">9.</span> Fake</h2><p>Never read</p></div>';</script></head>
<body><main id="top"><h1 data-astro-cid-x>${title}</h1><p class="legal-updated">Last updated</p><nav class="legal-toc"><ol><li><a href="#s1">toc</a></li></ol></nav>
${blocks.join('\n')}
<a class="legal-top" href="#top">Back to top</a></main><footer><script>alert(1)</script><!-- <div class="legal-block" id="comment"><h2>Comment</h2><p>x</p></div> --></footer></body></html>`;
}

const LEGAL = {
  en: {
    terms: ['Terms of Service', [
      { h: 'Using Petto', points: ['Petto is provided as-is, free to add to a Discord server.', 'Features can change, break, or be removed while the bot is in development.'] },
      { h: 'Eligibility', points: ['You need to meet Discord&#39;s own minimum age requirement (13, or higher where local law requires it) to use Discord, and by extension Petto.'] },
      { h: 'Acceptable use', points: ['Petto may not be used to harass, spam, or distribute illegal content.', 'It may not be used to evade a ban or a Discord Trust &amp; Safety action, for example to keep doing through the bot what a ban or a restriction stopped someone from doing.'] },
      { h: 'Termination', id: 'termination', points: ['Petto can stop working for a server that breaks these terms, with or without notice.'] },
    ]],
    privacy: ['Privacy Policy', [
      { h: 'What Petto stores', points: ['Settings of each server, and the cases of moderation.'] },
      { h: 'Removing your data', points: ['You can ask for your personal data to be deleted. Write to the support server and say which data you mean.', `${'A very long sentence about retention. '.repeat(30)}The end.`] },
    ]],
    refunds: ['Purchases and Refunds', [
      { h: 'Payments', points: ['Premium is paid through Polar.'] },
      { h: 'No refunds', points: ['Payments for Premium are not refunded.'] },
      { h: 'When we do refund', points: ['We refund a charge that was made twice, and a charge that was made by mistake.'] },
    ]],
    cookies: ['Cookie Policy', [
      { h: 'What this site actually uses', points: ['One cookie keeps you signed in to the dashboard.'] },
      { h: 'What it does not use', points: ['No tracking cookies, no analytics scripts, no advertising pixels.'] },
    ]],
  },
  es: {
    terms: ['Términos de servicio', [
      { h: 'Usar Petto', points: ['Petto se ofrece tal cual, gratis para añadir a un servidor de Discord.'] },
      { h: 'Elegibilidad', points: ['Debes cumplir la edad mínima de Discord para usar Discord y, por extensión, Petto.'] },
      { h: 'Uso aceptable', points: ['Petto no puede usarse para acosar, hacer spam ni distribuir contenido ilegal.', 'No se puede usar para evadir un baneo o una acción de Trust &amp; Safety de Discord.'] },
      { h: 'Terminación', id: 'termination', points: ['Petto puede dejar de funcionar en un servidor que incumpla estos términos.'] },
    ]],
    privacy: ['Política de privacidad', [
      { h: 'Qué guarda Petto', points: ['Los ajustes de cada servidor y los casos de moderación.'] },
      { h: 'Eliminar tus datos', points: ['Puedes pedir que se borren tus datos personales. Escribe al servidor de soporte.'] },
    ]],
    refunds: ['Compras y reembolsos', [
      { h: 'Pagos', points: ['Premium se paga a través de Polar.'] },
      { h: 'Sin reembolsos', points: ['Los pagos de Premium no se reembolsan.'] },
    ]],
    cookies: ['Política de cookies', [
      { h: 'Qué usa este sitio', points: ['Una cookie mantiene tu sesión en el panel.'] },
      { h: 'Qué no usa', points: ['Sin cookies de seguimiento ni scripts de analítica.'] },
    ]],
  },
  'pt-BR': {
    terms: ['Termos de serviço', [
      { h: 'Usar o Petto', points: ['O Petto é oferecido como está, grátis para adicionar a um servidor do Discord.'] },
      { h: 'Elegibilidade', points: ['Você precisa ter a idade mínima do Discord para usar o Discord e, por extensão, o Petto.'] },
      { h: 'Uso aceitável', points: ['O Petto não pode ser usado para assediar, fazer spam nem distribuir conteúdo ilegal.', 'Não pode ser usado para evitar um banimento ou uma ação de Trust &amp; Safety do Discord.'] },
      { h: 'Encerramento', id: 'termination', points: ['O Petto pode parar de funcionar em um servidor que descumpra estes termos.'] },
    ]],
    privacy: ['Política de privacidade', [
      { h: 'O que o Petto guarda', points: ['As configurações de cada servidor e os casos de moderação.'] },
      { h: 'Remover seus dados', points: ['Você pode pedir que seus dados pessoais sejam apagados. Escreva no servidor de suporte.'] },
    ]],
    refunds: ['Compras e reembolsos', [
      { h: 'Pagamentos', points: ['O Premium é pago pela Polar.'] },
      { h: 'Sem reembolsos', points: ['Os pagamentos do Premium não são reembolsados.'] },
    ]],
    cookies: ['Política de cookies', [
      { h: 'O que este site usa', points: ['Um cookie mantém você conectado ao painel.'] },
      { h: 'O que não usa', points: ['Sem cookies de rastreamento nem scripts de análise.'] },
    ]],
  },
};

/** The fake web with everything: the list, the pages in three languages (the Spanish Jail does not exist) and the four legal pages. */
function install() {
  reset();
  set(`${WIKI}/llms.txt`, LLMS);
  for (const lang of LANGUAGES) {
    const prefix = PREFIX[lang];
    set(`${WIKI}/${prefix}moderation/moderation.md`, markdown(TITLES[lang].moderation, DESCRIPTIONS[lang], { alt: `Staff channel (${lang}) with a \\_ mark`, url: mint(`moderation/${prefix}moderation`) }));
    set(`${WIKI}/${prefix}community/giveaways.md`, markdown(TITLES[lang].giveaways, `Giveaways in ${lang}.`, { alt: 'A giveaway card', url: mint(`community/${prefix}giveaways`) }));
    set(`${WIKI}/${prefix}onboarding/welcome.md`, markdown(TITLES[lang].welcome, `Welcome in ${lang}.`, null));
    for (const [doc, [title, sections]] of Object.entries(LEGAL[lang])) set(`${SITE}/${prefix}${doc}`, legalHtml(title, sections));
  }
  set(`${WIKI}/moderation/jail.md`, markdown('Jail', 'Jail the members.', { alt: 'Jail', url: mint('moderation/jail') }));
  set(`${WIKI}/moderation/anti-scam.md`, markdown('Anti scam', 'Takes the scam down.', { alt: 'Scam', url: 'http://insecure.example/images/x.png' }));
}

const inCard = (payload) => JSON.stringify(payload.components.map((component) => component.toJSON()));
function textsOf(payload) {
  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === 10) out.push(node.content);
    Object.values(node).forEach(walk);
    return undefined;
  }(payload.components.map((component) => component.toJSON())));
  return out.join('\n');
}
function shapeOf(payload) {
  const json = payload.components.map((component) => component.toJSON());
  const shape = { count: 0, chars: 0, buttons: [], media: [], thumbs: [], empty: 0 };
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return undefined;
    if (typeof node.type === 'number') shape.count += 1;
    if (node.type === 10) { shape.chars += node.content.length; if (!node.content.trim()) shape.empty += 1; }
    if (node.type === 2) shape.buttons.push({ label: node.label, url: node.url });
    if (node.type === 12) node.items.forEach((item) => shape.media.push(item.media.url));
    if (node.type === 11) shape.thumbs.push(node.media.url);
    Object.values(node).forEach(walk);
    return undefined;
  }(json));
  return shape;
}
function assertValid(name, payload) {
  const shape = shapeOf(payload);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2, `${name}: Components V2`);
  assert.deepEqual(payload.allowedMentions, { parse: [] }, `${name}: nobody is notified`);
  assert.ok(shape.count <= 40, `${name}: ${shape.count} components`);
  assert.ok(shape.chars <= 4000, `${name}: ${shape.chars} characters`);
  assert.ok(shape.buttons.length <= 5, `${name}: ${shape.buttons.length} buttons`);
  assert.equal(shape.empty, 0, `${name}: no empty text`);
  for (const button of shape.buttons) assert.ok(button.label.length <= 80 && /^https:\/\//.test(button.url), `${name}: a link button ${button.label}`);
  return shape;
}

// The timers of a timeout do not keep Node alive: this one does, until the end.
const keepAlive = setInterval(() => {}, 1000);
(async () => {
  // ---------------------------------------------------------------------------------------------------------------- words
  assert.deepEqual(W.wordsOf('¿Cómo BANEAR a un usuario? Términos & Condiciones'), ['como', 'banear', 'a', 'un', 'usuario', 'terminos', 'condiciones']);
  assert.deepEqual(W.tokensOf('How do I get the terms of service for Petto?'), ['term', 'service']);
  assert.deepEqual(W.tokensOf('¿Cómo puedo banear a un usuario?'), ['banear', 'usuario']);
  assert.deepEqual(W.tokensOf('Como posso silenciar um usuário?'), ['silenciar', 'usuario']);
  assert.deepEqual(W.tokensOf('Giveaways giveaway'), ['giveaway'], 'a plural is its singular, nothing twice');
  assert.deepEqual(W.tokensOf('the of a'), [], 'only stop words');
  assert.equal(W.fold('Configuración ñandú ç'), 'configuracion nandu c');
  assert.equal(W.decodeEntities('Discord&#39;s &amp; &quot;x&quot; &#x27; &nbsp;&lt;b&gt; &unknown; &#0; &#xD800; &#1114112;'), 'Discord\'s & "x" \'  <b> &unknown; &#0; &#xD800; &#1114112;');
  assert.equal(W.clip('word '.repeat(50), 40).length <= 40, true);
  assert.ok(W.clip('x'.repeat(100), 20).endsWith('…'));

  // ---------------------------------------------------------------------------------------------------------------- ranking
  const pages = W.parsePages(LLMS);
  assert.equal(pages.length, PAGES.length);
  assert.deepEqual(pages[3], { title: 'Moderation', path: 'moderation/moderation', description: PAGES[3][2] });
  const best = (query, options) => W.rankPages(pages, query, options).map((entry) => entry.page.path);
  assert.equal(best('welcome')[0], 'onboarding/welcome', 'a title word');
  assert.equal(best('bienvenida')[0], 'onboarding/welcome', 'a Spanish word finds the English page');
  assert.equal(best('sorteos')[0], 'community/giveaways');
  assert.equal(best('sorteio')[0], 'community/giveaways', 'and the Portuguese one');
  assert.equal(best('CONFIGURACIÓN')[0], 'setup/config-export', 'accents and case do not matter (and config means configuracion)');
  assert.equal(best('niveles')[0], 'community/leveling');
  assert.equal(best('ticket')[0] === 'guides/ticket-system-setup' || best('ticket')[0] === 'community/tickets', true);
  assert.equal(best('how do i set up tickets')[0].includes('ticket'), true, 'stop words do not count');
  assert.equal(best('ban', { hints: ['moderation'] })[0], 'moderation/moderation', 'a command name finds the page of its category first');
  assert.equal(best('mute')[0], 'moderation/moderation', 'a word of the description of the first lines');
  assert.deepEqual(best('xyzzy'), []);
  assert.deepEqual(best('the of and'), [], 'nothing but stop words');
  assert.ok(best('petto', { limit: 5 }).length <= 5);
  assert.equal(W.rankPages(pages, 'moderation', { limit: 1 }).length, 1);
  const manyLines = Array.from({ length: 900 }, (_, i) => `- [Page ${i}](${WIKI}/p/page-${i}.md): A page about things ${i}`).join('\n');
  assert.equal(W.parsePages(manyLines).length, W.limits.maxPages, 'the list is capped');
  assert.equal(W.parsePages('- [Bad](javascript:alert(1)): nope\n- [Ok](https://wiki.petto.sbs/a/b.md): fine').length, 1, 'only the pages of the wiki');

  // ---------------------------------------------------------------------------------------------------------------- markdown
  const md = W.parseMarkdownPage(markdown('Moderation', 'Ban, kick.', { alt: 'A staff \\_ channel', url: mint('moderation/moderation') }));
  assert.equal(md.title, 'Moderation');
  assert.equal(md.description, 'Ban, kick.', 'not the index note Mintlify puts above the title');
  assert.equal(md.image, 'https://mintcdn.com/wikipetto/abc/images/discord/moderation/moderation.webp?fit=max&auto=format&n=abc&q=85&s=0123', 'the escapes of the address are gone');
  assert.equal(md.alt, 'A staff _ channel');
  assert.equal(W.parseMarkdownPage(markdown('T', 'D', { alt: 'x', url: 'http://insecure.example/images/x.png' })).image, null, 'https only');
  assert.equal(W.parseMarkdownPage(markdown('T', 'D', { alt: 'x', url: 'https://example.com/logo.png' })).image, null, 'only the pictures of /images/');
  assert.equal(W.parseMarkdownPage('# T\n\n> D\n\n![a](https://example.com/x.png)\n\n![b](https://mintcdn.com/w/images/b.webp)').image, 'https://mintcdn.com/w/images/b.webp', 'the first picture of /images/');
  assert.equal(W.parseMarkdownPage('# Only a title').image, null);
  assert.equal(W.parseMarkdownPage('').title, null);

  // ---------------------------------------------------------------------------------------------------------------- legal html
  const parsed = W.parseLegalPage(legalHtml(LEGAL.en.terms[0], LEGAL.en.terms[1]));
  assert.equal(parsed.title, 'Terms of Service');
  assert.deepEqual(parsed.sections.map((s) => [s.id, s.n, s.heading, s.points.length]), [['s1', '1', 'Using Petto', 2], ['s2', '2', 'Eligibility', 1], ['s3', '3', 'Acceptable use', 2], ['termination', '4', 'Termination', 1]]);
  assert.equal(parsed.sections[1].points[0].text, 'You need to meet Discord\'s own minimum age requirement (13, or higher where local law requires it) to use Discord, and by extension Petto.', 'entities decoded, the words exact');
  assert.equal(parsed.sections[1].points[0].n, '2', 'a single paragraph has the number of its section');
  assert.equal(parsed.sections[2].points[1].n, '3.2');
  assert.ok(parsed.sections[2].points[1].text.includes('Trust & Safety'));
  assert.ok(!JSON.stringify(parsed).match(/fake|Never read|alert|comment|CSS/i), 'scripts, styles and comments are never read');
  const noisy = W.parseLegalPage('<div class="legal-block" id="x"><h2><span class="legal-n">1.</span> A <b>bold</b> &amp; heading</h2><ol><li data-n="1.1"><img src=x onerror=alert(1)>Text <script>alert(2)</script>after <a href="javascript:alert(3)">link</a></li></ol></div>');
  assert.deepEqual(noisy.sections[0].points[0].text, 'Text after link');
  assert.equal(noisy.sections[0].heading, 'A bold & heading');
  assert.equal(W.parseLegalPage('<html><body>nothing here</body></html>').sections.length, 0);
  const longPoint = W.parseLegalPage(legalHtml('T', LEGAL.en.privacy[1])).sections[1].points[1].text;
  assert.ok(longPoint.length <= W.limits.pointChars, 'a point is cut at ~600 characters');
  const hugeDoc = legalHtml('T', Array.from({ length: 200 }, (_, i) => ({ h: `Section ${i}`, points: Array.from({ length: 50 }, (_, j) => `Point ${j} ${'word '.repeat(80)}`) })));
  const huge = W.parseLegalPage(hugeDoc);
  assert.ok(huge.sections.length <= W.limits.maxSections && huge.sections.every((s) => s.points.length <= W.limits.maxPoints));
  assert.ok(huge.sections.reduce((n, s) => n + s.points.reduce((m, p) => m + p.text.length, 0), 0) <= W.limits.maxDocChars, 'a page keeps at most ~80 KB of text');

  // ---------------------------------------------------------------------------------------------------------------- the list: cache, TTL, stale
  install();
  assert.equal((await W.getPages()).length, PAGES.length);
  await W.getPages();
  assert.equal(callsTo('llms.txt'), 1, 'the list is read once');
  skew = 29 * 60 * 1000;
  await W.getPages();
  assert.equal(callsTo('llms.txt'), 1, 'still kept after 29 minutes');
  skew = 31 * 60 * 1000;
  await W.getPages();
  assert.equal(callsTo('llms.txt'), 2, 'read again after 30 minutes');
  set(`${WIKI}/llms.txt`, { status: 503, body: 'down' });
  skew = 70 * 60 * 1000;
  assert.equal((await W.getPages()).length, PAGES.length, 'an old list is better than none when the wiki is down');
  install();
  set(`${WIKI}/llms.txt`, { status: 500, body: 'oops' });
  await assert.rejects(W.getPages(), (error) => error instanceof W.HttpError && error.status === 500);
  await assert.rejects(W.getPages());
  assert.equal(callsTo('llms.txt'), 1, 'a failure is not asked again at once');
  skew = 60 * 1000;
  await assert.rejects(W.getPages());
  assert.equal(callsTo('llms.txt'), 2, 'but it is asked again later');

  // ---------------------------------------------------------------------------------------------------------------- download limits
  install();
  W.limits.timeoutMs = 60;
  set(`${WIKI}/llms.txt`, { hang: true });
  const started = realNow();
  await assert.rejects(W.getPages());
  assert.ok(realNow() - started < 1500, 'a page that never answers is given up on');
  install();
  W.limits.maxBytes = 1000;
  set(`${WIKI}/llms.txt`, 'x'.repeat(5000));
  await assert.rejects(W.getPages(), /Too large/);
  install();
  W.limits.maxBytes = 1000;
  set(`${WIKI}/llms.txt`, { body: 'ok', headers: { 'content-length': '999999' } });
  await assert.rejects(W.getPages(), /Too large/, 'the announced size is enough to refuse');
  install();
  set(`${WIKI}/llms.txt`, { fail: true });
  await assert.rejects(W.getPages(), /offline/);
  install();
  set(`${WIKI}/llms.txt`, 'no pages in this text');
  await assert.rejects(W.getPages(), /no pages/);

  // ---------------------------------------------------------------------------------------------------------------- the picture, in the language, kept
  install();
  const moderation = pages[3];
  const en = await W.getPageMeta(moderation, 'en');
  assert.equal(en.title, 'Moderation');
  assert.ok(en.image.includes('/images/discord/moderation/moderation.webp') && !en.image.includes('\\'));
  const es = await W.getPageMeta(moderation, 'es');
  assert.equal(es.title, 'Moderación');
  assert.ok(es.image.includes('/images/discord/moderation/es/moderation.webp'), 'the picture of the Spanish page');
  assert.equal((await W.getPageMeta(moderation, 'pt-BR')).description, 'Bane, expulsa, silencia e adverte membros.');
  const jail = await W.getPageMeta(pages[4], 'es');
  assert.equal(jail.lang, 'en', 'a page that does not exist in Spanish is the English one');
  assert.equal(await W.getPageMeta({ path: 'nope/missing', title: 'x', description: 'y' }, 'en'), null, 'a page that cannot be read has no picture');
  const before = calls.length;
  await W.getPageMeta(moderation, 'es');
  assert.equal(calls.length, before, 'kept');
  skew = 31 * 60 * 1000;
  await W.getPageMeta(moderation, 'es');
  assert.ok(calls.length > before, 'read again after 30 minutes');
  W.limits.maxMeta = 3;
  for (const page of pages.slice(0, 8)) await W.getPageMeta(page, 'en');
  assert.ok(W.cacheStats().meta <= 3, 'the pictures kept are capped');

  // ---------------------------------------------------------------------------------------------------------------- legal pages: cache, TTL, caps
  install();
  await W.getLegal('terms', 'en');
  await W.getLegal('terms', 'en');
  assert.equal(callsTo('petto.sbs/terms'), 1);
  await W.getLegal('terms', 'es');
  assert.equal(callsTo('petto.sbs/es/terms'), 1, 'each language is its own page');
  skew = 31 * 60 * 1000;
  await W.getLegal('terms', 'en');
  assert.equal(callsTo('petto.sbs/terms'), 2, 'read again after 30 minutes');
  set(`${SITE}/terms`, { status: 502, body: 'bad gateway' });
  skew = 70 * 60 * 1000;
  assert.equal((await W.getLegal('terms', 'en')).sections.length, 4, 'what was read before still stands when the site is down');
  await assert.rejects(W.getLegal('nothing', 'en'), /Unknown page/);
  install();
  W.limits.maxLegalChars = 1200;
  for (const lang of LANGUAGES) for (const doc of W.DOCS) await W.getLegal(doc, lang);
  assert.ok(W.cacheStats().legalChars <= 1200 || W.cacheStats().legal === 1, 'the text kept is capped');
  assert.ok(W.cacheStats().legal < 12, 'the oldest pages go first');
  install();
  for (const lang of LANGUAGES) for (const doc of W.DOCS) await W.getLegal(doc, lang);
  assert.ok(W.cacheStats().legalChars < 300 * 1024, 'twelve pages are far below the cap');

  // ---------------------------------------------------------------------------------------------------------------- answers
  install();
  let r = await answer('terms', 'en');
  assert.equal(r.kind, 'termsIndex');
  assert.equal(r.sections.length, 4);
  let card = cardFor(r, { lang: 'en', prefix: '!' });
  assertValid('terms index', card);
  let text = textsOf(card);
  assert.ok(text.includes('[1. Using Petto](https://petto.sbs/terms#s1)') && text.includes('[4. Termination](https://petto.sbs/terms#termination)'), 'the sections of the page, with their anchors');
  assert.deepEqual(shapeOf(card).buttons.map((b) => b.label), ['Terms', 'Privacy', 'Refunds', 'Cookies', 'Support server']);
  assert.deepEqual(shapeOf(card).buttons.map((b) => b.url), [`${SITE}/terms`, `${SITE}/privacy`, `${SITE}/refunds`, `${SITE}/cookies`, 'https://petto.sbs/support']);
  assert.equal((await answer('terms of service', 'en')).kind, 'termsIndex', 'only the name of a page: its index');
  assert.equal((await answer('Política de privacidad', 'es')).kind, 'termsIndex');
  assert.equal((await answer('termos', 'pt-BR')).kind, 'termsIndex');
  r = await answer('terms', 'es');
  card = cardFor(r, { lang: 'es', prefix: '!' });
  assert.ok(textsOf(card).includes('(https://petto.sbs/es/terms#s1)'), 'the Spanish page');
  assert.deepEqual(shapeOf(card).buttons.map((b) => b.label), ['Términos', 'Privacidad', 'Reembolsos', 'Cookies', 'Servidor de soporte']);
  assert.ok(shapeOf(card).buttons[0].url.endsWith('/es/terms'));
  card = cardFor(await answer('termos', 'pt-BR'), { lang: 'pt-BR', prefix: '!' });
  assert.deepEqual(shapeOf(card).buttons.map((b) => b.label), ['Termos', 'Privacidade', 'Reembolsos', 'Cookies', 'Servidor de suporte']);
  assert.ok(textsOf(card).includes('petto.sbs/pt-br/terms#s1'));

  // A question that names the page: the exact words of the point, the heading and the anchor of its section.
  r = await answer('terms can my server be banned', 'en');
  assert.equal(r.kind, 'terms');
  assert.equal(r.hits[0].section.heading, 'Acceptable use');
  const exact = LEGAL.en.terms[1][2].points[1].replace('&amp;', '&');
  assert.equal(r.hits[0].excerpt, exact, 'a short point is shown whole, as the page has it');
  card = cardFor(r, { lang: 'en', prefix: '!' });
  assertValid('terms answer', card);
  text = textsOf(card);
  assert.ok(text.includes(`> ${exact}`), 'quoted exactly');
  assert.ok(text.includes('(https://petto.sbs/terms#s3)'), 'a link to the section');
  assert.ok(text.includes('Terms of Service · 3.2'));
  card = cardFor(await answer('termination terms', 'en'), { lang: 'en', prefix: '!' });
  assert.ok(textsOf(card).includes('(https://petto.sbs/terms#termination)'), 'a named anchor');
  for (const [lang, query, heading, link] of [
    ['es', 'terminos pueden banear mi servidor', 'Uso aceptable', 'https://petto.sbs/es/terms#s3'],
    ['pt-BR', 'termos posso ser banido', 'Uso aceitável', 'https://petto.sbs/pt-br/terms#s3'],
    ['en', 'privacy can I delete my data', 'Removing your data', 'https://petto.sbs/privacy#s2'],
    ['es', 'privacidad puedo borrar mis datos', 'Eliminar tus datos', 'https://petto.sbs/es/privacy#s2'],
    ['pt-BR', 'privacidade posso apagar meus dados', 'Remover seus dados', 'https://petto.sbs/pt-br/privacy#s2'],
    ['en', 'can I get a refund', 'No refunds', 'https://petto.sbs/refunds#s2'],
    ['es', 'puedo pedir un reembolso', 'Sin reembolsos', 'https://petto.sbs/es/refunds#s2'],
    ['pt-BR', 'posso pedir reembolso', 'Sem reembolsos', 'https://petto.sbs/pt-br/refunds#s2'],
    ['en', 'cookies tracking', 'What it does not use', 'https://petto.sbs/cookies#s2'],
  ]) {
    const got = await answer(query, lang);
    assert.equal(got.kind, 'terms', `${lang}: ${query}`);
    assert.ok(got.hits.some((hit) => hit.section.heading === heading), `${lang}: ${query} finds ${heading}`);
    const cardText = textsOf(cardFor(got, { lang, prefix: '!' }));
    assert.ok(cardText.includes(link), `${lang}: ${query} links ${link}`);
  }
  // A long point is cut on a sentence, starting where the words of the question are, and never reworded.
  r = await answer('privacy retention', 'en');
  if (r.kind === 'terms') assert.ok(r.hits.every((hit) => hit.excerpt.length <= 385));
  const longHit = W.searchLegal([{ doc: 'privacy', ...W.parseLegalPage(legalHtml('T', LEGAL.en.privacy[1])) }], ['retention'])[0];
  assert.ok(longHit.excerpt.length <= 385 && longHit.excerpt.includes('retention'));
  assert.ok(longHit.point.text.includes(longHit.excerpt.replace(/^… /, '').replace(/ …$/, '')), 'only words of the page');
  // Without naming the page: a question about a ban, or about data.
  r = await answer('can I get banned from using Petto', 'en');
  assert.equal(r.kind, 'terms', 'a question the terms answer, though it did not name them');
  assert.equal(r.hits[0].section.heading, 'Acceptable use');
  // Nothing in the terms answers: said clearly, with the support link.
  r = await answer('terms pineapple pizza recipe', 'en');
  assert.equal(r.kind, 'termsNone');
  card = cardFor(r, { lang: 'en', prefix: '!' });
  assertValid('terms none', card);
  assert.ok(textsOf(card).includes('Nothing in **Terms of Service** answers `terms pineapple pizza recipe`') && textsOf(card).includes('https://petto.sbs/support'));
  assert.ok(textsOf(cardFor(await answer('terminos pizza hawaiana', 'es'), { lang: 'es', prefix: '!' })).includes('Nada en **Términos de servicio** responde'));
  assert.ok(textsOf(cardFor(await answer('termos pizza havaiana', 'pt-BR'), { lang: 'pt-BR', prefix: '!' })).includes('Nada em **Termos de serviço** responde'));

  // The wiki.
  r = await answer('ban', 'en', { hints: ['moderation'] });
  assert.equal(r.kind, 'wiki');
  assert.equal(r.top.page.path, 'moderation/moderation');
  assert.equal(r.top.url, `${WIKI}/moderation/moderation`);
  assert.ok(r.top.image.includes('/images/discord/moderation/moderation.webp'));
  card = cardFor(r, { lang: 'en', prefix: '!' });
  let shape = assertValid('wiki page', card);
  assert.equal(shape.media.length, 1, 'the first page has a big picture');
  assert.ok(shape.thumbs.length <= 2, 'the next pages get small ones');
  text = textsOf(card);
  assert.ok(text.includes('### [Moderation](https://wiki.petto.sbs/moderation/moderation)') && text.includes('Related pages'));
  assert.deepEqual(shape.buttons.map((b) => b.label), ['Open page', 'Wiki home', 'Terms']);
  assert.ok(r.related.length <= 4);
  const metaCalls = calls.filter((url) => url.endsWith('.md')).length;
  assert.ok(metaCalls <= 3, `only the pages shown are read for their picture (${metaCalls})`);
  // The same in Spanish: the page and the words of the page in Spanish.
  r = await answer('sorteos', 'es');
  assert.equal(r.kind, 'wiki');
  assert.equal(r.top.url, `${WIKI}/es/community/giveaways`);
  assert.equal(r.top.title, 'Sorteos');
  assert.ok(r.top.image.includes('/es/giveaways'));
  card = cardFor(r, { lang: 'es', prefix: '!' });
  assert.deepEqual(shapeOf(card).buttons.map((b) => b.label), ['Abrir página', 'Inicio de la wiki', 'Términos']);
  assert.ok(shapeOf(card).buttons[1].url === `${WIKI}/es`);
  r = await answer('jail', 'es');
  assert.equal(r.top.url, `${WIKI}/moderation/jail`, 'the page that is only in English');
  // A page whose picture cannot be loaded or has none: the card is complete anyway.
  r = await answer('welcome', 'en');
  card = cardFor(r, { lang: 'en', prefix: '!' });
  assert.equal(assertValid('no picture', card).media.length, 0);
  r = await answer('scam', 'en');
  assert.equal(r.top.image, null, 'a picture that is not https is not used');
  // Nothing matches.
  r = await answer('xyzzy plugh', 'en');
  assert.equal(r.kind, 'none');
  assert.ok(r.close.length <= 5 && r.close.length > 0);
  card = cardFor(r, { lang: 'en', prefix: '!' });
  assertValid('none', card);
  assert.ok(textsOf(card).includes('https://petto.sbs/support') && textsOf(card).includes('Nothing in the wiki matches **`xyzzy plugh`**'));
  assert.equal((await answer('', 'en')).kind, 'home');
  card = cardFor(await answer('', 'en'), { lang: 'en', prefix: '?' });
  assertValid('home', card);
  assert.ok(textsOf(card).includes('`?wiki ban`'), 'the prefix of the server in the hint');
  assert.equal((await answer('the of', 'en')).kind, 'home');
  assert.equal((await answer('x'.repeat(5000), 'en')).query.length <= 200, true);
  // The query is shown in a code span: nothing in it does anything.
  card = cardFor(await answer('xyzzy @everyone `ping` [a](https://evil.example)', 'en'), { lang: 'en', prefix: '!' });
  assert.ok(textsOf(card).includes('`xyzzy @everyone \'ping\' [a](https://evil.example)`'));
  assert.deepEqual(card.allowedMentions, { parse: [] });

  // ---------------------------------------------------------------------------------------------------------------- failures
  install();
  set(`${WIKI}/llms.txt`, { status: 500 });
  r = await answer('pineapple', 'en');
  assert.equal(r.kind, 'error');
  card = cardFor(r, { lang: 'en', prefix: '!' });
  assertValid('error', card);
  assert.ok(textsOf(card).includes('https://wiki.petto.sbs') && textsOf(card).includes('https://petto.sbs/terms') && textsOf(card).includes('https://petto.sbs/support'), 'plain links when nothing can be read');
  assert.equal((await answer('', 'en')).kind, 'error');
  install();
  set(`${SITE}/terms`, { status: 404 });
  r = await answer('terms', 'en');
  assert.equal(r.kind, 'termsError');
  card = cardFor(r, { lang: 'en', prefix: '!' });
  assertValid('terms error', card);
  assert.ok(textsOf(card).includes('https://petto.sbs/terms') && textsOf(card).includes('https://petto.sbs/support'));
  install();
  W.limits.timeoutMs = 50;
  set(`${SITE}/privacy`, { hang: true });
  r = await answer('privacy can I delete my data', 'en');
  assert.equal(r.kind, 'termsError', 'a page that does not answer in time');
  install();
  set(`${SITE}/terms`, { hang: true });
  r = await answer('can I get a refund', 'en');
  assert.equal(r.kind, 'terms', 'the terms being slow does not stop the refunds page from answering');
  install();
  for (const doc of W.DOCS) set(`${SITE}/${doc}`, { status: 500 });
  r = await answer('pineapple pizza recipe', 'en');
  assert.equal(r.kind, 'none', 'the terms cannot be read: the wiki answers as usual');
  install();
  set(`${SITE}/terms`, '<html><body>a page with no sections</body></html>');
  assert.equal((await answer('terms', 'en')).kind, 'termsError', 'a page that is not what was expected');

  // ---------------------------------------------------------------------------------------------------------------- the size of every card
  install();
  const longTitle = 'T'.repeat(300);
  const longPages = PAGES.map(([title, p]) => `- [${longTitle}](${WIKI}/${p}.md): ${'D'.repeat(2000)}`).join('\n');
  set(`${WIKI}/llms.txt`, longPages);
  set(`${WIKI}/moderation/moderation.md`, markdown(longTitle, 'D'.repeat(5000), { alt: 'A'.repeat(3000), url: mint('moderation/moderation') }));
  W.resetCaches();
  const big = await answer('moderation', 'en');
  assertValid('long titles and descriptions', cardFor(big, { lang: 'en', prefix: '!' }));
  const manySections = Array.from({ length: 60 }, (_, i) => ({ h: `A section with a rather long heading number ${i} that goes on and on`, points: ['x'.repeat(590), 'y'.repeat(590)] }));
  set(`${SITE}/terms`, legalHtml('Terms of Service', manySections));
  W.resetCaches();
  set(`${WIKI}/llms.txt`, LLMS);
  r = await answer('terms', 'en');
  assert.equal(r.sections.length, 60);
  shape = assertValid('index of 60 sections', cardFor(r, { lang: 'en', prefix: '!' }));
  const threeLong = Array.from({ length: 3 }, (_, i) => ({ h: `${'Heading '.repeat(30)}${i}`, points: [`${'refund '.repeat(120)}`] }));
  set(`${SITE}/refunds`, legalHtml('Purchases and Refunds', threeLong));
  W.resetCaches();
  set(`${WIKI}/llms.txt`, LLMS);
  r = await answer('can I get a refund', 'en');
  assert.equal(r.kind, 'terms');
  assertValid('three long passages', cardFor(r, { lang: 'en', prefix: '!' }));
  for (const lang of LANGUAGES) {
    install();
    for (const query of ['', 'ban', 'terms', 'privacy', 'refunds', 'cookies', 'terms can my server be banned', 'xyzzy', 'welcome']) {
      assertValid(`${lang} ${query || '(empty)'}`, cardFor(await answer(query, lang, { hints: query === 'ban' ? ['moderation'] : [] }), { lang, prefix: '!' }));
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- the catalogs
  for (const lang of LANGUAGES) {
    for (const key of ['utility.wiki.title', 'utility.wiki.open.button', 'utility.wiki.home.button', 'utility.wiki.terms.button', 'utility.wiki.privacy.button', 'utility.wiki.refunds.button', 'utility.wiki.cookies.button', 'utility.wiki.doc.terms', 'utility.wiki.doc.privacy', 'utility.wiki.doc.refunds', 'utility.wiki.doc.cookies', 'utility.wiki.terms.none', 'utility.wiki.error', 'utility.wiki.stuck']) {
      assert.ok(Object.hasOwn(CATALOGS[lang], key), `${lang} has ${key}`);
    }
    for (const key of Object.keys(CATALOGS[lang]).filter((k) => k.endsWith('.button') && k.startsWith('utility.wiki.'))) assert.ok(CATALOGS[lang][key].length <= 80, `${lang} ${key} fits a button`);
  }
  assert.notEqual(CATALOGS.es['utility.wiki.terms.button'], CATALOGS.en['utility.wiki.terms.button']);
  assert.notEqual(CATALOGS['pt-BR']['utility.wiki.terms.button'], CATALOGS.es['utility.wiki.terms.button']);

  // ---------------------------------------------------------------------------------------------------------------- the command, as typed with the prefix
  install();
  const client = { commands: new Collection(), user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' } };
  loadCommands(client);
  const wiki = client.commands.get('wiki');
  assert.ok(wiki && !wiki.registerSlash && !wiki.slashOnly, 'still a prefix command: no new slash command');
  const sent = [];
  const user = { id: '111111111111111111', username: 'ana', bot: false };
  const guild = { id: '222222222222222222', members: { cache: new Collection(), me: null } };
  const typed = async (argText, lang = 'en') => {
    sent.length = 0;
    const message = { id: '1', content: `!wiki ${argText}`, guild, author: user, member: { user }, client, channel: { id: '333333333333333333', send: async (p) => { sent.push(p); return {}; } }, reply: async (p) => { sent.push(p); return { edit: async () => {} }; } };
    const interaction = await buildInteractionFromMessage(message, wiki, argText);
    assert.ok(interaction, `parsed: ${argText}`);
    interaction.pettoLang = lang;
    await wiki.execute(interaction);
    assert.equal(sent.length, 1, 'one message');
    return sent[0];
  };
  let payload = await typed('terms can my server be banned');
  assertValid('prefix terms', { ...payload, components: payload.components });
  assert.ok(textsOf(payload).includes('Acceptable use'));
  payload = await typed('ban');
  assert.ok(textsOf(payload).includes('### [Moderation]'), '!wiki ban shows the moderation page first');
  payload = await typed('');
  assert.ok(textsOf(payload).includes('`!wiki terms`'));
  payload = await typed('sorteos', 'es');
  assert.ok(textsOf(payload).includes('/es/community/giveaways'));
  set(`${WIKI}/llms.txt`, { status: 500 });
  W.resetCaches();
  payload = await typed('pineapple');
  assert.ok(textsOf(payload).includes('https://petto.sbs/support'), 'the command answers with the plain links when the wiki is down');
  // A slash command (not registered today, but the same code) says an answer is coming and then fills it in.
  install();
  const slash = [];
  const interaction = {
    guild, guildId: guild.id, user, client, deferred: false, replied: false, pettoLang: 'en',
    options: { getString: () => 'welcome' },
    deferReply: async () => { slash.push('defer'); interaction.deferred = true; },
    editReply: async (p) => { slash.push(p); interaction.replied = true; },
    reply: async (p) => { slash.push(p); },
  };
  await wiki.execute(interaction);
  assert.equal(slash[0], 'defer');
  assert.ok(slash[1].components && !slash[1].flags, 'the answer fills the announced reply');
  assert.ok(callsTo('example.com') === 0);

  Date.now = realNow;
  clearInterval(keepAlive);
  console.log('wiki command checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
