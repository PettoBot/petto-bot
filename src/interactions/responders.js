// What happens when a member clicks a button responder or picks a choice of a panel menu: the requirement is checked,
// the roles are given or taken, and the answer is a private message.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const respondersDb = require('../db/responders');
const { planRoles, exclusiveRemovals, describe, BUTTON_PREFIX, SELECT_PREFIX } = require('../utils/responderEngine');
const { templatePayload } = require('../utils/templatedMessage');
const { resolve } = require('../utils/embedVariables');
const { emojiOf } = require('../utils/responderEngine');
const { t, languageOf } = require('../i18n');

const say = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Roles the bot is able to give or take: they exist, are not managed by an integration and are below the bot's highest role. */
function manageable(guild, ids) {
  const top = guild.members.me?.roles.highest.position ?? 0;
  const can = [];
  const skipped = [];
  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (role && !role.managed && role.position < top) can.push(id);
    else skipped.push(id);
  }
  return { can, skipped };
}

/** The answer sent in another channel (the one the button was set up with), with a short private note to who clicked. */
async function answerElsewhere(interaction, responder, text, ctx, lang) {
  const channel = await interaction.guild.channels.fetch(responder.send_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  let payload = responder.reply_template ? await templatePayload(interaction.guild.id, responder.reply_template, ctx) : null;
  if (!payload) payload = { content: (responder.reply ? (await resolve(responder.reply, ctx)).slice(0, 2000) : text) || t(lang, 'automation.responder.done') };
  try {
    await channel.send({ ...payload, allowedMentions: { parse: [] } });
  } catch {
    await say(interaction, t(lang, 'automation.responder.sendFailed', { channel: `<#${channel.id}>` }));
    return true;
  }
  await say(interaction, t(lang, 'automation.responder.sentIn', { channel: `<#${channel.id}>` }));
  return true;
}

async function answer(interaction, responder, text, lang) {
  const ctx = { guild: interaction.guild, member: interaction.member, user: interaction.user, channel: interaction.channel };
  if (responder.send_channel_id) {
    // False when the channel is gone: the answer is then private, as without the setting.
    if (await answerElsewhere(interaction, responder, text, ctx, lang)) return undefined;
  }
  if (responder.reply_template) {
    const payload = await templatePayload(interaction.guild.id, responder.reply_template, ctx);
    if (payload) return interaction.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (responder.reply) return say(interaction, (await resolve(responder.reply, ctx)).slice(0, 2000) || t(lang, 'automation.responder.done'));
  return say(interaction, text || t(lang, 'automation.responder.done'));
}

/** What a button can do to the message it is on: add a reaction to it, and delete it. The answer was already sent. */
async function actOnHostMessage(interaction, responder) {
  const message = interaction.message;
  if (!message) return;
  if (responder.react_emoji) {
    const emoji = emojiOf(responder.react_emoji);
    if (emoji) await message.react(typeof emoji === 'string' ? emoji : `${emoji.name}:${emoji.id}`).catch(() => null);
  }
  if (responder.delete_message) await message.delete().catch(() => null);
}

/** Runs one responder for the member who clicked. `alsoRemove` are extra roles to take (the other choices of an exclusive menu). */
async function run(interaction, responder, alsoRemove, lang) {
  const member = interaction.member;
  const plan = planRoles(responder, [...member.roles.cache.keys()]);
  if (plan.denied) return say(interaction, t(lang, 'automation.responder.needRole', { roles: responder.required_role_ids.map((id) => `<@&${id}>`).join(', ') }));

  const guild = interaction.guild;
  const myPermissions = guild.members.me?.permissions;
  const add = manageable(guild, plan.add);
  const remove = manageable(guild, [...new Set([...plan.remove, ...alsoRemove])]);
  const touches = add.can.length || remove.can.length;
  const blocked = add.skipped.length + remove.skipped.length > 0;
  if ((add.can.length || remove.can.length) && !myPermissions?.has(PermissionFlagsBits.ManageRoles)) return say(interaction, t(lang, 'automation.responder.needManageRoles'));

  let failed = false;
  const reason = t(lang, 'automation.responder.auditReason', { name: responder.name });
  if (add.can.length) await member.roles.add(add.can, reason).catch(() => { failed = true; });
  if (remove.can.length) await member.roles.remove(remove.can, reason).catch(() => { failed = true; });
  if (failed) return say(interaction, t(lang, 'automation.responder.changeFailed'));
  if (blocked && !touches && !responder.reply && !responder.reply_template) return say(interaction, t(lang, 'automation.responder.cannotGive'));

  const summary = describe(add.can, remove.can, lang);
  const result = await answer(interaction, responder, `${summary || t(lang, 'automation.responder.nothing')}${blocked && summary ? ` ${t(lang, 'automation.responder.someLeft')}` : ''}`, lang);
  await actOnHostMessage(interaction, responder);
  return result;
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const responder = await respondersDb.getById(interaction.customId.slice(BUTTON_PREFIX.length));
  if (!responder || responder.guild_id !== interaction.guild?.id) return say(interaction, t(lang, 'automation.responder.buttonGone'));
  return run(interaction, responder, [], lang);
}

async function handleSelect(interaction) {
  const lang = await languageOf(interaction);
  const panel = await respondersDb.getPanelById(interaction.customId.slice(SELECT_PREFIX.length));
  if (!panel || panel.guild_id !== interaction.guild?.id) return say(interaction, t(lang, 'automation.responder.menuGone'));
  const chosenId = interaction.values[0];
  if (!chosenId) return interaction.deferUpdate();
  const all = (await respondersDb.listResponders(interaction.guild.id)).filter((responder) => panel.responders.includes(responder.name));
  const chosen = all.find((responder) => String(responder.id) === chosenId);
  if (!chosen) return say(interaction, t(lang, 'automation.responder.choiceGone'));
  const extra = panel.exclusive ? exclusiveRemovals(chosen, all, [...interaction.member.roles.cache.keys()]) : [];
  return run(interaction, chosen, extra, lang);
}

module.exports = { handleButton, handleSelect, manageable };
