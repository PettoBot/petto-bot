// i18n-ignore-file: the buttons under the cards of the Petto team (operators only), in English.
// The card of a DM report in the team channel: "Mark handled". Only the Petto team may press it (the same people as the other team tools).
// A handled report is final: there is no button or statement that opens it again, and an old button pressed twice only says so.
const { MessageFlags } = require('discord.js');
const { isPettoOperator } = require('../utils/autoModControl');
const { teamCard } = require('../utils/dmReports');
const { TEAM_PREFIX } = require('../utils/dmOrigin');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** `dmteam:done:<id>`. (`dmteam:open:<id>` from a card of an older version is not valid any more: nothing reopens a report.) */
async function handleTeamButton(interaction, deps = {}) {
  const db = deps.db ?? require('../db/dmReports');
  const match = new RegExp(`^${TEAM_PREFIX}:(done):(\\d{1,18})$`).exec(interaction.customId);
  if (!match) return reply(interaction, 'That button is not valid any more.');
  if (!isPettoOperator(interaction.user.id)) return reply(interaction, 'Only the Petto team can do this.');
  const row = await db.handle(match[2], interaction.user.id);
  if (!row) return reply(interaction, 'This report was already handled (it is final and cannot be reopened), or it does not exist.');
  return interaction.update(teamCard(row, { handledBy: row.handled_by ?? interaction.user.id }));
}

module.exports = { handleTeamButton };
