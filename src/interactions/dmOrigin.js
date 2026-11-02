// The three small buttons under every direct message of Petto (utils/dmOrigin.js): about it, delete it, report it to the Petto team.
// They work in the direct messages, where an interaction has no server and no member: nothing here reads `interaction.guild` or `interaction.member`
// to do anything. The server in the custom id is only used to look up what is public about it (the cache of the bot); it never decides who may do
// something. What decides is that the message is one of Petto's own, in the direct messages of the person who pressed.
const {
  ChannelType, CheckboxBuilder, LabelBuilder, MessageFlags, ModalBuilder, SectionBuilder, SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder,
  TextInputBuilder, TextInputStyle, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
} = require('discord.js');
const { t, languageOf } = require('../i18n');
const { EMOJI } = require('../utils/emojis');
const { plainCard } = require('../utils/plainCard');
const { dmCategoryOptions, DM_ABUSE } = require('../utils/reportCategories');
const { LIMITS, submitDmReport } = require('../utils/dmReports');
const { MODAL_PREFIX, PREFIX, customId, kindOf, parseCustomId, safeName } = require('../utils/dmOrigin');
const logger = require('../utils/logger');

const V2 = MessageFlags.IsComponentsV2;
const NO_MENTIONS = { parse: [] };
const STOP_LINES = new Set(['welcome', 'level', 'security']); // the kinds that have a switch of their own; the others say there is none
const FIELDS = Object.freeze({ category: 'dm_category', details: 'dm_details', remove: 'dm_delete' });

// A refusal starts with the "denied" icon, which is what makes its card red.
const denial = (text) => ({ ...plainCard(`${EMOJI.DENY} ${text}`), allowedMentions: NO_MENTIONS });
const refuse = (interaction, text) => interaction.reply(denial(text));

/** The message is one of Petto's, in a direct-message channel, and the person who pressed is the one that channel belongs to. */
async function isOwnDm(interaction, message = interaction.message) {
  if (interaction.guildId || interaction.guild || interaction.member) return false;
  if (message?.author?.id !== interaction.client?.user?.id) return false;
  const channel = interaction.channel;
  const recipient = channel?.recipientId ?? channel?.recipient?.id;
  if (recipient) return recipient === interaction.user?.id && (channel.type === undefined || channel.type === ChannelType.DM);
  const dm = await interaction.user?.createDM?.().catch(() => null);
  return Boolean(dm) && dm.id === interaction.channelId;
}

/** Why the buttons cannot be used here (a text), or null when they can. */
async function refusalFor(interaction, lang) {
  if (interaction.guildId || interaction.guild || interaction.member) return t(lang, 'dm.error.server');
  if (!(await isOwnDm(interaction))) return t(lang, 'dm.error.notYours');
  return null;
}

/** What is public about the server (its name, icon, ID, creation date and number of members) and why the message was sent. */
function infoReply({ guild, guildId, kind, lang }) {
  const lines = [t(lang, 'dm.info.title', { emoji: EMOJI.INFO })];
  const facts = [];
  let icon = null;
  if (guildId && guild) {
    facts.push(t(lang, 'dm.info.server', { name: safeName(guild.name, t(lang, 'dm.origin.unknownServer')) }));
    facts.push(t(lang, 'dm.info.id', { id: guild.id }));
    if (guild.createdTimestamp) facts.push(t(lang, 'dm.info.created', { time: Math.floor(guild.createdTimestamp / 1000) }));
    if (Number.isFinite(guild.memberCount)) facts.push(t(lang, 'dm.info.members', { count: guild.memberCount.toLocaleString(lang === 'pt-BR' ? 'pt-BR' : lang === 'es' ? 'es-419' : 'en-US') }));
    facts.push(t(lang, 'dm.info.reason', { reason: t(lang, `dm.kind.${kind}`) }));
    facts.push(t(lang, 'dm.info.behalf'));
    facts.push(t(lang, `dm.stop.${STOP_LINES.has(kind) ? kind : 'default'}`));
    try { icon = guild.iconURL?.({ size: 128 }) ?? null; } catch { icon = null; }
  } else if (guildId) {
    facts.push(t(lang, 'dm.info.id', { id: guildId }), t(lang, 'dm.info.gone'));
  } else {
    facts.push(t(lang, 'dm.info.petto'));
    if (kind === 'team') facts.push(t(lang, 'dm.kind.team'));
  }
  const container = new ContainerBuilder();
  const head = new TextDisplayBuilder().setContent(lines.join('\n'));
  const body = new TextDisplayBuilder().setContent(facts.join('\n'));
  if (icon) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head, body).setThumbnailAccessory(new ThumbnailBuilder().setURL(icon)));
  else container.addTextDisplayComponents(head, body);
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'dm.info.buttons')}\n-# ${t(lang, 'dm.info.dismiss')}`));
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(customId('delete', guildId ? { id: guildId } : null, 'notice')).setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.DELETE));
  return { components: [container, row], flags: V2, allowedMentions: NO_MENTIONS };
}

