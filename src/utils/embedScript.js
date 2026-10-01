// Reads a message written as one line of text, such as `{embed}&v{title: Hello}&v{description: ...}`.
// The format follows the embed scripting that other Discord bots use (https://docs.bleed.bot/resources/scripting/embeds).
//
// Text before `{embed}` is the message text, each `{key: value}` block sets one part of the embed, the blocks are
// joined by `&v` (what Petto writes) or `$v` (what other bots write), and a block with several values separates
// them with `&&`. Braces nest, so variables such as `{user.mention}` can be used inside a value.
//
//   {title: text}                 {url: https://...}              {description: text}
//   {color: #8399ff}              {thumbnail: https://...}        {image: https://...}
//   {author: name && icon && url} {footer: text && icon}          {timestamp}
//   {field: name && value}  or  {field: name && value && inline}
//   {button: link && label && url}  (link buttons only)           {message: text}  (same as text before {embed})

const SEPARATORS = ['&v', '$v'];
const KNOWN_KEYS = new Set(['embed', 'content', 'message', 'text', 'title', 'url', 'description', 'desc', 'thumbnail', 'image', 'timestamp', 'color', 'colour', 'author', 'footer', 'field', 'button']);
// Words that start a variable of the bot, so a block such as {choose:a|b} is text and not a typo of a block name.
const VARIABLE_WORDS = new Set(['choose', 'range', 'args', 'user', 'server', 'guild', 'channel', 'role', 'newline', 'prefix', 'reactreply', 'level', 'date', 'time']);
const EMBED_START = /^\{embed\}\s*(?:&v|\$v|$)/i;
const BUTTON_KINDS = new Set(['link', 'blurple', 'green', 'grey', 'gray', 'red', 'primary', 'success', 'secondary', 'danger']);

/** Splits the code into text and top-level `{...}` blocks, in order. Braces inside a block nest. */
function tokenize(code) {
  const items = [];
  const warnings = [];
  let text = '';
  let depth = 0;
  let current = '';
  const flush = () => { if (text) items.push({ block: false, value: text }); text = ''; };
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (depth === 0) {
      const separator = SEPARATORS.find((candidate) => code.startsWith(candidate, i));
      if (separator) { flush(); i += separator.length - 1; continue; }
      if (char === '{') { flush(); depth = 1; current = ''; continue; }
      if (char === '}') {
        // A spare closing brace is skipped, so the rest of the code is still read.
        if (!warnings.some((line) => line.includes('closing brace'))) warnings.push('There is a closing brace } with no opening one, it was ignored.');
        continue;
      }
      text += char;
      continue;
    }
    // A new {embed} inside a block means the block before it lost its closing brace, such as two codes pasted one
    // after the other. The block is closed there and the new embed starts, instead of swallowing it as text.
    if (char === '{' && EMBED_START.test(code.slice(i))) {
      warnings.push('A block was not closed before the next {embed}, it was closed there.');
      items.push({ block: true, value: current });
      current = '';
      depth = 0;
      i--;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) { items.push({ block: true, value: current }); current = ''; continue; }
    }
    current += char;
  }
  flush();
  if (depth !== 0) warnings.push('A block is not closed: there is an opening brace { with no closing one.');
  return { items, warnings };
}

const parts = (value) => value.split('&&').map((part) => part.trim());

function parseColor(value) {
  const text = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(text)) return parseInt(text, 16);
  if (/^[0-9a-f]{3}$/i.test(text)) return parseInt(text.split('').map((c) => c + c).join(''), 16);
  return null;
}

/**
 * Reads a code. It never throws: what cannot be read is left out and described in `warnings`.
 * Returns the message text, the embeds (`embed` is the first one, or null when the code sets nothing for it), the link buttons, and the warnings.
 */
