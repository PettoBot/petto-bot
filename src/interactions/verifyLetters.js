// The letters check inside Discord: a button in the verification DM shows a picture, and the member types the letters in a small form.
// The picture's ticket is kept in memory for a few minutes (a restart just asks for a new picture); five wrong answers lock it, as on the page.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { getConfig } = require('../db/verificationConfig');
const { hasEverVerified } = require('../db/verificationRedemptions');
const captcha = require('../utils/verifyCaptcha');

const { TICKET_TTL_SECONDS } = captcha;
const { methodOf, usesLink } = require('../utils/verifyMethod');
const config = require('../config');
const { verifyLinkFor, baseUrl, lettersInstead, canDoLetters } = require('../utils/verifyLink');
const { applyVerification } = require('../utils/verifyApply');
const logger = require('../utils/logger');
const { t, guildLanguage, currentLanguage } = require('../i18n');

const PREFIX = 'vfy';
const ids = { start: (guildId) => `${PREFIX}:start:${guildId}`, type: (guildId) => `${PREFIX}:type:${guildId}`, answer: (guildId) => `${PREFIX}:answer:${guildId}`, link: (guildId) => `${PREFIX}:link:${guildId}`, again: (guildId) => `${PREFIX}:again:${guildId}` };
const V2 = MessageFlags.IsComponentsV2;

const tickets = new Map(); // `${guildId}:${userId}` -> { ticket, jti, until }
const key = (guildId, userId) => `${guildId}:${userId}`;

/** The button of the verification DM that starts the letters check. */
function startButton(guildId, lang = currentLanguage()) {
  return new ButtonBuilder().setCustomId(ids.start(guildId)).setLabel(t(lang, 'verify.letters.start.button')).setEmoji('🔤').setStyle(ButtonStyle.Primary);
}


/** The picture of the server for the cards (its icon), or Petto's when it has none, or null. */
function serverPicture(guild) {
  const icon = typeof guild?.iconURL === 'function' ? guild.iconURL({ size: 128, extension: 'png' }) : null;
  if (icon) return icon;
  const base = baseUrl();
  return base ? `${base}/assets/favicon.png` : null;
}

/** Text with the picture of the server beside it when there is one. */
function withPicture(container, text, picture) {
  const display = new TextDisplayBuilder().setContent(text);
  if (picture) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(display).setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
  else container.addTextDisplayComponents(display);
  return container;
}

// In a server channel (the verification panel) the answers are only for the member who pressed the button; in the DM there is no one else.
const flagsFor = (interaction) => (interaction.inGuild?.() ? V2 | MessageFlags.Ephemeral : V2);
/** The same components with every button turned off (and the tree of a Components V2 message kept as it is). */
function withButtonsOff(node) {
  const copy = { ...node };
  if (copy.type === 2) copy.disabled = true;
  if (Array.isArray(copy.components)) copy.components = copy.components.map(withButtonsOff);
  return copy;
}

/** After a right answer: the message with the picture keeps its picture but its buttons are off. Does nothing when the form was not opened from it. */
async function lockPicture(interaction) {
  try {
    if (!interaction.isFromMessage?.() || !interaction.message?.components?.length) return false;
    const components = interaction.message.components.map((component) => withButtonsOff(component.toJSON?.() ?? component));
    await interaction.update({ components });
    return true;
  } catch (err) {
    logger.warn(`The picture of a verification could not be locked: ${err.message}`);
    return false;
  }
}

const reply = (interaction, container) => (interaction.replied || interaction.deferred ? interaction.followUp : interaction.reply).call(interaction, { components: [container], flags: flagsFor(interaction) });
const say = (interaction, text) => reply(interaction, new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)));