/** The form that reports a message to the Petto team: the notice, the paragraph that says it does not go to the moderators, the category, the details and the switch. */
function buildReportModal({ guildId, kind, messageId, lang }) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${guildId ?? '0'}:${kindOf(kind)}:${messageId}`)
    .setTitle(t(lang, 'dm.report.title'))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${EMOJI.WARNING} ${t(lang, 'dm.report.notice')}`),
      new TextDisplayBuilder().setContent(t(lang, 'dm.report.notModerators')),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t(lang, 'dm.report.category.label'))
        .setDescription(t(lang, 'dm.report.category.help'))
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELDS.category)
            .setPlaceholder(t(lang, 'dm.report.category.placeholder'))
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(dmCategoryOptions(lang).map((option) => ({ ...option, default: option.value === DM_ABUSE }))),
        ),
      new LabelBuilder()
        .setLabel(t(lang, 'dm.report.details.label'))
        .setDescription(t(lang, 'dm.report.details.help'))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELDS.details)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(LIMITS.min)
            .setMaxLength(LIMITS.max)
            .setPlaceholder(t(lang, 'dm.report.details.placeholder')),
        ),
      new LabelBuilder()
        .setLabel(t(lang, 'dm.report.delete.label'))
        .setCheckboxComponent(new CheckboxBuilder().setCustomId(FIELDS.remove)),
    );
}

/** The three buttons: `dminfo:`, `dmdel:` and `dmrep:`. */
async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return refuse(interaction, t(lang, 'dm.error.unknown'));
  const why = await refusalFor(interaction, lang);
  if (why) return refuse(interaction, why);

  if (parsed.action === 'info') {
    const guild = parsed.guildId ? interaction.client.guilds?.cache?.get(parsed.guildId) ?? null : null;
    return interaction.reply(infoReply({ guild, guildId: parsed.guildId, kind: parsed.kind, lang }));
  }
  if (parsed.action === 'delete') {
    await interaction.deferUpdate();
    const deleted = await interaction.message.delete().then(() => true, (error) => { logger.warn({ action: 'dm-origin' }, `A direct message could not be deleted: ${error.message}`); return false; });
    if (!deleted) await interaction.followUp(denial(t(lang, 'dm.error.deleteFailed'))).catch(() => {});
    return null;
  }
  return interaction.showModal(buildReportModal({ guildId: parsed.guildId, kind: parsed.kind, messageId: interaction.message.id, lang }));
}

const readCheckbox = (fields, id) => { try { return fields.getCheckbox(id) === true; } catch { return false; } };

/** The submitted report form (`dmrepm:<guildId>:<kind>:<messageId>`). */
async function handleModal(interaction) {
  const lang = await languageOf(interaction);
  const match = /^dmrepm:(\d{1,25}):([a-z_]{1,16}):(\d{15,25})$/.exec(interaction.customId);
  if (!match) return refuse(interaction, t(lang, 'dm.error.unknown'));
  const [, rawGuildId, rawKind, messageId] = match;
  if (interaction.guildId || interaction.guild || interaction.member) return refuse(interaction, t(lang, 'dm.error.server'));

  await interaction.deferReply();
  const reply = (text) => interaction.editReply({ ...plainCard(text), allowedMentions: NO_MENTIONS });
  const fail = (text) => interaction.editReply(denial(text));

  const dm = interaction.channel ?? await interaction.user.createDM().catch(() => null);
  const message = await dm?.messages?.fetch?.(messageId).catch(() => null);
  // The same rule as the buttons: a message of Petto, in the direct messages of the person who sends the report.
  if (!message || !(await isOwnDm(interaction, message))) return fail(t(lang, 'dm.error.notYours'));

  const guildId = rawGuildId === '0' ? null : rawGuildId;
  const cached = guildId ? interaction.client.guilds?.cache?.get(guildId) ?? null : null;
  const result = await submitDmReport({
    client: interaction.client,
    user: interaction.user,
    message,
    guild: guildId ? { id: guildId, name: cached?.name ?? null } : null,
    kind: kindOf(rawKind),
    category: interaction.fields.getStringSelectValues(FIELDS.category)?.[0],
    details: interaction.fields.getTextInputValue(FIELDS.details),
    deleteAfter: readCheckbox(interaction.fields, FIELDS.remove),
  });
  if (result.ok) return reply(`${t(lang, 'dm.report.sent', { emoji: EMOJI.APPROVE, id: result.id })}${result.deleted ? `\n${t(lang, 'dm.report.deleted')}` : ''}`);
  const key = { tooShort: 'dm.report.tooShort', badCategory: 'dm.report.badCategory', limit: 'dm.report.limit', duplicate: 'dm.report.duplicate' }[result.reason] ?? 'dm.report.failed';
  return fail(t(lang, key, { min: LIMITS.min, max: result.max ?? LIMITS.perHour, minutes: result.minutes ?? 60 }));
}

const isDmOriginId = (id) => Object.values(PREFIX).some((prefix) => String(id).startsWith(`${prefix}:`));

module.exports = { FIELDS, isDmOriginId, isOwnDm, infoReply, buildReportModal, handleButton, handleModal };
