// The message of a panel: its text or saved embed (a V2 design too) with the buttons or the menu under it.
const { MessageFlags } = require('discord.js');
const { templatePayload } = require('./templatedMessage');
const { panelRows } = require('./responderEngine');

/** `{ content, embeds, components, files, flags }` ready to send or edit, with the panel's rows added to the ones of the saved embed. */
async function panelPayload(panel, responders, ctx) {
  let base = null;
  if (panel.embed_template) base = await templatePayload(ctx.guild.id, panel.embed_template, ctx);
  if (!base) base = { content: panel.content || `**${panel.name}**`, embeds: [], components: [], files: [] };
  const existing = base.components ?? [];
  const isV2 = Boolean(base.flags && (base.flags & MessageFlags.IsComponentsV2));
  // A message has at most 5 rows. A V2 design can hold more things, so its own rows are not counted there.
  const room = isV2 ? 5 : Math.max(0, 5 - existing.length);
  const rows = panelRows(panel, responders, room);
  return { ...base, components: [...existing, ...rows] };
}

module.exports = { panelPayload };
