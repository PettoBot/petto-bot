// /act: every interaction action (hug, pat, slap, wave...) as a subcommand, spread over a few groups because Discord allows 25
// subcommands in a group and 100 slash commands in all. The prefix keeps every action as its own word (`!hug @member`, `!hf`):
// the routes of utils/actions.js send it here, so slash and prefix run the same code (utils/roleplay.js, executeAction).
const { SlashCommandBuilder } = require('discord.js');
const { COMMAND_NAME, GROUPS, DESCRIPTIONS } = require('../../utils/actions');
const { executeAction } = require('../../utils/roleplay');

// Discord shows these names in the language of the person (the English ones are the real names, the prefix uses them too).
const NAMES = {
  [COMMAND_NAME]: { 'es-ES': 'accion', 'es-419': 'accion', 'pt-BR': 'acao' },
  love: { 'es-ES': 'afecto', 'es-419': 'afecto', 'pt-BR': 'afeto' },
  play: { 'es-ES': 'juego', 'es-419': 'juego', 'pt-BR': 'brincadeira' },
  fight: { 'es-ES': 'pelea', 'es-419': 'pelea', 'pt-BR': 'briga' },
  feel: { 'es-ES': 'animo', 'es-419': 'animo', 'pt-BR': 'humor' },
  react: { 'es-ES': 'reaccion', 'es-419': 'reaccion', 'pt-BR': 'reacao' },
};
const GROUP_DESCRIPTIONS = {
  love: 'Affection and sweet gestures.',
  play: 'Playful and silly actions.',
  fight: 'Playful fights and angry looks.',
  feel: 'Moods and feelings.',
  react: 'Greetings and reactions.',
};

const data = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setNameLocalizations(NAMES[COMMAND_NAME])
  .setDescription('Interact with members: hugs, pats, slaps and more.')
  .setDMPermission(false);
for (const group of GROUPS) {
  data.addSubcommandGroup((builder) => {
    builder.setName(group.name).setNameLocalizations(NAMES[group.name]).setDescription(GROUP_DESCRIPTIONS[group.name]);
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
  // The rules of a server (!disablecommand, !restrictcommand) can name one action (`hug`) as well as the command (`act`).
  rulesBySubcommand: true,
  cooldownMs: 2_500,
  data,
  execute: executeAction,
};
