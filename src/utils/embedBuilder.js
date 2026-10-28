const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolve } = require('./embedVariables');
const { renderCardForMessage, normalizeCardRef, CARD_FILE_NAME } = require('./cardService');
const { pullImgCards } = require('./imgCardTokens');
const { isV2, buildV2, hasV2Content, TYPES, LIMITS } = require('./embedV2');
const { t, currentLanguage } = require('../i18n');
const { encodeActions, STYLES } = require('./embedActions');

function parseColor(input, lang = currentLanguage()) {
  const hex = input.replace('#', '');
  const num = parseInt(hex, 16);
  if (Number.isNaN(num) || hex.length > 6) throw new Error(t(lang, 'embeds.builder.badColor', { color: input }));
  return num;
}

/** A picture of an embed: a link, or a file the sender attached to this message (`attachment://name`, only when the sender listed it in `ctx.attachmentNames`). */
function mediaUrl(value, ctx) {
  const own = /^attachment:\/\/([\w.-]{1,80})$/.exec(String(value ?? '').trim());
  if (own) return ctx?.attachmentNames?.has(own[1]) ? `attachment://${own[1]}` : undefined;
  return validUrl(value);
}

function validUrl(url) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

function booleanValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled', ''].includes(normalized)) return false;
  }
  return fallback;
}

/** Accepts both the editor's URL string and Discord's serialized `{ url }` shape. */
function urlValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return textValue(value.url);
  return '';
}

function normalizeAuthor(author) {
  if (!author || typeof author !== 'object') return null;
  const name = textValue(author.name);
  if (!name) return null;
  return {
    name,
    icon: textValue(author.icon ?? author.icon_url),
    url: textValue(author.url),
  };
}

function normalizeFooter(footer) {
  if (!footer || typeof footer !== 'object') return null;
  const text = textValue(footer.text);
  if (!text) return null;
  return {
    text,
    icon: textValue(footer.icon ?? footer.icon_url),
  };
}

/**
 * Templates saved by the older /embed command (and anything not yet touched by the dashboard's
 * multi-embed builder) store one embed's fields directly at the top level of `data`. The
 * dashboard's builder instead stores `{ content, embeds: [...], buttons: [[...]] }`. Both shapes
 * are read here so neither format ever breaks the other.
 */
function normalize(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { content: '', embeds: [], buttons: [], card: null };
  const card = normalizeCardRef(data.card);
  if (Array.isArray(data.embeds)) return { content: textValue(data.content), embeds: data.embeds.filter((embed) => embed && typeof embed === 'object'), buttons: Array.isArray(data.buttons) ? data.buttons : [], card };
  const looksLikeEmbed = data.title || data.description || data.author?.name || data.footer?.text || data.fields?.length || data.image || data.thumbnail || data.color != null;
  return { content: '', embeds: looksLikeEmbed ? [data] : [], buttons: [], card };
}

async function buildOneEmbed(e, ctx) {
  const embed = new EmbedBuilder();

  const title = textValue(e.title);
  const description = textValue(e.description);
  const url = urlValue(e.url);
  const thumbnail = urlValue(e.thumbnail);
  const image = urlValue(e.image);
  const author = normalizeAuthor(e.author);
  const footer = normalizeFooter(e.footer);

  if (title) {
    const resolvedTitle = await resolve(title, ctx);
    if (resolvedTitle) embed.setTitle(resolvedTitle);
  }
  if (description) {
    const resolvedDescription = await resolve(description, ctx);
    if (resolvedDescription) embed.setDescription(resolvedDescription);
  }
  if (e.color !== null && e.color !== undefined && e.color !== '') embed.setColor(e.color);
  if (url) {
    const u = validUrl(await resolve(url, ctx));
    if (u) embed.setURL(u);
  }
  if (thumbnail) {
    const u = mediaUrl(await resolve(thumbnail, ctx), ctx);
    if (u) embed.setThumbnail(u);
  }
  if (image) {
    const u = mediaUrl(await resolve(image, ctx), ctx);
    if (u) embed.setImage(u);
  }
  if (booleanValue(e.timestamp)) embed.setTimestamp();

  if (author) {
    const iconURL = author.icon ? validUrl(await resolve(author.icon, ctx)) : undefined;
    const authorUrl = author.url ? validUrl(await resolve(author.url, ctx)) : undefined;
    const authorName = await resolve(author.name, ctx);
    if (authorName) embed.setAuthor({ name: authorName, iconURL, url: authorUrl });
  }

  if (footer) {
    const iconURL = footer.icon ? validUrl(await resolve(footer.icon, ctx)) : undefined;
    const footerText = await resolve(footer.text, ctx);
    if (footerText) embed.setFooter({ text: footerText, iconURL });
  }

  for (const [index, f] of (Array.isArray(e.fields) ? e.fields : []).entries()) {
    if (!f || typeof f !== 'object') continue;
    const name = textValue(f.name);
    const value = textValue(f.value);
    // Discord rejects fields without both values. Old templates could contain an
    // unfinished field from the editor, so ignore that invalid row instead of
    // failing the whole message with a generic CombinedPropertyError.
    if (!name || !value) continue;
    try {
      const resolvedName = await resolve(name, ctx);
      const resolvedValue = await resolve(value, ctx);
      if (!resolvedName || !resolvedValue) continue;
      embed.addFields({ name: resolvedName, value: resolvedValue, inline: booleanValue(f.inline) });
    } catch (error) {
      throw new Error(t(ctx.lang ?? currentLanguage(), 'embeds.builder.badField', { number: index + 1, error: error.message }), { cause: error });
    }
  }

  return embed;
}

