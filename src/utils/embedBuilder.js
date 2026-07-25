const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolve } = require('./embedVariables');

function parseColor(input) {
  const hex = input.replace('#', '');
  const num = parseInt(hex, 16);
  if (Number.isNaN(num) || hex.length > 6) throw new Error(`Invalid color \`${input}\`. Use hex like \`#ff91c2\`.`);
  return num;
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

/**
 * Templates saved by the older /embed command (and anything not yet touched by the dashboard's
 * multi-embed builder) store one embed's fields directly at the top level of `data`. The
 * dashboard's builder instead stores `{ content, embeds: [...], buttons: [[...]] }`. Both shapes
 * are read here so neither format ever breaks the other.
 */
function normalize(data) {
  if (Array.isArray(data.embeds)) return { content: data.content ?? '', embeds: data.embeds, buttons: data.buttons ?? [] };
  const looksLikeEmbed = data.title || data.description || data.author?.name || data.footer?.text || data.fields?.length || data.image || data.thumbnail || data.color != null;
  return { content: '', embeds: looksLikeEmbed ? [data] : [], buttons: [] };
}

async function buildOneEmbed(e, ctx) {
  const embed = new EmbedBuilder();

  if (e.title) embed.setTitle(await resolve(e.title, ctx));
  if (e.description) embed.setDescription(await resolve(e.description, ctx));
  if (e.color != null) embed.setColor(e.color);
  if (e.url) {
    const u = validUrl(await resolve(e.url, ctx));
    if (u) embed.setURL(u);
  }
  if (e.thumbnail) {
    const u = validUrl(await resolve(e.thumbnail, ctx));
    if (u) embed.setThumbnail(u);
  }
  if (e.image) {
    const u = validUrl(await resolve(e.image, ctx));
    if (u) embed.setImage(u);
  }
  if (e.timestamp) embed.setTimestamp();

  if (e.author?.name) {
    const iconURL = e.author.icon ? validUrl(await resolve(e.author.icon, ctx)) : undefined;
    embed.setAuthor({ name: await resolve(e.author.name, ctx), iconURL, url: e.author.url ?? undefined });
  }

  if (e.footer?.text) {
    const iconURL = e.footer.icon ? validUrl(await resolve(e.footer.icon, ctx)) : undefined;
    embed.setFooter({ text: await resolve(e.footer.text, ctx), iconURL });
  }

  for (const f of e.fields ?? []) {
    embed.addFields({ name: await resolve(f.name, ctx), value: await resolve(f.value, ctx), inline: f.inline ?? false });
  }

  return embed;
}

function buildButtonRows(buttons) {
  return (buttons ?? [])
    .map((row) => {
      const btns = (row ?? []).filter((b) => b.label?.trim() && validUrl(b.url));
      if (!btns.length) return null;
      return new ActionRowBuilder().addComponents(
        btns.map((b) => new ButtonBuilder().setLabel(b.label).setURL(b.url).setStyle(ButtonStyle.Link).setDisabled(Boolean(b.disabled))),
      );
    })
    .filter(Boolean);
}

/**
 * Builds a real send payload from a saved template's `data`, resolving variables against ctx.
 * Returns `{ content, embeds, components }`, ready to spread into a `.send()`/`.reply()` call.
 */
async function build(data, ctx = {}) {
  const { content, embeds, buttons } = normalize(data);
  const builtEmbeds = await Promise.all(embeds.slice(0, 10).map((e) => buildOneEmbed(e, ctx)));
  return {
    content: content ? await resolve(content, ctx) : undefined,
    embeds: builtEmbeds,
    components: buildButtonRows(buttons),
  };
}

/** Cheap, non-variable-resolved preview — used by the panel so it doesn't need a real guild/member ctx to render live. */
function buildRawPreview(data) {
  const { embeds } = normalize(data);
  const e = embeds[0] ?? {};
  const embed = new EmbedBuilder().setColor(e.color ?? 0x8399ff);
  if (e.title) embed.setTitle(e.title);
  if (e.description) embed.setDescription(e.description);
  if (e.url) embed.setURL(e.url);
  if (e.timestamp) embed.setTimestamp();
  if (e.thumbnail && !e.thumbnail.includes('{')) embed.setThumbnail(e.thumbnail);
  if (e.image && !e.image.includes('{')) embed.setImage(e.image);
  if (e.author?.name) {
    embed.setAuthor({
      name: e.author.name,
      iconURL: e.author.icon && !e.author.icon.includes('{') ? e.author.icon : undefined,
      url: e.author.url ?? undefined,
    });
  }
  if (e.footer?.text) {
    embed.setFooter({ text: e.footer.text, iconURL: e.footer.icon && !e.footer.icon.includes('{') ? e.footer.icon : undefined });
  }
  if (e.fields?.length) embed.addFields(e.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
  return embed;
}

function hasContent(data) {
  const { content, embeds, buttons } = normalize(data);
  const e = embeds[0] ?? {};
  return !!(content || e.title || e.description || e.author?.name || e.footer?.text || e.fields?.length || buttons.length);
}

module.exports = { parseColor, validUrl, build, buildRawPreview, hasContent };
