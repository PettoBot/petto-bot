// The rules of button responders and panels, apart from Discord: names, which roles a click gives or takes, and the
// buttons and menu a panel shows.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const NAME_RE = /^[a-z0-9_-]{1,60}$/;
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const BUTTON_PREFIX = 'br:';
const SELECT_PREFIX = 'brs:';
const MAX_ITEMS = 25;
const MAX_ROLES = 10;

/** A name as it is stored (lowercase, spaces as dashes), or null when it is not a valid one. */
function normalizeName(text) {
  const name = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return NAME_RE.test(name) ? name : null;
}

/** What a click does to the roles of a member: `{ denied }` when they lack the required role, or the roles to give and to take. */
function planRoles(responder, memberRoleIds) {
  const has = new Set(memberRoleIds);
  if (responder.required_role_ids.length && !responder.required_role_ids.some((id) => has.has(id))) return { denied: true, add: [], remove: [], toggledOff: false };
  const give = responder.give_role_ids;
  if (responder.toggle && give.length && give.every((id) => has.has(id))) return { denied: false, add: [], remove: [...give], toggledOff: true };
  return { denied: false, add: give.filter((id) => !has.has(id)), remove: responder.remove_role_ids.filter((id) => has.has(id) && !give.includes(id)), toggledOff: false };
}

/** In an exclusive menu, the roles of the other choices that the member has and the chosen one does not give. */
function exclusiveRemovals(chosen, all, memberRoleIds) {
  const has = new Set(memberRoleIds);
  const keep = new Set(chosen.give_role_ids);
  const out = new Set();
  for (const other of all) {
    if (other.id === chosen.id) continue;
    for (const id of other.give_role_ids) if (has.has(id) && !keep.has(id)) out.add(id);
  }
  return [...out];
}

/** The sentence that says what happened to the roles. */
function describe(add, remove) {
  const parts = [];
  if (add.length) parts.push(`Added ${add.map((id) => `<@&${id}>`).join(', ')}.`);
  if (remove.length) parts.push(`Removed ${remove.map((id) => `<@&${id}>`).join(', ')}.`);
  return parts.join(' ');
}

function emojiOf(text) {
  const value = String(text ?? '').trim();
  if (!value) return undefined;
  const custom = value.match(/^<(a?):(\w+):(\d+)>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  return value.length <= 16 && !/\s/.test(value) ? value : undefined;
}

/** The rows of components of a panel: buttons (5 to a row) or one dropdown menu. `room` is how many rows are still free. */
function panelRows(panel, responders, room = 5) {
  const shown = panel.responders.map((name) => responders.find((responder) => responder.name === name)).filter(Boolean).slice(0, MAX_ITEMS);
  if (!shown.length || room < 1) return [];
  if (panel.kind === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}${panel.id}`)
      .setPlaceholder((panel.placeholder || 'Choose one').slice(0, 100))
      .setMinValues(0)
      .setMaxValues(1)
      .addOptions(shown.map((responder) => {
        const option = { label: (responder.label || responder.name).slice(0, 100), value: String(responder.id) };
        const emoji = emojiOf(responder.emoji);
        if (emoji) option.emoji = emoji;
        return option;
      }));
    return [new ActionRowBuilder().addComponents(menu)];
  }
  const rows = [];
  for (let index = 0; index < shown.length && rows.length < room; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(shown.slice(index, index + 5).map((responder) => {
      const button = new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${responder.id}`).setStyle(STYLES[responder.style] ?? ButtonStyle.Secondary);
      const emoji = emojiOf(responder.emoji);
      const label = (responder.label || (emoji ? '' : responder.name)).slice(0, 80);
      if (label) button.setLabel(label);
      if (emoji) button.setEmoji(emoji);
      return button;
    })));
  }
  return rows;
}

module.exports = { NAME_RE, STYLES, BUTTON_PREFIX, SELECT_PREFIX, MAX_ITEMS, MAX_ROLES, normalizeName, planRoles, exclusiveRemovals, describe, emojiOf, panelRows };
