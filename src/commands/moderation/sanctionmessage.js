// Custom messages for sanctions: pick a saved embed template for what the sanctioned member receives, what is posted
// where the command was used, and the sanctions log entry, for one sanction type or for all of them (`default`).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const sanctionTemplates = require('../../db/sanctionTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

// The three messages of a sanction; each has its label and its sentences under `moderation.sanctionMessage.*.<slot>`.
const SLOTS = ['dm', 'reply', 'log'];

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
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed (see /embed list). Leave it empty to see the saved embeds').setRequired(false)))
    .addSubcommand((s) => s
      .setName('clear')
      .setDescription('Go back to the usual message.')
      .addStringOption(typeOption)
      .addStringOption((o) => o.setName('slot').setDescription('Which message (default: all three)').setRequired(false).addChoices(...slotChoices)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the custom messages that are set.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const reply = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

    if (sub === 'list') {
      const all = await sanctionTemplates.listTemplates(interaction.guild.id, { force: true });
      const lines = [...all.entries()].map(([type, set]) => `**${type}** · ${SLOTS.filter((slot) => set[slot]).map((slot) => t(lang, 'moderation.sanctionMessage.listEntry', { label: t(lang, `moderation.sanctionMessage.slot.${slot}`), name: set[slot] })).join(' · ')}`);
      return reply(lines.length ? lines.join('\n') : t(lang, 'moderation.sanctionMessage.none'));
    }

    const type = interaction.options.getString('type', true).trim().toLowerCase();
    const slot = interaction.options.getString('slot')?.trim().toLowerCase() || null;
    if (!sanctionTemplates.TYPES.includes(type)) return reply(t(lang, 'moderation.sanctionMessage.chooseType', { list: sanctionTemplates.TYPES.map((name) => `\`${name}\``).join(', ') }), 0xfe6465);
    if ((slot || sub === 'set') && !SLOTS.includes(slot)) return reply(t(lang, 'moderation.sanctionMessage.chooseSlot', { list: SLOTS.map((name) => `\`${name}\``).join(', ') }), 0xfe6465);

    if (sub === 'clear') {
      await sanctionTemplates.setTemplates(interaction.guild.id, type, slot ? { [slot]: null } : { dm: null, reply: null, log: null });
      return reply(t(lang, `moderation.sanctionMessage.cleared.${slot ?? 'all'}`, { emoji: EMOJI.APPROVE, type }));
    }

    const name = String(interaction.options.getString('template') ?? '').trim();
    if (!name) {
      const { templateHint } = require('../../utils/templateHint');
      return reply(await templateHint(interaction.guild.id, { usage: `sanctionmessage set ${type} ${slot} <name>`, what: t(lang, `moderation.sanctionMessage.what.${slot}`, { type }), lang }));
    }
    const doc = await getTemplate(interaction.guild.id, name).catch(() => null);
    if (!doc) return reply(t(lang, 'moderation.sanctionMessage.noEmbed', { name }), 0xfe6465);
    await sanctionTemplates.setTemplates(interaction.guild.id, type, { [slot]: doc.name });
    return reply(t(lang, `moderation.sanctionMessage.set.${slot}`, { emoji: EMOJI.APPROVE, type, name: doc.name }));
  },
};