/** Whether this member still has to verify in that server, with the settings; or `{ error }` with what to tell them. */
async function situation(client, guildId, userId, lang) {
  const guild = client.guilds.cache.get(guildId);
  const settings = guild ? await getConfig(guildId).catch(() => null) : null;
  if (!guild || !settings?.enabled || !canDoLetters(methodOf(settings))) return { error: t(lang, 'verify.letters.notAsked') };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { error: t(lang, 'verify.letters.notMember') };
  if (settings.unverified_role_id && !member.roles.cache.has(settings.unverified_role_id) && await hasEverVerified(guildId, userId).catch(() => false)) return { error: t(lang, 'verify.letters.already') };
  return { guild, member, settings };
}

/**
 * Sends a picture with the buttons to type the letters or to get another one. `replace` is for the button of a picture that is already
 * there (New picture): the same message gets the new picture, so asking again never piles up messages.
 */
async function showPicture(interaction, guildId, lang, { replace = false } = {}) {
  const state = await situation(interaction.client, guildId, interaction.user.id, lang);
  if (state.error) return say(interaction, state.error);
  const jti = `dc:${guildId}:${interaction.user.id}`;
  const challenge = captcha.createChallenge(jti);
  tickets.set(key(guildId, interaction.user.id), { ticket: challenge.ticket, jti, until: Date.now() + TICKET_TTL_SECONDS * 1000 });
  if (tickets.size > 2_000) tickets.delete(tickets.keys().next().value);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'verify.letters.picture', { server: state.guild.name, minutes: Math.round(TICKET_TTL_SECONDS / 60) })))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://verify.png')))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ids.type(guildId)).setLabel(t(lang, 'verify.letters.type.button')).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(ids.again(guildId)).setLabel(t(lang, 'verify.letters.again.button')).setStyle(ButtonStyle.Secondary),
    ));
  const file = new AttachmentBuilder(challenge.png, { name: 'verify.png' });
  if (replace && interaction.isButton?.()) return interaction.update({ components: [container], files: [file], attachments: [] });
  return interaction.reply({ components: [container], files: [file], flags: flagsFor(interaction) });
}

/**
 * The panel of a channel: what to do to get in, with a button for each way the server allows. The server's name and icon on top, three
 * short steps, the buttons (with an emoji) and a note at the bottom. When the link cannot be given, the letters inside Discord take its place.
 */
function buildPanel({ guild, method, lang = currentLanguage() }) {
  const letters = canDoLetters(method);
  const link = usesLink(method) && !lettersInstead(method);
  const row = new ActionRowBuilder();
  if (link || !letters) row.addComponents(new ButtonBuilder().setCustomId(ids.link(guild.id)).setLabel(t(lang, 'verify.panel.link.button')).setEmoji('🔗').setStyle(letters ? ButtonStyle.Secondary : ButtonStyle.Primary));
  if (letters) row.addComponents(startButton(guild.id, lang));
  const steps = link && letters ? 'both' : letters ? 'letters' : 'link';
  const text = [t(lang, 'verify.panel.title'), t(lang, 'verify.panel.welcome', { server: guild.name }), '', t(lang, `verify.panel.steps.${steps}`)].join('\n');
  const container = withPicture(new ContainerBuilder(), text, serverPicture(guild))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(row)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'verify.panel.footer')));
  return { components: [container], flags: V2 };
}

/**
 * The personal link of a member, only for them (an answer only they see): a card with a link button, when it expires, and the address
 * written out in case the button does not open. When the link cannot be given, the letters inside Discord instead (or why not).
 */
