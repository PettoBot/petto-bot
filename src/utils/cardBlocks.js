// i18n-ignore-file: no text of its own, it only cuts the text it is given
// Text for a card with its parts told apart: a `### ` heading that does not open the text starts a new part, and a divider goes
// between the parts. The commands that put two blocks together (`${intro}\n\n${settings}`) get their divider without each one drawing it.
const { SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } = require('discord.js');

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

/** Adds the text to a container as one text display per part, with a divider between them. */
function addBlocks(container, text) {
  splitBlocks(text).forEach((block, index) => {
    if (index > 0) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
  });
  return container;
}

module.exports = { splitBlocks, addBlocks };
