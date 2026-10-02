// The messages of quest alerts: a Components V2 card that servers can style (color, sections), or one of their saved
// embeds with the `{quest.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, TRACKER_URL, REWARD_LABELS } = require('./questApi');
const { templatePayload } = require('./templatedMessage');

const SECTIONS = ['image', 'rewards', 'tasks', 'platforms', 'limits'];
const CREDIT = `-# Data from [${SOURCE_NAME}](${SOURCE_URL}) and [discord-api-diff](${TRACKER_URL})`;

const unix = (date) => Math.floor(date.getTime() / 1000);
const minutes = (seconds) => (seconds >= 120 ? `${Math.round(seconds / 60)} min` : seconds ? `${seconds} s` : '');

function rewardText(quest) {
  return quest.rewards.map((reward) => (reward.kind === 'orbs' ? reward.name : `${reward.name} (${REWARD_LABELS[reward.kind] ?? 'Reward'})`)).join(', ') || 'Not listed';
}

function taskText(quest) {
  return quest.tasks.map((task) => `${task.label}${task.seconds ? ` (${minutes(task.seconds)})` : ''}`).join(' or ') || 'Not listed';
}

function limitsText(quest) {
  const parts = [];
  if (!quest.global && quest.regions.include.length) parts.push(`Only in ${quest.regions.include.join(', ')}`);
  if (quest.regions.exclude.length) parts.push(`Not in ${quest.regions.exclude.join(', ')}`);
  if (!quest.global && !quest.regions.include.length && !quest.regions.exclude.length) parts.push('Region restricted');
  if (quest.ageGate) parts.push('18+');
  return parts.join(' · ') || 'None';
}

/** What `{quest.*}` gives in a saved embed. */
function questContext(quest, kind = 'new') {
  const orbs = quest.rewards.find((reward) => reward.kind === 'orbs');
  const first = quest.rewards[0];
  return {
    id: quest.id,
    name: quest.name,
    game: quest.game,
    publisher: quest.publisher,
    url: quest.url,
    link: quest.link ?? '',
    image: quest.image ?? '',
    logo: quest.logo ?? '',
    color: quest.color,
    reward: rewardText(quest),
    reward_type: first ? (REWARD_LABELS[first.kind] ?? 'Reward') : '',
    reward_amount: orbs ? String(orbs.amount) : '',
    reward_image: first?.image ?? '',
    task: quest.tasks[0]?.label ?? '',
    task_minutes: quest.tasks[0]?.seconds ? String(Math.max(1, Math.round(quest.tasks[0].seconds / 60))) : '',
    tasks: taskText(quest),
    platforms: quest.platforms.join(', '),
    starts: `<t:${unix(quest.startsAt)}:R>`,
    starts_at: `<t:${unix(quest.startsAt)}:f>`,
    expires: `<t:${unix(quest.expiresAt)}:R>`,
    expires_at: `<t:${unix(quest.expiresAt)}:f>`,
    limits: limitsText(quest),
    age_gate: quest.ageGate ? '18+' : '',
    status: kind === 'expiring' ? 'Ending soon' : 'New quest',
    source: SOURCE_NAME,
  };
}

function accentOf(quest, config) {
  if (Number.isInteger(config.accent_color)) return config.accent_color;
  return parseInt(quest.color.slice(1), 16);
}

/** The default Components V2 card. */
function buildQuestCard(quest, config = {}, { kind = 'new', rolePing = null } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const container = new ContainerBuilder().setAccentColor(accentOf(quest, config));
  const head = new TextDisplayBuilder().setContent([`### ${kind === 'expiring' ? 'Ending soon: ' : ''}${quest.name}`, [quest.game, quest.publisher].filter(Boolean).join(' · ')].filter(Boolean).join('\n'));
  if (quest.logo) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(quest.logo)));
  else container.addTextDisplayComponents(head);
  if (quest.image && !hidden.has('image')) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(quest.image)));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const lines = [];
  if (!hidden.has('rewards')) lines.push(`**Reward:** ${rewardText(quest)}`);
  if (!hidden.has('tasks')) lines.push(`**Task:** ${taskText(quest)}`);
  if (!hidden.has('platforms') && quest.platforms.length) lines.push(`**Platforms:** ${quest.platforms.join(', ')}`);
  lines.push(`**Starts:** <t:${unix(quest.startsAt)}:R> · **Ends:** <t:${unix(quest.expiresAt)}:R>`);
  if (!hidden.has('limits')) lines.push(`**Limits:** ${limitsText(quest)}`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Accept Quest').setURL(quest.url)];
  if (quest.link) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Game page').setURL(quest.link));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(CREDIT));
  const components = [];
  if (rolePing) components.push(new TextDisplayBuilder().setContent(rolePing));
  components.push(container);
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

/** The message to send for a quest in a server: its saved embed when the style asks for one, else the card. */
async function questMessage(guild, config, quest, kind = 'new') {
  const rolePing = config.role_id ? `<@&${config.role_id}>` : null;
  if (config.style === 'template' && config.embed_template) {
    const payload = await templatePayload(guild.id, config.embed_template, { guild, quest: questContext(quest, kind) });
    if (payload) {
      const content = [rolePing, payload.content, CREDIT].filter(Boolean).join('\n');
      return { ...payload, content, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    }
  }
  return buildQuestCard(quest, config, { kind, rolePing });
}

module.exports = { SECTIONS, CREDIT, questContext, buildQuestCard, questMessage, rewardText, taskText, limitsText };
