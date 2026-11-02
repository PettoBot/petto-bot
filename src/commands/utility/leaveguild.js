// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { isTeam, findGuild, notFoundText, guildLine, protectedGuildIds, opsNote, confirm, teamReply, oneLine } = require('../../utils/teamTools');

const RED = 0xfe6465;
const YELLOW = 0xfed53c;

/** `!leaveguild <server id or name> [--here]`: the flag is taken out of the text, wherever it is written. */
function readText(text) {
  const raw = String(text ?? '');
  const here = /(^|\s)--here(?=\s|$)/i.test(raw);
  return { here, query: raw.replace(/(^|\s)--here(?=\s|$)/gi, ' ').trim() };
}

/**
 * Private support control, prefix only. Makes Petto leave one of its servers (it cannot remove another bot from a server where Petto is not installed).
 * Anybody outside the team gets no answer. It asks for a yes before it leaves, with buttons only the person who typed it can press, for 30 seconds.
 */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  teamOnly: true,
  team: {
    summary: 'Makes Petto leave a server, after you confirm with a button. It refuses the server where you type it unless you add --here, and never leaves the operations or support server.',
    usage: ['!leaveguild <server id or name>', '!leaveguild --here'],
    who: 'owner and developers',
  },
  prefixRawOptions: { _: (text) => ({ server: String(text ?? '') }) },
  data: new SlashCommandBuilder()
    .setName('leaveguild')
    .setDescription('Private support control: make Petto leave one of its servers.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('server')
      .setDescription('The ID or the exact name of the server Petto should leave, or --here for this one.')
      .setRequired(false)),

  async execute(interaction) {
    if (!isTeam(interaction.user?.id)) return undefined;
    const client = interaction.client;
    const { here, query } = readText(interaction.options.getString('server'));
    if (!query && !here) {
      return teamReply(interaction, `${EMOJI.WARNING} Say which server: \`!leaveguild <server id or name>\`. To leave the server where you are typing, add \`--here\`: \`!leaveguild --here\`.`, YELLOW);
    }

    const found = await findGuild(client, query, { current: interaction.guild ?? null });
    if (!found.ok) return teamReply(interaction, `${EMOJI.WARNING} ${notFoundText(found, query)}`, YELLOW);
    if ((await protectedGuildIds(client)).has(found.id)) return teamReply(interaction, `${EMOJI.DENY} Petto cannot leave its operations or support server with this command.`, RED);
    if (!found.guild) return teamReply(interaction, `${EMOJI.WARNING} Petto is not currently in a server with ID \`${found.id}\`.`, YELLOW);
    if (found.id === interaction.guildId && !here) {
      return teamReply(interaction, `${EMOJI.DENY} That is the server where you typed the command, so Petto will not leave it by accident. If you mean it: \`!leaveguild --here\`.`, RED);
    }

    const target = found.guild;
    const { confirmed, click } = await confirm(interaction, `Petto will **leave** ${guildLine(target)}. This disconnects it at once.\nLeave it?`, { yes: 'Yes, leave' });
    if (!click) return undefined;
    if (!confirmed) return click.update({ components: [textCard(`${EMOJI.DENY} Cancelled: Petto stays in **${oneLine(target.name, 80)}**.`, null)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});

    const summary = guildLine(target);
    await click.update({ components: [textCard(`${EMOJI.WARNING} Leaving ${summary}…`)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
    try {
      await target.leave();
      logger.info(`Support leave control completed: guild=${target.id} name=${target.name} requested_by=${interaction.user.id}`);
      await opsNote(client, `**Petto left a server by hand.**\n${summary}\nBy: <@${interaction.user.id}> (\`${interaction.user.id}\`)`);
      return interaction.editReply({ components: [textCard(`${EMOJI.APPROVE} Petto left ${summary}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
    } catch (error) {
      logger.error(`Support leave control failed for guild ${target.id}:`, error);
      return interaction.editReply({ components: [textCard(`${EMOJI.DENY} Petto could not leave **${oneLine(target.name, 80)}** right now.`, RED)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});
    }
  },
};