async function sendLink(interaction, guildId, lang) {
  const guild = interaction.client.guilds.cache.get(guildId);
  const settings = guild ? await getConfig(guildId).catch(() => null) : null;
  if (!guild || !settings?.enabled || !usesLink(methodOf(settings))) return say(interaction, t(lang, 'verify.link.notUsed'));
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return say(interaction, t(lang, 'verify.letters.notMember'));
  if (settings.unverified_role_id && !member.roles.cache.has(settings.unverified_role_id) && await hasEverVerified(guildId, interaction.user.id).catch(() => false)) return say(interaction, t(lang, 'verify.letters.already'));
  const made = verifyLinkFor(interaction.user.id, guildId);
  if (!made.url) {
    if (!config.verifyTokenSecret) return say(interaction, t(lang, 'verify.link.notSetUp'));
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'verify.link.useLetters')))
      .addActionRowComponents(new ActionRowBuilder().addComponents(startButton(guildId, lang)));
    return reply(interaction, container);
  }
  const text = [t(lang, 'verify.link.title'), t(lang, 'verify.link.body', { server: guild.name, expires: `<t:${made.expiresAt}:R>` })].join('\n');
  const container = withPicture(new ContainerBuilder(), text, serverPicture(guild))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(made.url).setLabel(t(lang, 'verify.link.open')).setEmoji('🔗')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'verify.link.fallback', { link: made.url })));
  return reply(interaction, container);
}

async function handleButton(interaction) {
  const [, action, guildId] = interaction.customId.split(':');
  if (!/^\d{15,25}$/.test(guildId ?? '')) return undefined;
  // Pressed in a DM there is no server around: the answer is in the language of the server being verified for.
  const lang = await guildLanguage(guildId);
  if (action === 'start') return showPicture(interaction, guildId, lang);
  if (action === 'again') return showPicture(interaction, guildId, lang, { replace: true });
  if (action === 'link') return sendLink(interaction, guildId, lang);
  if (action === 'type') {
    const modal = new ModalBuilder().setCustomId(ids.answer(guildId)).setTitle(t(lang, 'verify.letters.modal.title'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('letters').setLabel(t(lang, 'verify.letters.modal.label')).setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(12).setRequired(true)));
    return interaction.showModal(modal);
  }
  return undefined;
}

async function handleModal(interaction) {
  const guildId = interaction.customId.split(':')[2];
  if (!/^\d{15,25}$/.test(guildId ?? '')) return undefined;
  const lang = await guildLanguage(guildId);
  const state = await situation(interaction.client, guildId, interaction.user.id, lang);
  if (state.error) return say(interaction, state.error);
  const kept = tickets.get(key(guildId, interaction.user.id));
  if (!kept || kept.until < Date.now()) return say(interaction, t(lang, 'verify.letters.expired'));
  const result = captcha.checkAnswer(kept.jti, kept.ticket, interaction.fields.getTextInputValue('letters'));
  if (!result.ok) {
    if (result.reason === 'locked') return say(interaction, t(lang, 'verify.letters.locked'));
    tickets.delete(key(guildId, interaction.user.id));
    return say(interaction, t(lang, 'verify.letters.wrong'));
  }
  tickets.delete(key(guildId, interaction.user.id));
  try {
    const applied = await applyVerification({ client: interaction.client, guild: state.guild, member: state.member, settings: state.settings, jti: `dc${Date.now().toString(36)}${state.member.id}` });
    // The picture that was answered stops being usable: its buttons are locked, so nobody asks for another one once verified.
    await lockPicture(interaction);
    return say(interaction, applied.ok ? t(lang, 'verify.letters.done', { server: state.guild.name }) : t(lang, 'verify.letters.already'));
  } catch (err) {
    logger.error('Failed to apply verification roles (letters in Discord):', err);
    return say(interaction, t(lang, 'verify.letters.rolesFailed'));
  }
}

/** Whether a message is a verification panel of this server (it has its link or letters button): to find a second copy and remove it. */
function isPanelMessage(message, guildId) {
  const wanted = new Set([ids.link(guildId), ids.start(guildId)]);
  const walk = (node) => {
    if (!node) return false;
    const data = node.toJSON?.() ?? node.data ?? node;
    if (wanted.has(data.custom_id ?? data.customId)) return true;
    return (node.components ?? data.components ?? []).some(walk);
  };
  return (message?.components ?? []).some(walk);
}

module.exports = { PREFIX, startButton, buildPanel, handleButton, handleModal, ids, canDoLetters, isPanelMessage };
