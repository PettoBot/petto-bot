// i18n-ignore-file: the buttons under the cards of the Petto team (operators only), in English.
// The card of a DM report in the team channel: "Mark handled" and "Reopen". Only the Petto team may press them (the same people as the other team tools).
const { MessageFlags } = require('discord.js');
const { isPettoOperator } = require('../utils/autoModControl');
const { teamCard } = require('../utils/dmReports');
const { TEAM_PREFIX } = require('../utils/dmOrigin');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** `dmteam:done:<id>` and `dmteam:open:<id>`. */
async function handleTeamButton(interaction, deps = {}) {
  const db = deps.db ?? require('../db/dmReports');
  const match = new RegExp(`^${TEAM_PREFIX}:(done|open):(\\d{1,18})$`).exec(interaction.customId);
  if (!match) return reply(interaction, 'That button is not valid any more.');
  if (!isPettoOperator(interaction.user.id)) return reply(interaction, 'Only the Petto team can do this.');
  const row = match[1] === 'done' ? await db.handle(match[2], interaction.user.id) : await db.reopen(match[2]);
  if (!row) return reply(interaction, match[1] === 'done' ? 'This report was already handled, or it does not exist.' : 'This report is not marked as handled.');
  return interaction.update(teamCard(row, { handledBy: row.handled_by }));
}

module.exports = { handleTeamButton };
