// i18n-ignore-file: no text of its own, it only cuts the text it is given
// Text for a card with its parts told apart: a `### ` heading that does not open the text starts a new part, and a divider goes
// between the parts. The commands that put two blocks together (`${intro}\n\n${settings}`) get their divider without each one drawing it.
//
// It also keeps a card inside what Discord accepts, so a long list can never turn a finished command into an error: a text display has
// from 1 to 4000 characters (the check of discord.js, and the answer of Discord when it is broken), and the text of a whole Components V2
// message is kept within the same 4000. Text that fits is never touched.
const { SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } = require('discord.js');

/** The most characters one text display holds. */
const TEXT_DISPLAY_LIMIT = 4000;
/** The most characters of text in all the text displays of one message. */
const MESSAGE_TEXT_LIMIT = 4000;
/** What a text display with nothing to say holds: a zero width space, so it is not empty. */
const EMPTY_TEXT = '​';
const ELLIPSIS = '…';
// A block that does not fit is cut instead of dropped only when at least this much of it can stay.
const MIN_PARTIAL = 40;

/** The text cut before each `### ` heading that follows other text; blank lines at the cuts are dropped. */
function splitBlocks(text) {
  const blocks = [];
  let current = [];
  let fenced = false;
  for (const line of String(text ?? '').split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    if (!fenced && /^### /.test(line) && current.some((l) => l.trim())) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some((l) => l.trim())) blocks.push(current.join('\n').trim());
  return blocks.length ? blocks : [String(text ?? '')];
}

/** True when the text ends inside a code fence (a line that starts with three backticks opens it, the next one closes it). */
function endsInsideFence(text) {
  let fenced = false;
  for (const line of text.split('\n')) if (/^```/.test(line)) fenced = !fenced;
  return fenced;
}

/** The end of a cut text with whatever was left half written taken off: a mention, a custom emoji, a timestamp, a link, a split character. */
function dropHalfToken(text) {
  let out = text;
  // A lone high surrogate: half of an emoji.
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  // `<@123`, `<@&123`, `<#123`, `<:name:123`, `<a:name`, `<t:123`, `</cmd:1`, an autolink `<https://...`: the closing `>` never came.
  out = out.replace(/<[^<>\s]*$/, '');
  // `[text](https://...` with no `)`, or a `[text` with no `]` among the last characters.
  out = out.replace(/\[[^\]\n]*\]\([^)\n]*$/, '').replace(/\[[^\]\n]{0,200}$/, '');
  // The start of a fence line (one or two backticks) that was cut.
  out = out.replace(/(^|\n)`{1,2}$/, '$1');
  return out;
}

/**
 * The text cut to at most `max` characters, ending with `…`: at the end of a line when there is one in the last half, else at a word,
 * never inside a mention, emoji or link, and with an open code fence closed. A text that already fits is returned as it is.
 */
function clipText(text, max = TEXT_DISPLAY_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  if (max <= 1) return max === 1 ? ELLIPSIS : '';
  const attempt = (room) => {
    const window = value.slice(0, Math.max(0, room));
    // The cut falls on a line or word boundary when one is close enough; otherwise it falls where the room ends.
    let end = window.length;
    if (value[room] !== '\n' && value[room] !== ' ') {
      const line = window.lastIndexOf('\n');
      const word = window.lastIndexOf(' ');
      const at = line >= room / 2 ? line : word >= room / 2 ? word : -1;
      if (at > 0) end = at;
    }
    return dropHalfToken(window.slice(0, end)).trimEnd();
  };
  let head = attempt(max - 1);
  if (endsInsideFence(head)) {
    // Room for the closing fence after the text: "\n```\n…".
    head = attempt(max - 6);
    if (endsInsideFence(head)) return `${head}\n\`\`\`\n${ELLIPSIS}`;
  }
  return `${head}${ELLIPSIS}`;
}

/** The text of a content that is going into a text display: never empty, never over the limit of one display. */
function displayText(content) {
  const value = String(content ?? '');
  return value.trim() ? clipText(value, TEXT_DISPLAY_LIMIT) : EMPTY_TEXT;
}

/** How many characters of text the components of a container (or any builder with `components`) already hold. */
function textLength(builder) {
  let total = 0;
  for (const part of builder?.components ?? []) {
    const content = part?.data?.content;
    if (typeof content === 'string') total += content.length;
    if (Array.isArray(part?.components)) total += textLength(part);
  }
  return total;
}

/**
 * The blocks fitted to `budget` characters. Blocks with nothing to show are skipped (a lone zero width space stands in when the card
 * would otherwise have no text: `needsText`). When they are too long together the last ones are cut, and a short `…` block says so.
 */
function fitBlocks(blocks, budget, needsText = true) {
  const shown = blocks.filter((block) => String(block).trim());
  if (!shown.length) return needsText && budget >= 1 ? [EMPTY_TEXT] : [];
  const total = shown.reduce((sum, block) => sum + block.length, 0);
  if (total <= budget) return shown;
  let left = budget;
  const out = [];
  for (const block of shown) {
    // A block stays whole only with one character to spare, for the `…` block in case the next one has to go.
    if (block.length < left) {
      out.push(block);
      left -= block.length;
      continue;
    }
    if (left >= MIN_PARTIAL) out.push(clipText(block, left));
    else if (left >= 1) out.push(ELLIPSIS);
    break;
  }
  return out;
}

/** Adds the text to a container as one text display per part, with a divider between them. */
function addBlocks(container, text) {
  const used = textLength(container);
  fitBlocks(splitBlocks(text), MESSAGE_TEXT_LIMIT - used, used === 0).forEach((block, index) => {
    if (index > 0) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
  });
  return container;
}

/**
 * Makes `setContent` of every text display safe, wherever it is called (a card, a panel, a modal): the text is cut to what one display
 * holds, and a text with nothing in it becomes a zero width space, instead of throwing a RangeError that makes a command fail. The
 * total of a whole message is kept by `addBlocks`, and the last-resort retry of the command handlers covers the rest.
 */
function installTextDisplayGuard(Builder = TextDisplayBuilder) {
  if (Builder.prototype.setContent.__petto) return;
  const original = Builder.prototype.setContent;
  function setContent(content) {
    return original.call(this, displayText(content));
  }
  setContent.__petto = true;
  Builder.prototype.setContent = setContent;
}

module.exports = {
  TEXT_DISPLAY_LIMIT,
  MESSAGE_TEXT_LIMIT,
  EMPTY_TEXT,
  splitBlocks,
  addBlocks,
  clipText,
  displayText,
  fitBlocks,
  textLength,
  installTextDisplayGuard,
};
