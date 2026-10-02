// The messages of quest alerts: a Components V2 card that servers can style (color, sections), or one of their saved
// embeds with the `{quest.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, TRACKER_URL, REWARD_LABELS } = require('./questApi');
const { templatePayload } = require('./templatedMessage');
const { EMOJI } = require('./emojis');

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

const REWARD_TYPES = { orbs: 'Virtual currency', decoration: 'Collectible', code: 'Code', ingame: 'In-game item', nitro: 'Nitro' };
const flagOf = (code) => (/^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '');
let regionNames = null;
function countryName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}
const clock = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const sec = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** The limits of a quest as lines for the card: the countries it is for, the ones it is not for, and the age. */
function limitLines(quest) {
  const lines = [];
  if (quest.regions.include.length) lines.push(`Users residing in ${quest.regions.include.map((code) => `${countryName(code)} ${flagOf(code)}`.trim()).join(', ')}`);
  else if (!quest.global && !quest.regions.exclude.length) lines.push('Users in some regions only');
  if (quest.regions.exclude.length) lines.push(`Not for users in ${quest.regions.exclude.map((code) => `${countryName(code)} ${flagOf(code)}`.trim()).join(', ')}`);
  if (quest.ageGate) lines.push('Users over 18 🔞');
  return lines;
}

const rewardLines = (quest) => quest.rewards.flatMap((reward) => {
  const lines = [`* \`🥇\` **Type:** ${REWARD_TYPES[reward.kind] ?? 'Reward'}`];
  if (reward.kind === 'orbs') lines.push(`* \`💸\` **Amount:** ${reward.amount} Orbs${reward.premiumAmount ? ` | ${EMOJI.QUEST_NITRO} ${reward.premiumAmount}` : ''}`);
  else lines.push(`* \`🔮\` **Name:** ${reward.name}`);
  if (reward.expiresAt) lines.push(`* \`⏰\` **Expires:** <t:${unix(reward.expiresAt)}:R>`);
  return lines;
});

/** The default Components V2 card: the quest as Discord's own quest bots show it, one block after another. */
function buildQuestCard(quest, config = {}, { kind = 'new', rolePing = null } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const container = new ContainerBuilder().setAccentColor(accentOf(quest, config));
  const title = `# ${EMOJI.QUEST_BADGE} [${kind === 'expiring' ? 'Ending soon: ' : ''}${quest.name}](${quest.url})`;
  container.addTextDisplayComponents(text(`${rolePing ? `-# ${rolePing}\n` : ''}${title}`));
  if (quest.image && !hidden.has('image')) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(quest.image)));
  container.addSeparatorComponents(divider());
  const info = [`- \`⏰\` **Starts:** <t:${unix(quest.startsAt)}:R> | **Ends:** <t:${unix(quest.expiresAt)}:R>`];
  if (!hidden.has('platforms') && quest.platforms.length) info.push(`- \`💿\` **Platforms:** ${quest.platforms.join(', ')}`);
  if (!hidden.has('tasks')) for (const task of quest.tasks.slice(0, 4)) info.push(`- \`🧫\` **Task:** ${task.label}${task.seconds ? ` (${clock(task.seconds)})` : ''}`);
  container.addTextDisplayComponents(text(info.join('\n')));
  if (!hidden.has('rewards') && quest.rewards.length) {
    container.addSeparatorComponents(divider());
    const reward = text(`## 🎁 Rewards\n${rewardLines(quest).join('\n')}`);
    const picture = quest.rewards.find((entry) => entry.image)?.image;
    if (picture) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(reward).setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
    else container.addTextDisplayComponents(reward);
  }
  const limits = limitLines(quest);
  if (!hidden.has('limits') && limits.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(`## ${EMOJI.QUEST_ALERT} Limitations\n${limits.map((line) => `* ${line}`).join('\n')}`));
  }
  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(text(CREDIT));
  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Accept Quest').setURL(quest.url)];
  if (quest.link) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Game page').setURL(quest.link));
  return { components: [container, new ActionRowBuilder().addComponents(buttons)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

const LIST_PAGE_SIZE = 6;

/** The list of active quests, in the same style, a page at a time. */
function buildQuestList(quests, { page = 1 } = {}) {
  const pages = Math.max(1, Math.ceil(quests.length / LIST_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const slice = quests.slice((current - 1) * LIST_PAGE_SIZE, current * LIST_PAGE_SIZE);
  const container = new ContainerBuilder().setAccentColor(0x5865f2);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJI.QUEST_BADGE} Active quests\n-# ${quests.length} quest${quests.length === 1 ? '' : 's'} · page ${current} of ${pages}`));
  for (const quest of slice) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const reward = quest.rewards.map((entry) => (entry.kind === 'orbs' ? `${entry.amount} Orbs${entry.premiumAmount ? ` | ${EMOJI.QUEST_NITRO} ${entry.premiumAmount}` : ''}` : entry.name)).join(', ') || 'Not listed';
    const flags = quest.regions.include.map(flagOf).filter(Boolean).join(' ');
    const body = new TextDisplayBuilder().setContent([
      `**[${quest.name}](${quest.url})**${quest.game && quest.game !== quest.name ? ` · ${quest.game}` : ''}`,
      `- \`🎁\` ${reward}`,
      `- \`🧫\` ${quest.tasks.map((task) => `${task.label}${task.seconds ? ` (${clock(task.seconds)})` : ''}`).join(' or ') || 'Not listed'}`,
      `- \`⏰\` Ends <t:${unix(quest.expiresAt)}:R>${flags ? ` · ${flags}` : ''}${quest.ageGate ? ' · 🔞' : ''}`,
    ].join('\n').slice(0, 900));
    if (quest.logo) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(body).setThumbnailAccessory(new ThumbnailBuilder().setURL(quest.logo)));
    else container.addTextDisplayComponents(body);
  }
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${pages > 1 ? `-# Use \`quests list ${current < pages ? current + 1 : 1}\` for another page\n` : ''}${CREDIT}`));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
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

module.exports = { SECTIONS, CREDIT, LIST_PAGE_SIZE, questContext, buildQuestCard, buildQuestList, questMessage, rewardText, taskText, limitsText };
