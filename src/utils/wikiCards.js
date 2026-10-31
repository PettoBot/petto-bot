// The cards of !wiki (Components V2): a page with its picture, the points of the terms that answer a question, and the notices.
// All the text comes from the catalogs (`utility.wiki.*`); the words of the terms are shown exactly as the page has them.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { t } = require('../i18n');
const { SUPPORT_URL } = require('./links');
const { clip, siteUrl, wikiUrl, DOCS } = require('./wikiSearch');

// Discord allows 4000 characters of text per message across every text display; the card stays below that.
const TEXT_BUDGET = 3600;
const EXCERPT = 380;
const DESCRIPTION = 300;

/** A query shown inside a text: one line, in a code span (so no mention, link or format in it does anything). */
const label = (value) => String(value ?? '').replace(/[[\]]/g, '');
const shown = (query, limit = 120) => `\`${clip(query, limit).replace(/`/g, "'")}\``;

/** Text cut to a limit, line breaks kept (the pieces inside it were cut already; this is the last guard of the budget). */
function cut(text, limit) {
  const value = String(text ?? '').trim();
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : value;
}

class Card {
  constructor() {
    this.container = new ContainerBuilder();
    this.budget = TEXT_BUDGET;
  }

  take(text, limit) {
    const value = cut(text, Math.min(limit, Math.max(0, this.budget)));
    this.budget -= value.length;
    return value;
  }

