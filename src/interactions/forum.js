// Forum support: what happens when a member opens a post. The button of the panel shows a form (the title, the description and the other
// questions); when it is sent, the member picks the tag (the type of inquiry) from the tags of the forum, and the post is made. A forum with no
// tag to pick skips that step. Every refusal is told to the member alone. The title and the description wait for the tag in memory for a few
// minutes (a small map, one entry per member who is picking), never in the database.
//   button  forum:open:<setup id>      the panel's button: checks, then the form
//   form    forum:modal:<setup id>     the title, the description and the answers
//   menu    forum:tags:<setup id>      the tags
//   button  forum:skip:<setup id>      post without a tag (when none is required)
//   button  forum:cancel:<setup id>    forget what was written
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, ChannelFlags } = require('discord.js');
const forumsDb = require('../db/forums');
const config = require('../utils/forumConfig');
const actions = require('../utils/forumActions');
const { ack } = require('../utils/interactionAck');
const { looksLikeImage } = require('../utils/ticketFormFields');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const PREFIX = 'forum:';
const DRAFT_TTL_MS = 10 * 60_000;
const MAX_DRAFTS = 300;

const drafts = new Map(); // `${guild}:${user}:${setup}` -> { title, description, entries, expiresAt }
const draftKey = (interaction, setupId) => `${interaction.guildId}:${interaction.user.id}:${setupId}`;

function sweep(now = Date.now()) {
  for (const [key, draft] of drafts) if (draft.expiresAt <= now) drafts.delete(key);
}

function saveDraft(key, draft, now = Date.now()) {
  sweep(now);
  // A full map drops the oldest entry: the members of that one press the button again.
  if (drafts.size >= MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
  drafts.set(key, { ...draft, expiresAt: now + DRAFT_TTL_MS });
}

function takeDraft(key, now = Date.now()) {
  const draft = drafts.get(key);
  drafts.delete(key);
  return draft && draft.expiresAt > now ? draft : null;
}

const isForumId = (customId) => typeof customId === 'string' && customId.startsWith(PREFIX);
const setupIdOf = (interaction) => interaction.customId.split(':')[2];
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** The setup of a button, or a reply that says why not (gone or turned off). */
async function loadSetup(interaction, lang) {
  const setup = await forumsDb.getSetupById(setupIdOf(interaction));
  if (!setup || setup.guild_id !== interaction.guildId) return { problem: t(lang, 'forums.refuse.gone') };
  if (!setup.enabled) return { problem: t(lang, 'forums.refuse.disabled') };
  return { setup };
}

/** The panel's button: the checks that do not need the form (who may open, how many, the forum itself), then the form. */
async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.guild || !interaction.member) { await interaction.reply(ephemeral(t(lang, 'forums.refuse.gone'))); return; }
  const { setup, problem } = await loadSetup(interaction, lang);
  if (problem) { await interaction.reply(ephemeral(`${EMOJI.WARNING} ${problem}`)); return; }
  const refused = await actions.refusalFor(setup, interaction.member, lang);
  if (refused) { await interaction.reply(ephemeral(`${EMOJI.WARNING} ${refused.message}`)); return; }
  const forum = await actions.fetchForum(interaction.guild, setup.forum_channel_id);
  if (!forum) { await interaction.reply(ephemeral(`${EMOJI.WARNING} ${t(lang, 'forums.error.forumGone')}`)); return; }
  await interaction.showModal(config.buildOpenModal(setup, { lang }));
}

