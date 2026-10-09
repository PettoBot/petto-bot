// The messages of Vanity and Server Tag rules as Components V2 designs (the saved shape of the Embeds editor):
//  - the default thank-you messages and log entries, with the member's picture, Petto's emoji and the variables of the rule;
//  - the conversion of a message of the old Vanity bot (one flat embed with link buttons) into the same kind of design, so what
//    a server wrote keeps its words, colors, pictures, fields and buttons and gets a header with a picture, clean sections
//    and a small footer instead of a plain embed.
const { EMOJI } = require('../emojis');

const T = { ROW: 1, BUTTON: 2, SECTION: 9, TEXT: 10, THUMBNAIL: 11, GALLERY: 12, SEPARATOR: 14, CONTAINER: 17 };
const PINK = 0xf0a9c4;
const GREEN = 0xa5ea7a;
const RED = 0xfe6465;
const AVATAR = '{user.display_avatar}';

const text = (content) => ({ type: T.TEXT, content });
const separator = (divider = true, spacing = 1) => ({ type: T.SEPARATOR, divider, spacing });
const thumbnail = (url) => ({ type: T.THUMBNAIL, media: { url } });
const section = (lines, url) => ({ type: T.SECTION, components: lines.map(text), accessory: thumbnail(url) });
const container = (accent, children) => ({ type: T.CONTAINER, ...(accent === null ? {} : { accent_color: accent }), components: children });

/** The thank-you message of a source (`vanity` or `guildtag`). */
function thanksDesign(kind) {
  const tag = kind === 'guildtag';
  return {
    components: [container(PINK, [
      section([
        tag ? '## gracias por usar el tag ♡' : '## gracias por usar el vanity ♡',
        tag ? '{user.mention}, ahora tienes {tag.role}' : '{user.mention}, ahora tienes {vanity.role}',
      ], AVATAR),
      separator(),
      text(tag ? '**Server Tag** `{tag}`\n-# regla · {tag.rule}' : '**Vanity** `{vanity.word}`\n-# regla · {vanity.rule}'),
    ])],
  };
}

/** One entry of the log of role changes: `vanity_add`, `vanity_remove`, `tag_add`, `tag_remove` or `error`. */
function logDesign(key) {
  if (key === 'error') {
    return {
      components: [container(RED, [
        section([`### ${EMOJI.DENY} Could not {rule.action_text} the role`, '{user.mention} · {rule.role}'], AVATAR),
        separator(),
        text('**Rule** {rule.name}\n**Error** `{rule.error}`\n-# {rule.reason}'),
      ])],
    };
  }
  const tag = key.startsWith('tag');
  const remove = key.endsWith('remove');
  const title = tag ? 'Server Tag Action' : 'Vanity Action';
  const role = tag ? '{tag.role}' : '{vanity.role}';
  return {
    components: [container(remove ? RED : GREEN, [
      section([
        `### ${remove ? EMOJI.DENY : EMOJI.APPROVE} ${title}`,
        `${remove ? 'Removed' : 'Added'} role ${role} ${remove ? 'from' : 'to'} {user.mention}`,
      ], AVATAR),
      separator(),
      text(tag ? '**Tag** `{tag}`\n**Why** {rule.reason}\n-# rule · {tag.rule}' : '**Word** `{vanity.word}`\n**Matched** `{vanity.value}`\n-# rule · {vanity.rule}'),
    ])],
  };
}

const LOG_TITLES = new Set(['Vanity Action', 'Server Tag Action', '{rule.event_title}', '{event.title}']);

/**
 * A message of the old Vanity bot as a V2 design. `data` is in the shape of Petto's classic templates
 * (`{ content, embeds: [embed], buttons }`). Messages that are still the ones the old bot made by itself
 * (named like its defaults and with their words) become the polished designs above.
 */
function toV2(name, data) {
  const embed = data.embeds?.[0] ?? null;
  const key = /^notify_(vanity_add|vanity_remove|tag_add|tag_remove|error)$/.exec(name)?.[1];
  if (embed && name === 'vanity_notify' && /gracias por usar el vanity/i.test(embed.description ?? '')) return thanksDesign('vanity');
  if (embed && name === 'guildtag_notify' && /gracias por usar el tag/i.test(embed.description ?? '')) return thanksDesign('guildtag');
  if (embed && key && LOG_TITLES.has(embed.title ?? '')) return logDesign(key);

  const children = [];
  if (data.content?.trim()) children.push(text(data.content.trim()));
  if (!embed) {
    const rows = buttonRows(data.buttons);
    return { components: [...children, ...(rows.length ? [container(null, rows)] : [])] };
  }

  const inner = [];
  const author = embed.author?.name?.trim();
  if (author) inner.push(text(`-# ${author}`));
  const head = [];
  if (embed.title?.trim()) head.push(`## ${embed.title.trim()}`);
  if (embed.description?.trim()) head.push(embed.description.trim());
  const thumb = embed.thumbnail?.trim();
  if (head.length && thumb) inner.push(section(head, thumb));
  else if (head.length) inner.push(...head.map(text));
  else if (thumb) inner.push({ type: T.GALLERY, items: [{ media: { url: thumb } }] });
  if (embed.image?.trim()) inner.push({ type: T.GALLERY, items: [{ media: { url: embed.image.trim() } }] });

  const fields = (embed.fields ?? []).filter((field) => field?.name || field?.value);
  if (fields.length) {
    if (inner.length) inner.push(separator());
    inner.push(text(fields.map((field) => `**${field.name}**\n${field.value}`).join('\n\n').slice(0, 4000)));
  }
  const footer = embed.footer?.text?.trim();
  if (footer) {
    inner.push(separator(true, 1));
    inner.push(text(`-# ${footer}`));
  }
  inner.push(...buttonRows(data.buttons));
  const color = Number.isInteger(embed.color) && embed.color > 0 ? embed.color : null;
  return { components: [...children, container(color, inner.length ? inner : [text('​')])] };
}

function buttonRows(buttons) {
  const rows = [];
  for (const row of Array.isArray(buttons) ? buttons : []) {
    const items = (Array.isArray(row) ? row : []).filter((button) => button?.label && button?.url).slice(0, 5)
      .map((button) => ({ type: T.BUTTON, style: 5, label: String(button.label).slice(0, 80), url: button.url, ...(button.disabled ? { disabled: true } : {}) }));
    if (items.length) rows.push({ type: T.ROW, components: items });
  }
  return rows;
}

module.exports = { thanksDesign, logDesign, toV2 };
