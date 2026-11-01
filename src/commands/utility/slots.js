// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isSlashCommand } = require('../../handlers/commandHandler');
const { isPettoOperator } = require('../../utils/autoModControl');
const { slotUsage, nearLimit, difference, LIMITS } = require('../../utils/slashBudget');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');


/** The slash commands Discord has registered for Petto (global), as plain JSON; null when Discord cannot be asked. */
async function registeredCommands(client) {
  try {
    const list = await client.application.commands.fetch();
    return [...list.values()].map((command) => command.toJSON());
  } catch {
    return null;
  }
}

/** The commands Petto loads that are sent to Discord: the slash commands (see `isSlashCommand`) and the context menus; a command that works only with the prefix is not. */
function loadedCommands(client) {
  return [...client.commands.values()]
    .filter((command) => command?.data && !command.prefixOnly && !command.privateGuildId && (isSlashCommand(command) || (command.data.toJSON().type ?? 1) !== 1))
    .map((command) => command.data.toJSON());
}

function slotLines(usage) {
  const bar = (entry) => `**${entry.used} / ${entry.limit}** (${entry.free} left)`;
  return [
    `${EMOJI.STAR} Slash commands: ${bar(usage.chat)}`,
    `User menus: ${bar(usage.user)} · Message menus: ${bar(usage.message)}`,
  ];
}

/** Private control for Petto's team: how many slash command slots are left, what is close to a limit and what Discord has compared with what Petto loads. Prefix-only and hidden from !help. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Private control: the slash command slots Petto has left.')
    .setDMPermission(false),

  async execute(interaction) {
    // Nobody else gets an answer: for a plain member this is as if the word were not a command.
    if (!isPettoOperator(interaction.user?.id)) return undefined;
    await interaction.deferReply?.({ flags: MessageFlags.IsComponentsV2 });
    const client = interaction.client;

    const registered = await registeredCommands(client);
    const loaded = loadedCommands(client);
    const lines = [];
    if (registered) {
      lines.push('**Slash command slots (global)**', ...slotLines(slotUsage(registered)));
      const full = nearLimit(registered);
      if (full.length) {
        lines.push(`Close to a limit (${LIMITS.subcommands} subcommands or ${LIMITS.size} characters each):`);
        for (const entry of full.slice(0, 10)) lines.push(`- \`/${entry.name}\` ${entry.subcommands} / ${LIMITS.subcommands} subcommands · ${entry.size} / ${LIMITS.size} characters${entry.full ? ' (full)' : ''}`);
      }
      const { onlyRegistered, notRegistered } = difference(registered, loaded);
      if (onlyRegistered.length) lines.push(`${EMOJI.WARNING} At Discord but not loaded any more: ${onlyRegistered.slice(0, 8).map((key) => `\`${key.split(':')[1]}\``).join(', ')}${onlyRegistered.length > 8 ? ` and ${onlyRegistered.length - 8} more` : ''}. Run \`node deploy-commands.js\` to remove them.`);
      if (notRegistered.length) lines.push(`${EMOJI.WARNING} Loaded but not registered yet: ${notRegistered.slice(0, 8).map((key) => `\`${key.split(':')[1]}\``).join(', ')}${notRegistered.length > 8 ? ` and ${notRegistered.length - 8} more` : ''}. Run \`node deploy-commands.js\`.`);
    } else {
      const usage = slotUsage(loaded);
      lines.push('**Slash command slots (global)**', ...slotLines(usage), `${EMOJI.WARNING} Discord could not be asked, so this is what Petto loads, not what is registered.`);
    }

    // The commands that work only with the prefix (the ones people see in the help): how many could still be moved to slash commands, and which of them
    // are too big to go as they are (more than 25 subcommands, or 8000 characters).
    const prefixCommands = [...client.commands.values()].filter((command) => !command.hiddenFromHelp && !isSlashCommand(command) && (command.data.toJSON().type ?? 1) === 1);
    const tooBig = nearLimit(prefixCommands.map((command) => command.data.toJSON()), { subcommands: 26, size: LIMITS.size + 1 });
    lines.push('', `**Only with the prefix (not slash yet): ${prefixCommands.length}**`);
    if (registered) lines.push(`Room to move them all: ${slotUsage(registered).chat.free >= prefixCommands.length ? 'yes' : `no, ${slotUsage(registered).chat.free} slots for ${prefixCommands.length} commands`}.`);
    if (tooBig.length) lines.push(`Too big to move as they are: ${tooBig.slice(0, 10).map((entry) => `\`${entry.name}\` (${entry.subcommands} subcommands, ${entry.size} characters)`).join(', ')}.`);

    return reply(interaction, lines.join('\n'), 0xa5ea7a);
  },
};

async function reply(interaction, content, color) {
  return interaction.editReply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 });
}
