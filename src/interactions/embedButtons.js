// What happens when a member clicks a button of an embed code (`{button: green && Label && role:@Role}`): the roles are
// given, taken or toggled, and a saved embed is shown to who clicked, in the channel or in their DMs.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { decodeCustomId } = require('../utils/embedActions');
const { manageable } = require('./responders');
const { describe } = require('../utils/responderEngine');
const { templatePayload } = require('../utils/templatedMessage');
const { t, languageOf } = require('../i18n');
const { sendDm } = require('../utils/dmOrigin');

// A button that posts in the channel can be clicked by anyone, so the same member waits a few seconds between posts.
const PUBLIC_COOLDOWN_MS = 5_000;
const lastPublic = new Map();

const say = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** The roles to give and take for this member: a toggled role is taken when the member has it and given when not. */
function planRoles(action, memberRoleIds) {
  const has = new Set(memberRoleIds);
  const add = new Set(action.add.filter((id) => !has.has(id)));
  const remove = new Set(action.remove.filter((id) => has.has(id)));
  for (const id of action.toggle) (has.has(id) ? remove : add).add(id);
  for (const id of add) remove.delete(id);
  return { add: [...add], remove: [...remove] };
}

/** Changes the roles. Returns the sentence that says what happened, or `{ stop: true }` once the click was answered with a problem. */
async function changeRoles(interaction, action, lang) {
  const plan = planRoles(action, [...interaction.member.roles.cache.keys()]);
  if (!plan.add.length && !plan.remove.length) return { text: '' };
  const add = manageable(interaction.guild, plan.add);
  const remove = manageable(interaction.guild, plan.remove);
  const changes = add.can.length || remove.can.length;
  if (changes && !interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await say(interaction, t(lang, 'automation.responder.needManageRoles'));
    return { stop: true };
  }
  if (!changes) {
    await say(interaction, t(lang, 'automation.responder.cannotGive'));
    return { stop: true };
  }
  let failed = false;
  const reason = t(lang, 'embeds.action.auditReason');
  if (add.can.length) await interaction.member.roles.add(add.can, reason).catch(() => { failed = true; });
  if (remove.can.length) await interaction.member.roles.remove(remove.can, reason).catch(() => { failed = true; });
  if (failed) {
    await say(interaction, t(lang, 'automation.responder.changeFailed'));
    return { stop: true };
  }
  const skipped = add.skipped.length + remove.skipped.length > 0;
  return { text: `${describe(add.can, remove.can, lang)}${skipped ? ` ${t(lang, 'automation.responder.someLeft')}` : ''}` };
}

/** Shows the saved embed the way the button asks. `summary` is what happened to the roles, said first when there is something to say. */
async function answerWithEmbed(interaction, embed, summary, lang) {
  const ctx = { guild: interaction.guild, member: interaction.member, user: interaction.user, channel: interaction.channel, lang };
  const loaded = await templatePayload(interaction.guild.id, embed.name, ctx);
  if (!loaded) return say(interaction, [summary, t(lang, 'embeds.action.embedGone', { name: embed.name })].filter(Boolean).join(' '));
  // `reactions` is for the senders that react to the message; it is not part of what Discord takes.
  const { reactions, ...payload } = loaded;
  const send = { ...payload, allowedMentions: { parse: [] } };

  if (embed.mode === 'public') {
    const key = `${interaction.user.id}:${interaction.channelId}`;
    if (Date.now() - (lastPublic.get(key) ?? 0) < PUBLIC_COOLDOWN_MS) return say(interaction, [summary, t(lang, 'embeds.action.slowDown')].filter(Boolean).join(' '));
    lastPublic.set(key, Date.now());
    if (lastPublic.size > 2000) lastPublic.clear();
    try {
      await interaction.channel.send(send);
    } catch {
      return say(interaction, t(lang, 'embeds.action.postFailed'));
    }
    return say(interaction, summary || t(lang, 'automation.responder.done'));
  }
  if (embed.mode === 'dm') {
    try {
      await sendDm(interaction.user, send, { guild: interaction.guild, kind: 'embed' });
    } catch {
      return say(interaction, [summary, t(lang, 'embeds.action.dmFailed')].filter(Boolean).join(' '));
    }
    return say(interaction, [summary, t(lang, 'embeds.action.dmSent')].filter(Boolean).join(' '));
  }
  const ephemeral = { ...send, flags: (send.flags ?? 0) | MessageFlags.Ephemeral };
  if (summary) {
    await say(interaction, summary);
    return interaction.followUp(ephemeral);
  }
  return interaction.reply(ephemeral);
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const action = decodeCustomId(interaction.customId);
  if (!action || !interaction.guild || !interaction.member) return say(interaction, t(lang, 'embeds.action.gone'));
  const roles = await changeRoles(interaction, action, lang);
  if (roles.stop) return undefined;
  if (action.embed) return answerWithEmbed(interaction, action.embed, roles.text, lang);
  return say(interaction, roles.text || t(lang, 'automation.responder.nothing'));
}

module.exports = { handleButton, planRoles };
