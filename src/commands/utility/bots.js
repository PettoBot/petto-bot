// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isPettoOperator } = require('../../utils/autoModControl');
const { slotUsage, nearLimit, difference, LIMITS } = require('../../utils/slashBudget');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const MAX_BOTS_LISTED = 20;
const MEMBER_FETCH_UP_TO = 2000;

/** The slash commands Discord has registered for Petto (global), as plain JSON; null when Discord cannot be asked. */
async function registeredCommands(client) {
  try {
    const list = await client.application.commands.fetch();
    return [...list.values()].map((command) => command.toJSON());
  } catch {
    return null;
  }
}

/** The commands Petto loads that are sent to Discord (a command that is prefix only is not). */
function loadedCommands(client) {
  return [...client.commands.values()].filter((command) => !command.prefixOnly).map((command) => command.data.toJSON());
}

function slotLines(usage) {
  const bar = (entry) => `**${entry.used} / ${entry.limit}** (${entry.free} left)`;
  return [
    `${EMOJI.STAR} Slash commands: ${bar(usage.chat)}`,
    `User menus: ${bar(usage.user)} · Message menus: ${bar(usage.message)}`,
  ];
}

/** Who the bots of this server are: the ones Discord says (a big server is only read from the cache). */
async function botsOf(guild) {
  let complete = true;
  if (guild.memberCount <= MEMBER_FETCH_UP_TO) await guild.members.fetch().catch(() => { complete = false; });
  else complete = false;
  const bots = [...guild.members.cache.values()].filter((member) => member.user?.bot).sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0));
  return { bots, complete };
}

/** Private control for Petto's team: the bots of this server and how many slash command slots are left. Prefix-only and hidden from !help. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('bots')
    .setDescription('Private control: the bots of this server and the slash command slots Petto has left.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) {
      return reply(interaction, `${EMOJI.DENY} This private control is not available to this account.`, 0xfe6465);
    }
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

    const { bots, complete } = await botsOf(interaction.guild);
    lines.push('', `**Bots in this server: ${bots.length}${complete ? '' : '+'}**`);
    if (!bots.length) lines.push('None found.');
    for (const member of bots.slice(0, MAX_BOTS_LISTED)) {
      const mine = member.id === client.user.id ? ' (Petto)' : '';
      const joined = member.joinedTimestamp ? ` · joined <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '';
      lines.push(`- ${member.user.tag ?? member.user.username} · \`${member.id}\`${mine}${joined}`);
    }
    if (bots.length > MAX_BOTS_LISTED) lines.push(`... and ${bots.length - MAX_BOTS_LISTED} more.`);
    if (!complete) lines.push('-# This server is big or its members could not be read: only the bots Petto already knows are listed.');
    return reply(interaction, lines.join('\n'), 0xa5ea7a, true);
  },
};

async function reply(interaction, content, color, deferred = false) {
  const payload = { components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 | (deferred ? 0 : MessageFlags.Ephemeral) };
  return deferred ? interaction.editReply(payload) : interaction.reply(payload);
}