function parseEmbedScript(code) {
  const warnings = [];
  const newEmbed = () => ({ title: '', description: '', color: null, url: '', thumbnail: '', image: '', timestamp: false, author: null, footer: null, fields: [] });
  const embeds = [];
  let embed = null;
  let touched = false;
  const buttons = [];
  let loose = '';
  // The embed the next block belongs to. Blocks that set a part of an embed start one when {embed} is missing.
  const current = () => {
    if (!embed) { embed = newEmbed(); embeds.push(embed); }
    touched = true;
    return embed;
  };

  const tokens = tokenize(String(code ?? '').trim());
  warnings.push(...tokens.warnings);

  for (const item of tokens.items) {
    if (!item.block) { loose += item.value; continue; }
    const block = item.value;
    const colon = block.indexOf(':');
    const key = (colon === -1 ? block : block.slice(0, colon)).trim().toLowerCase();
    const value = colon === -1 ? '' : block.slice(colon + 1).trim();
    const looksLikeTypo = colon !== -1 && /^[a-z]+$/.test(key) && !VARIABLE_WORDS.has(key);
    if (!KNOWN_KEYS.has(key) && !looksLikeTypo) { loose += `{${block}}`; continue; }

    switch (key) {
      case 'embed':
        // {embed} opens an embed; one after an embed that already has parts opens the next one.
        if (!embed || touched) { embed = newEmbed(); embeds.push(embed); touched = false; }
        break;
      case 'content': case 'message': case 'text': loose += value; break;
      case 'title': current().title = value; break;
      case 'url': current().url = value; break;
      case 'description': case 'desc': current().description = value; break;
      case 'thumbnail': current().thumbnail = value; break;
      case 'image': current().image = value; break;
      case 'timestamp': current().timestamp = value === '' || !/^(false|no|0)$/i.test(value); break;
      case 'color': case 'colour': {
        const color = parseColor(value);
        if (color === null) warnings.push(`The color "${value}" is not a hex color such as #8399ff.`);
        else current().color = color;
        break;
      }
      case 'author': {
        const [name, icon, url] = parts(value);
        if (name) current().author = { name, icon: icon ?? '', url: url ?? '' };
        break;
      }
      case 'footer': {
        const [text, icon] = parts(value);
        if (text) current().footer = { text, icon: icon ?? '' };
        break;
      }
      case 'field': {
        const [name, fieldValue, inline] = parts(value);
        if (!name || !fieldValue) { warnings.push('A field needs a name and a value: {field: name && value && inline}.'); break; }
        current().fields.push({ name, value: fieldValue, inline: /^(true|yes|inline|1)$/i.test(inline ?? '') });
        break;
      }
      case 'button': {
        let [first, ...rest] = parts(value);
        const kind = (first ?? '').toLowerCase();
        if (BUTTON_KINDS.has(kind)) {
          if (kind !== 'link') warnings.push(`Only link buttons can be saved, the ${kind} button was turned into a link button.`);
        } else {
          rest = [first ?? '', ...rest];
        }
        const disabled = rest.length > 2 && /^disabled$/i.test(rest[rest.length - 1] ?? '');
        const [label, url] = rest;
        if (!label || !url) { warnings.push('A button needs a label and a link: {button: link && label && https://...}.'); break; }
        buttons.push({ label, url, emoji: '', disabled });
        break;
      }
      default:
        warnings.push(`The block {${key}} is not supported and was ignored.`);
    }
  }

  for (const each of embeds) {
    if (each.fields.length > 25) { warnings.push('An embed holds at most 25 fields, the rest were left out.'); each.fields.length = 25; }
  }
  if (embeds.length > 10) { warnings.push('A message holds at most 10 embeds, the rest were left out.'); embeds.length = 10; }
  if (buttons.length > 5) warnings.push('Only the first 5 buttons fit in one row.');
  return { content: loose.trim(), embed: embeds[0] ?? null, embeds, buttons: buttons.slice(0, 5), warnings };
}

/**
 * The data to save for a parsed code. An embed alone is stored the way `/embed create` stores one, so the edit panel
 * keeps working on it. A message text or buttons need the dashboard's shape, which the panel cannot edit.
 */
function toTemplateData(parsed) {
  const embeds = (parsed.embeds ?? (parsed.embed ? [parsed.embed] : [])).map((each) => ({ ...each }));
  if (!parsed.content && !parsed.buttons.length && embeds.length <= 1) {
    const embed = embeds[0] ?? null;
    return { data: { ...(embed ?? {}), fields: embed?.fields ?? [] }, editableInPanel: true };
  }
  return {
    data: { content: parsed.content, embeds, buttons: parsed.buttons.length ? [parsed.buttons] : [] },
    editableInPanel: false,
  };
}

module.exports = { parseEmbedScript, toTemplateData };
