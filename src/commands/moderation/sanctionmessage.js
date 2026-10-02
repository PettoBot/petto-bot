// Custom messages for sanctions: pick a saved embed template for what the sanctioned member receives, what is posted
// where the command was used, and the sanctions log entry, for one sanction type or for all of them (`default`).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const sanctionTemplates = require('../../db/sanctionTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const SLOT_LABELS = { dm: 'DM to the member', reply: 'reply where the command was used', log: 'sanctions log' };

const typeOption = (option) => option
  .setName('type')
  .setDescription('The sanction, or default for every sanction without its own message')
  .setRequired(true)
  .addChoices(...sanctionTemplates.TYPES.map((type) => ({ name: type, value: type })));
const slotChoices = [{ name: 'DM to the member', value: 'dm' }, { name: 'Reply where the command was used', value: 'reply' }, { name: 'Sanctions log entry', value: 'log' }];

module.exports = {
  aliases: ['sanctionmsg', 'sanctionmessages'],
  data: new SlashCommandBuilder()
    .setName('sanctionmessage')
    .setDescription('Use your own embed for the messages of sanctions (ban, kick, mute, warn, jail...).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s
      .setName('set')
      .setDescription('Use a saved embed for one message of a sanction.')
      .addStringOption(typeOption)
      .addStringOption((o) => o.setName('slot').setDescription('Which message').setRequired(true).addChoices(...slotChoices))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed (see /embed list)').setRequired(true)))
    .addSubcommand((s) => s
      .setName('clear')
      .setDescription('Go back to the usual message.')
      .addStringOption(typeOption)
      .addStringOption((o) => o.setName('slot').setDescription('Which message (default: all three)').setRequired(false).addChoices(...slotChoices)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the custom messages that are set.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const reply = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

    if (sub === 'list') {
      const all = await sanctionTemplates.listTemplates(interaction.guild.id, { force: true });
      const lines = [...all.entries()].map(([type, set]) => `**${type}** · ${Object.entries(SLOT_LABELS).filter(([slot]) => set[slot]).map(([slot, label]) => `${label}: \`${set[slot]}\``).join(' · ')}`);
      return reply(lines.length ? lines.join('\n') : 'No custom sanction messages are set. Use `sanctionmessage set`.', 0x4b4f59);
    }

    const type = interaction.options.getString('type', true).trim().toLowerCase();
    const slot = interaction.options.getString('slot')?.trim().toLowerCase() || null;
    if (!sanctionTemplates.TYPES.includes(type)) return reply(`Choose a type: ${sanctionTemplates.TYPES.map((t) => `\`${t}\``).join(', ')}.`, 0xfe6465);
    if ((slot || sub === 'set') && !SLOT_LABELS[slot]) return reply(`Choose a message: ${Object.keys(SLOT_LABELS).map((s) => `\`${s}\``).join(', ')}.`, 0xfe6465);

    if (sub === 'clear') {
      await sanctionTemplates.setTemplates(interaction.guild.id, type, slot ? { [slot]: null } : { dm: null, reply: null, log: null });
      return reply(`${EMOJI.APPROVE}  ${slot ? `The ${SLOT_LABELS[slot]}` : 'The custom messages'} of **${type}** ${slot ? 'goes' : 'go'} back to the usual message.`);
    }

    const name = interaction.options.getString('template', true);
    const doc = await getTemplate(interaction.guild.id, name).catch(() => null);
    if (!doc) return reply(`No saved embed named \`${name}\` was found. Make one in the dashboard, under Embeds.`, 0xfe6465);
    await sanctionTemplates.setTemplates(interaction.guild.id, type, { [slot]: doc.name });
    const note = slot === 'dm' ? ' The case number is not known yet when a ban or kick sends it.' : '';
    return reply(`${EMOJI.APPROVE}  The ${SLOT_LABELS[slot]} of **${type}** now uses \`${doc.name}\`. Its variables start with \`{case.…}\`.${note}`);
  },
};
