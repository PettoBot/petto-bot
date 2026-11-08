// /act: every interaction action (hug, pat, slap, wave...) as a subcommand, spread over a few groups because Discord allows 25
// subcommands in a group and 100 slash commands in all. The prefix keeps every action as its own word (`!hug @member`, `!hf`):
// the routes of utils/actions.js send it here, so slash and prefix run the same code (utils/roleplay.js, executeAction).
const { SlashCommandBuilder } = require('discord.js');
const { COMMAND_NAME, GROUPS, DESCRIPTIONS } = require('../../utils/actions');
const { executeAction } = require('../../utils/roleplay');

const GROUP_DESCRIPTIONS = {
  love: 'Affection and sweet gestures.',
  play: 'Playful and silly actions.',
  fight: 'Playful fights and angry looks.',
  feel: 'Moods and feelings.',
  react: 'Greetings and reactions.',
};

const data = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription('Interact with members: hugs, pats, slaps and more.')
  .setDMPermission(false);
for (const group of GROUPS) {
  data.addSubcommandGroup((builder) => {
    builder.setName(group.name).setDescription(GROUP_DESCRIPTIONS[group.name]);
    for (const name of group.actions) {
      // The member is optional: without one, the action is something the author does alone (`!hug` hugs themselves).
      builder.addSubcommand((sub) => sub
        .setName(name)
        .setDescription(DESCRIPTIONS[name])
        .addUserOption((option) => option.setName('user').setDescription('The member involved.').setRequired(false)));
    }
    return builder;
  });
}

module.exports = {
  // `/act` was the name of this command: the word still works with the prefix (`!act love hug`) and the rules a server saved for `act` still apply.
  aliases: ['act'],
  legacyRuleNames: ['act'],
  // The rules of a server (!disablecommand, !restrictcommand) can name one action (`hug`) as well as the command (`action`).
  rulesBySubcommand: true,
  cooldownMs: 2_500,
  data,
  execute: executeAction,
};
