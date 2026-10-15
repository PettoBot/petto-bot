// The letters check inside Discord: a button in the verification DM shows a picture, and the member types the letters in a small form.
// The picture's ticket is kept in memory for a few minutes (a restart just asks for a new picture); five wrong answers lock it, as on the page.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../db/verificationConfig');
const { hasEverVerified } = require('../db/verificationRedemptions');
const captcha = require('../utils/verifyCaptcha');

const { TICKET_TTL_SECONDS } = captcha;
const { methodOf, inDiscord, usesLink } = require('../utils/verifyMethod');
const { createToken } = require('../utils/verifyToken');
const config = require('../config');
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
  return new ButtonBuilder().setCustomId(ids.start(guildId)).setLabel(t(lang, 'verify.letters.start.button')).setStyle(ButtonStyle.Primary);
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

const say = (interaction, text) => (interaction.replied || interaction.deferred ? interaction.followUp : interaction.reply).call(interaction, { components: [new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))], flags: flagsFor(interaction) });

/** Whether this member still has to verify in that server, with the settings; or `{ error }` with what to tell them. */
async function situation(client, guildId, userId, lang) {
  const guild = client.guilds.cache.get(guildId);
  const settings = guild ? await getConfig(guildId).catch(() => null) : null;
  if (!guild || !settings?.enabled || !inDiscord(methodOf(settings))) return { error: t(lang, 'verify.letters.notAsked') };
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
  const container = new ContainerBuilder().setAccentColor(0xffb86c)
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

/** The panel of a channel: what to do to get in, with a button for each way the server allows. */
function buildPanel({ guild, method, lang = currentLanguage() }) {
  const row = new ActionRowBuilder();
  if (usesLink(method)) row.addComponents(new ButtonBuilder().setCustomId(ids.link(guild.id)).setLabel(t(lang, 'verify.panel.link.button')).setStyle(method === 'letters' ? ButtonStyle.Secondary : ButtonStyle.Primary));
  if (inDiscord(method)) row.addComponents(startButton(guild.id, lang));
  const container = new ContainerBuilder().setAccentColor(0xffb86c)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, inDiscord(method) ? 'verify.panel.textLetters' : 'verify.panel.text', { server: guild.name })))
    .addActionRowComponents(row);
  return { components: [container], flags: V2 };
}

/** The personal link of a member, only for them (an answer only they see). */
async function sendLink(interaction, guildId, lang) {
  const guild = interaction.client.guilds.cache.get(guildId);
  const settings = guild ? await getConfig(guildId).catch(() => null) : null;
  if (!guild || !settings?.enabled || !usesLink(methodOf(settings))) return say(interaction, t(lang, 'verify.link.notUsed'));
  if (!config.verifyBaseUrl || !config.verifyTokenSecret) return say(interaction, t(lang, 'verify.link.notSetUp'));
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return say(interaction, t(lang, 'verify.letters.notMember'));
  if (settings.unverified_role_id && !member.roles.cache.has(settings.unverified_role_id) && await hasEverVerified(guildId, interaction.user.id).catch(() => false)) return say(interaction, t(lang, 'verify.letters.already'));
  return say(interaction, t(lang, 'verify.link.yours', { link: `${config.verifyBaseUrl}/verify/${createToken({ userId: interaction.user.id, guildId })}` }));
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

module.exports = { PREFIX, startButton, buildPanel, handleButton, handleModal, ids };
