// Discord gives a bot 3 seconds to answer a button, a menu or a form. When the answer is slow (a database, Redis or the host having a bad
// moment) the interaction is gone by then and the member sees "This interaction failed", while the log gets an "Unknown interaction"
// error. `ack` tells Discord at once that the answer is coming (which gives 15 minutes), and `answer` then fills it in.
const { MessageFlags } = require('discord.js');

const TOO_LATE = new Set([10062, 40060]); // unknown interaction (it expired), interaction already acknowledged

/** Tells Discord the answer is coming. False when it was already too late (nothing can be said to that person any more). */
async function ack(interaction, { ephemeral = true } = {}) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    return true;
  } catch (error) {
    if (TOO_LATE.has(error?.code)) return false;
    throw error;
  }
}

/** Says the answer: fills in the one that was announced with `ack`, adds to one already given, or answers for the first time. */
function answer(interaction, payload) {
  if (interaction.deferred && !interaction.replied) {
    // What the announced answer is (private or not) was decided when it was announced.
    const { flags, ephemeral, ...rest } = payload;
    return interaction.editReply(rest);
  }
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

module.exports = { ack, answer };