/**
 * The rows of buttons of a message. A button with a `url` is a link; one with `actions` (give or take a role, answer with a
 * saved embed) is a coloured button that the bot answers when it is clicked, so it needs the server in `guild`.
 */
function buildButtonRows(buttons, guild = null) {
  let index = 0;
  return (buttons ?? [])
    .map((row) => {
      const built = (Array.isArray(row) ? row : []).map((b) => {
        const label = b ? textValue(b.label).trim() : '';
        if (!label) return null;
        const button = new ButtonBuilder().setLabel(label).setDisabled(booleanValue(b.disabled));
        if (Array.isArray(b.actions) && b.actions.length) {
          const customId = encodeActions(b.actions, guild, index++);
          if (!customId) return null;
          button.setCustomId(customId).setStyle(STYLES[String(b.style ?? '').toLowerCase()] ?? ButtonStyle.Secondary);
        } else {
          const url = validUrl(urlValue(b.url));
          if (!url) return null;
          button.setURL(url).setStyle(ButtonStyle.Link);
        }
        const emoji = textValue(b.emoji).trim();
        if (emoji) button.setEmoji(emoji);
        return button;
      }).filter(Boolean).slice(0, 5);
      return built.length ? new ActionRowBuilder().addComponents(built) : null;
    })
    .filter(Boolean)
    .slice(0, 5);
}

/** Turns Discord.js' nested validation errors into a short, useful message. */
function formatEmbedError(error, lang = currentLanguage()) {
  const messages = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    // i18n-ignore: the message discord.js gives a list of errors, matched to skip it
    if (typeof value.message === 'string' && value.message !== 'Received one or more errors') messages.push(value.message);
    if (Array.isArray(value.errors)) {
      for (const entry of value.errors) {
        if (Array.isArray(entry)) visit(entry[1]);
        else visit(entry);
      }
    }
    if (value.cause) visit(value.cause);
  };
  visit(error);
  return [...new Set(messages)].slice(0, 3).join('; ') || error?.message || t(lang, 'embeds.builder.unknownError');
}

/** Puts the picture of a card into the components of a V2 message (it counts as one component of the 40 a message can have). */
function placeCardInV2(components, card) {
  const gallery = { type: TYPES.GALLERY, items: [{ media: { url: `attachment://${CARD_FILE_NAME}` } }] };
  const countAll = (nodes) => nodes.reduce((total, node) => total + 1 + countAll(Array.isArray(node?.components) ? node.components : []) + (node?.accessory ? 1 : 0), 0);
  if (countAll(components) >= LIMITS.components) return;
  const first = components[0];
  if (card.placement !== 'attachment' && first?.type === TYPES.CONTAINER) first.components = [gallery, ...first.components];
  else components.unshift(gallery);
}

/**
 * Builds a real send payload from a saved template's `data`, resolving variables against ctx.
 * Returns `{ content, embeds, components }`, ready to spread into a `.send()`/`.reply()` call.
 */
/**
 * Builds the message of a template: its text, embeds and link buttons, and the image card when the template points at
 * one. A card is drawn for the member and the server in `ctx` and comes back in `files`. Whoever sends the payload has
 * to send `files` with it. The card goes inside the first embed when there is one (`placement` of `default` or
 * `embed`) and replaces its image, and it is attached on its own otherwise or when `placement` is `attachment`.
 */