  /** A block of text (cut to what is left of the budget, and never empty). */
  text(text, limit = 1000) {
    const value = this.take(text, limit);
    if (value) this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent(value));
    return this;
  }

  /** Text with a small picture at its side. */
  withThumbnail(text, url, description, limit = 400) {
    const value = this.take(text, limit);
    if (!value) return this;
    const thumbnail = new ThumbnailBuilder().setURL(url);
    if (description) thumbnail.setDescription(clip(description, 200));
    this.container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(value))
      .setThumbnailAccessory(thumbnail));
    return this;
  }

  picture(url, description) {
    const item = new MediaGalleryItemBuilder().setURL(url);
    if (description) item.setDescription(clip(description, 500));
    this.container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item));
    return this;
  }

  divider(big = false) {
    this.container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small));
    return this;
  }

  buttons(list) {
    const links = list.filter((button) => button?.url).slice(0, 5);
    if (links.length) {
      this.container.addActionRowComponents(new ActionRowBuilder().addComponents(links.map((button) => new ButtonBuilder().setLabel(clip(button.label, 80)).setStyle(ButtonStyle.Link).setURL(button.url))));
    }
    return this;
  }

  payload() {
    return { components: [this.container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  }
}

const supportLink = (lang) => `[${t(lang, 'core.join.support.button')}](${SUPPORT_URL})`;
const docName = (lang, doc) => t(lang, `utility.wiki.doc.${doc}`);
const footer = (lang, prefix) => `-# ${t(lang, 'utility.wiki.footer', { prefix })}`;

/** The four link buttons to the pages of the website, then the support server. */
function legalButtons(lang) {
  return [
    ...DOCS.map((doc) => ({ label: t(lang, `utility.wiki.${doc}.button`), url: siteUrl(doc, lang) })),
    { label: t(lang, 'core.join.support.button'), url: SUPPORT_URL },
  ];
}

const bullet = (item, lang) => {
  const description = item.description ? ` · ${clip(item.description, lang === 'en' ? 90 : 110)}` : '';
  return `- **[${label(clip(item.title, 70))}](${item.url})**${description}`;
};

/** A page (and the pages next to it), or the start of the wiki. */
function pageCard(result, { lang, prefix }) {
  const card = new Card();
  const { top, related } = result;
  const intro = result.kind === 'home' ? `\n${t(lang, 'utility.wiki.tryLine', { prefix })}` : '';
  card.text(`### [${label(clip(top.title, 150))}](${top.url})${top.description ? `\n${clip(top.description, DESCRIPTION)}` : ''}${intro}`, 900);
  // The big picture of the first page; when it cannot be loaded Discord leaves it out and the card is just as complete.
  if (top.image) card.picture(top.image, top.imageAlt || top.title);

  if (related.length) {
    card.divider(true).text(`**${t(lang, 'utility.wiki.related')}**`, 120);
    let plain = [];
    const flush = () => {
      if (plain.length) card.text(plain.join('\n'), 900);
      plain = [];
    };
    for (const item of related) {
      if (item.image) {
        flush();
        card.withThumbnail(bullet(item, lang), item.image, item.imageAlt || item.title, 420);
      } else {
        plain.push(bullet(item, lang));
      }
    }
    flush();
  }
  card.divider().text(footer(lang, prefix), 300);
  card.buttons([
    { label: t(lang, 'utility.wiki.open.button'), url: top.url },
    { label: t(lang, 'utility.wiki.home.button'), url: wikiUrl('', lang) },
    { label: t(lang, 'utility.wiki.terms.button'), url: siteUrl('terms', lang) },
  ]);
  return card.payload();
}

/** The points of the terms that answer a question: the heading of the section, its exact words and a link to the section. */
function termsCard(result, { lang, prefix }) {
  const card = new Card();
  const docs = [...new Set(result.hits.map((hit) => hit.doc))];
  card.text(`### ${docs.length === 1 ? docName(lang, docs[0]) : t(lang, 'utility.wiki.terms.heading')}\n-# ${t(lang, 'utility.wiki.terms.quote')}`, 400);
  for (const hit of result.hits) {
    const { doc, section, point } = hit;
    const heading = `${section.n ? `${section.n}. ` : ''}${section.heading}`;
    const link = siteUrl(doc, lang, section.id);
    const meta = t(lang, 'utility.wiki.terms.point', { doc: docName(lang, doc), number: point.n ?? section.n ?? '' }).replace(/\s*$/, '');
    const excerpt = hit.excerpt ?? clip(point.text, EXCERPT);
    card.divider().text(`**[${label(clip(heading, 120))}](${link})**\n-# ${meta}\n> ${excerpt}`, 760);
  }
  if (result.partial) card.text(`-# ${t(lang, 'utility.wiki.partial')}`, 200);
  if (result.related) card.divider().text(t(lang, 'utility.wiki.alsoWiki', { title: label(clip(result.related.title, 80)), url: result.related.url }), 250);
  card.divider().text(footer(lang, prefix), 300);
  card.buttons(legalButtons(lang));
  return card.payload();
}

/** The index of a page (the command with only the name of the page): its sections, each linked to its anchor. */
function termsIndexCard(result, { lang, prefix }) {
  const card = new Card();
  const { doc, sections } = result;
  card.text(`### [${docName(lang, doc)}](${siteUrl(doc, lang)})\n${t(lang, 'utility.wiki.terms.index', { count: sections.length })}`, 600);
  card.divider();
  const lines = sections.map((section) => {
    const name = label(`${section.n ? `${section.n}. ` : ''}${clip(section.heading, 80)}`);
    return section.id ? `[${name}](${siteUrl(doc, lang, section.id)})` : name;
  });
  // The list is cut on a whole line.
  let text = '';
  for (const line of lines) {
    if (text.length + line.length + 1 > Math.min(card.budget - 500, 2400)) break;
    text += `${text ? '\n' : ''}${line}`;
  }
  card.text(text, 2400);
  card.text(`-# ${t(lang, 'utility.wiki.terms.example', { prefix, example: t(lang, `utility.wiki.example.${doc}`) })}`, 300);
  card.divider().text(footer(lang, prefix), 300);
  card.buttons(legalButtons(lang));
  return card.payload();
}

function termsNoneCard(result, { lang, prefix }) {
  const card = new Card();
  const doc = result.docs[0];
  card.text(`### ${result.docs.length === 1 ? docName(lang, doc) : t(lang, 'utility.wiki.terms.heading')}\n${t(lang, 'utility.wiki.terms.none', {
    doc: result.docs.length === 1 ? docName(lang, doc) : t(lang, 'utility.wiki.terms.heading'),
    query: shown(result.query),
    url: siteUrl(doc, lang),
    support: supportLink(lang),
  })}`, 900);
  card.divider().text(footer(lang, prefix), 300);
  card.buttons(legalButtons(lang));
  return card.payload();
}

function termsErrorCard(result, { lang }) {
  const card = new Card();
  const doc = result.docs[0];
  card.text(`### ${docName(lang, doc)}\n${t(lang, 'utility.wiki.terms.error', { doc: docName(lang, doc), url: siteUrl(doc, lang), support: supportLink(lang) })}`, 700);
  card.buttons(legalButtons(lang));
  return card.payload();
}

/** Nothing matches: the closest pages and the support server. */
function noneCard(result, { lang, prefix }) {
  const card = new Card();
  const key = result.guess ? 'utility.wiki.noMatchClose' : 'utility.wiki.noMatchStart';
  card.text(`### ${t(lang, 'utility.wiki.title')}\n${t(lang, key, { query: shown(result.query) })}`, 500);
  card.text(result.close.slice(0, 5).map((item) => bullet(item, lang)).join('\n'), 1200);
  card.divider().text(t(lang, 'utility.wiki.stuck', { support: supportLink(lang) }), 300);
  card.text(footer(lang, prefix), 300);
  card.buttons([
    { label: t(lang, 'utility.wiki.home.button'), url: wikiUrl('', lang) },
    { label: t(lang, 'utility.wiki.terms.button'), url: siteUrl('terms', lang) },
    { label: t(lang, 'core.join.support.button'), url: SUPPORT_URL },
  ]);
  return card.payload();
}

/** The wiki cannot be read: the plain links. */
function errorCard(result, { lang }) {
  const card = new Card();
  card.text(`### ${t(lang, 'utility.wiki.title')}\n${t(lang, 'utility.wiki.error', { wiki: wikiUrl('', lang), terms: siteUrl('terms', lang), support: supportLink(lang) })}`, 700);
  card.buttons([
    { label: t(lang, 'utility.wiki.home.button'), url: wikiUrl('', lang) },
    { label: t(lang, 'utility.wiki.terms.button'), url: siteUrl('terms', lang) },
    { label: t(lang, 'core.join.support.button'), url: SUPPORT_URL },
  ]);
  return card.payload();
}

/** The message for what `answer()` decided. */
function cardFor(result, options) {
  switch (result.kind) {
    case 'wiki':
    case 'home': return pageCard(result, options);
    case 'terms': return termsCard(result, options);
    case 'termsIndex': return termsIndexCard(result, options);
    case 'termsNone': return termsNoneCard(result, options);
    case 'termsError': return termsErrorCard(result, options);
    case 'none': return noneCard(result, options);
    default: return errorCard(result, options);
  }
}

module.exports = { cardFor, pageCard, termsCard, termsIndexCard, termsNoneCard, termsErrorCard, noneCard, errorCard, TEXT_BUDGET };