/** The menu of the tags of a forum, and the buttons under it. */
function tagRows(setup, choices, { required, lang }) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}tags:${setup.id}`)
    .setPlaceholder(t(lang, 'forums.tags.placeholder.menu'))
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(setup.max_tags, choices.length)))
    .addOptions(choices.map((tag) => {
      const option = new StringSelectMenuOptionBuilder().setLabel(String(tag.name).slice(0, 100)).setValue(tag.id);
      if (tag.emoji?.id) option.setEmoji({ id: tag.emoji.id });
      else if (tag.emoji?.name) option.setEmoji({ name: tag.emoji.name });
      return option;
    }));
  const buttons = new ActionRowBuilder();
  if (!required) buttons.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}skip:${setup.id}`).setLabel(t(lang, 'forums.tags.skip.button')).setStyle(ButtonStyle.Secondary));
  buttons.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}cancel:${setup.id}`).setLabel(t(lang, 'forums.tags.cancel.button')).setStyle(ButtonStyle.Danger));
  return [new ActionRowBuilder().addComponents(menu), buttons];
}

/** Makes the post and tells the member where it is. */
async function createAndAnswer(interaction, { setup, draft, tagIds, lang, deps = {} }) {
  try {
    const { thread } = await actions.openPost({ guild: interaction.guild, setup, member: interaction.member, title: draft.title, description: draft.description, entries: draft.entries, tagIds, lang, deps });
    await interaction.editReply({ content: t(lang, 'forums.open.done', { emoji: EMOJI.APPROVE, post: `<#${thread.id}>` }), components: [], allowedMentions: { parse: [] } });
  } catch (error) {
    await interaction.editReply({ content: `${EMOJI.WARNING} ${actions.describeError(error, lang)}`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
    if (!error.userFacing) logger.error('Forum post could not be opened:', error);
  }
}

/** The form was sent: it is read and checked, then the tag is asked (or the post is made when there is nothing to pick). */
async function handleModal(interaction, deps = {}) {
  if (!(await ack(interaction))) return; // a late one: nobody to tell
  const lang = await languageOf(interaction);
  const fail = (text) => interaction.editReply({ content: `${EMOJI.WARNING} ${text}`, components: [], allowedMentions: { parse: [] } });
  if (!interaction.guild || !interaction.member) { await fail(t(lang, 'forums.refuse.gone')); return; }
  const { setup, problem } = await loadSetup(interaction, lang);
  if (problem) { await fail(problem); return; }

  const form = config.readOpenModal(setup, interaction.fields.fields, { lang });
  if (!form.title) { await fail(t(lang, 'forums.error.needsTitle')); return; }
  if (!form.description) { await fail(t(lang, 'forums.error.needsDescription')); return; }
  if (form.missing.length) { await fail(t(lang, 'forums.error.completeField', { field: form.missing[0] })); return; }
  const notImage = form.entries.find((entry) => entry.type === 'file' && entry.accept === 'images' && entry.value.some((file) => !looksLikeImage(file)));
  if (notImage) { await fail(t(lang, 'forums.error.notImage', { emoji: EMOJI.DENY, field: notImage.label, file: String(notImage.value.find((file) => !looksLikeImage(file)).name).slice(0, 60) })); return; }

  const refused = await actions.refusalFor(setup, interaction.member, lang, { deps });
  if (refused) { await fail(refused.message); return; }
  const forum = await actions.fetchForum(interaction.guild, setup.forum_channel_id);
  if (!forum) { await fail(t(lang, 'forums.error.forumGone')); return; }

  const canModerate = Boolean(forum.permissionsFor(interaction.member)?.has('ManageThreads'));
  const choices = config.tagChoices(forum, setup, { canModerate });
  const draft = { title: form.title, description: form.description, entries: form.entries };
  if (!choices.length) { await createAndAnswer(interaction, { setup, draft, tagIds: [], lang, deps }); return; }

  const required = Boolean(setup.require_tag || forum.flags?.has?.(ChannelFlags.RequireTag));
  saveDraft(draftKey(interaction, setup.id), draft);
  await interaction.editReply({ content: t(lang, required ? 'forums.tags.pickRequired' : 'forums.tags.pick', { title: form.title.slice(0, 80), max: setup.max_tags }), components: tagRows(setup, choices, { required, lang }), allowedMentions: { parse: [] } });
}

/** The tags were chosen: the post is made with them. */
async function handleSelect(interaction, deps = {}) {
  const lang = await languageOf(interaction);
  const key = draftKey(interaction, setupIdOf(interaction));
  await interaction.update({ content: t(lang, 'forums.tags.creating', { emoji: EMOJI.TICKET }), components: [] });
  const draft = takeDraft(key);
  const { setup, problem } = await loadSetup(interaction, lang);
  if (problem) { await interaction.editReply({ content: `${EMOJI.WARNING} ${problem}`, components: [] }); return; }
  if (!draft) { await interaction.editReply({ content: `${EMOJI.WARNING} ${t(lang, 'forums.error.expired')}`, components: [] }); return; }
  await createAndAnswer(interaction, { setup, draft, tagIds: interaction.values ?? [], lang, deps });
}

/** "Post without a tag" and "Cancel". */
async function handleButtonStep(interaction, deps = {}) {
  const lang = await languageOf(interaction);
  const step = interaction.customId.split(':')[1];
  const key = draftKey(interaction, setupIdOf(interaction));
  if (step === 'cancel') {
    takeDraft(key);
    await interaction.update({ content: t(lang, 'forums.tags.cancelled'), components: [] });
    return;
  }
  await interaction.update({ content: t(lang, 'forums.tags.creating', { emoji: EMOJI.TICKET }), components: [] });
  const draft = takeDraft(key);
  const { setup, problem } = await loadSetup(interaction, lang);
  if (problem) { await interaction.editReply({ content: `${EMOJI.WARNING} ${problem}`, components: [] }); return; }
  if (!draft) { await interaction.editReply({ content: `${EMOJI.WARNING} ${t(lang, 'forums.error.expired')}`, components: [] }); return; }
  await createAndAnswer(interaction, { setup, draft, tagIds: [], lang, deps });
}

/** Every component of the module goes through here (interactionCreate hands over what starts with `forum:`). */
async function handleInteraction(interaction, deps = {}) {
  const step = interaction.customId.split(':')[1];
  if (interaction.isButton() && step === 'open') return handleButton(interaction);
  if (interaction.isModalSubmit() && step === 'modal') return handleModal(interaction, deps);
  if (interaction.isStringSelectMenu() && step === 'tags') return handleSelect(interaction, deps);
  if (interaction.isButton() && (step === 'skip' || step === 'cancel')) return handleButtonStep(interaction, deps);
  return undefined;
}

module.exports = { PREFIX, isForumId, handleInteraction, handleButton, handleModal, handleSelect, handleButtonStep, drafts, saveDraft, takeDraft, sweep, DRAFT_TTL_MS, MAX_DRAFTS };