async function build(data, ctx = {}) {
  // {imgcard:name} anywhere in the message asks for that card, unless the saved design already points at one.
  const pulled = pullImgCards(data);
  if (pulled.card) data = { ...pulled.data, card: pulled.data?.card?.name ? pulled.data.card : pulled.card };
  // A Components V2 message cannot have text or embeds and needs its own flag, so only the senders that pass `allowV2`
  // get it. Anywhere else it gives an empty message, and the sender goes on with its usual one.
  if (isV2(data)) {
    if (!ctx.allowV2) return { content: undefined, embeds: [], components: [], files: [] };
    const { components, flags } = await buildV2(data.v2, ctx, ctx.v2Extras);
    const files = [];
    // An image card can go in a V2 design too: a picture at the top of the first container, or on its own above everything.
    const card = normalizeCardRef(data.card);
    if (card) {
      const picture = await renderCardForMessage(card, ctx);
      if (picture) {
        files.push({ attachment: picture.buffer, name: picture.name });
        placeCardInV2(components, card);
      }
    }
    return { content: undefined, embeds: [], components, files, flags };
  }
  const { content, embeds, buttons, card } = normalize(data);
  const builtEmbeds = await Promise.all(embeds.slice(0, 10).map((e) => buildOneEmbed(e, ctx)));
  const files = [];
  if (card) {
    const picture = await renderCardForMessage(card, ctx);
    if (picture) {
      files.push({ attachment: picture.buffer, name: picture.name });
      if (card.placement !== 'attachment' && builtEmbeds.length) builtEmbeds[0].setImage(`attachment://${CARD_FILE_NAME}`);
    }
  }
  return {
    content: content ? await resolve(content, ctx) : undefined,
    embeds: builtEmbeds,
    components: buildButtonRows(buttons, ctx.guild),
    files,
  };
}

/** Cheap, non-variable-resolved preview — used by the panel so it doesn't need a real guild/member ctx to render live. */
function buildRawPreview(data) {
  const { embeds } = normalize(data);
  const e = embeds[0] ?? {};
  const title = textValue(e.title);
  const description = textValue(e.description);
  const url = urlValue(e.url);
  const thumbnail = urlValue(e.thumbnail);
  const image = urlValue(e.image);
  const author = normalizeAuthor(e.author);
  const footer = normalizeFooter(e.footer);
  const color = e.color === null || e.color === undefined || e.color === '' ? 0x4b4f59 : e.color;
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (validUrl(url)) embed.setURL(url);
  if (booleanValue(e.timestamp)) embed.setTimestamp();
  if (validUrl(thumbnail) && !thumbnail.includes('{')) embed.setThumbnail(thumbnail);
  if (validUrl(image) && !image.includes('{')) embed.setImage(image);
  if (author) {
    embed.setAuthor({
      name: author.name,
      iconURL: validUrl(author.icon) && !author.icon.includes('{') ? author.icon : undefined,
      url: validUrl(author.url) && !author.url.includes('{') ? author.url : undefined,
    });
  }
  if (footer) {
    embed.setFooter({ text: footer.text, iconURL: validUrl(footer.icon) && !footer.icon.includes('{') ? footer.icon : undefined });
  }
  const fields = (Array.isArray(e.fields) ? e.fields : [])
    .map((field) => ({ name: textValue(field?.name), value: textValue(field?.value), inline: booleanValue(field?.inline) }))
    .filter((field) => field.name && field.value);
  if (fields.length) embed.addFields(fields.slice(0, 25));
  return embed;
}

function hasContent(data) {
  if (isV2(data)) return hasV2Content(data);
  const { content, embeds, buttons, card } = normalize(data);
  const e = embeds[0] ?? {};
  const hasValidField = Array.isArray(e.fields) && e.fields.some((field) => textValue(field?.name) && textValue(field?.value));
  return !!(content || e.title || e.description || e.author?.name || e.footer?.text || hasValidField || card || buttons.some((row) => Array.isArray(row) && row.length));
}

function hasSendablePayload(payload) {
  return Boolean(payload && (payload.content?.trim() || payload.embeds?.length || payload.components?.length || payload.files?.length));
}

module.exports = { parseColor, validUrl, build, buildRawPreview, hasContent, hasSendablePayload, formatEmbedError };
