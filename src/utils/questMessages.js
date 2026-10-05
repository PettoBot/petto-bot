// The messages of quest alerts: a Components V2 card that servers can style (color, sections), or one of their saved
// embeds with the `{quest.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, TRACKER_URL, REWARD_LABELS } = require('./questApi');
const { templatePayload } = require('./templatedMessage');
const { EMOJI } = require('./emojis');
const { withRewardImages } = require('./questImages');

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
  return Number.isInteger(config.accent_color) ? config.accent_color : null;
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

const BUTTON_URL_MAX = 512;
const MEDIA_URL_MAX = 2048;
/** A web address a link button can carry: http(s) and at most 512 characters. */
function buttonUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= BUTTON_URL_MAX;
}
/** A web address a picture can use: http(s) and at most 2048 characters. */
function mediaUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= MEDIA_URL_MAX ? url : null;
}

/** The default Components V2 card: the quest as Discord's own quest bots show it, one block after another. */
function buildQuestCard(quest, config = {}, { kind = 'new', rolePing = null } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const container = new ContainerBuilder();
  const accent = accentOf(quest, config);
  if (accent !== null) container.setAccentColor(accent);
  const title = `# ${EMOJI.QUEST_BADGE} [${kind === 'expiring' ? 'Ending soon: ' : ''}${quest.name}](${quest.url})`;
  container.addTextDisplayComponents(text(`${rolePing ? `-# ${rolePing}\n` : ''}${title}`));
  if (mediaUrl(quest.image) && !hidden.has('image')) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(quest.image)));
  container.addSeparatorComponents(divider());
  const info = [`- \`⏰\` **Starts:** <t:${unix(quest.startsAt)}:R> | **Ends:** <t:${unix(quest.expiresAt)}:R>`];
  if (!hidden.has('platforms') && quest.platforms.length) info.push(`- \`💿\` **Platforms:** ${quest.platforms.join(', ')}`);
  if (!hidden.has('tasks')) for (const task of quest.tasks.slice(0, 4)) info.push(`- \`🧫\` **Task:** ${task.label}${task.seconds ? ` (${clock(task.seconds)})` : ''}`);
  container.addTextDisplayComponents(text(info.join('\n')));
  if (!hidden.has('rewards') && quest.rewards.length) {
    container.addSeparatorComponents(divider());
    const reward = text(`## 🎁 Rewards\n${rewardLines(quest).join('\n')}`);
    const picture = mediaUrl(quest.rewards.find((entry) => mediaUrl(entry.image))?.image);
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
  // Discord refuses a link button whose address is longer than 512 characters, and with it the whole message, so a button
  // whose address does not fit is left out (the title of the card still links to the quest).
  const buttons = [];
  if (buttonUrl(quest.url)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Accept Quest').setURL(quest.url));
  if (buttonUrl(quest.link)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Game page').setURL(quest.link));
  const rows = buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

const LIST_PAGE_SIZE = 10; // quests shown in a page, each with its details, so the text stays under Discord's limit
const SELECT_ID = 'quests:view';
const PAGE_ID = 'quests:page';

// One icon for each kind of reward, for the options of the list.
const customEmoji = (text) => { const match = /^<(a?):(\w+):(\d+)>$/.exec(text); return match ? { id: match[3], name: match[2], animated: Boolean(match[1]) } : text; };
const REWARD_EMOJI = { decoration: '🎭', code: '🎟️', ingame: '🎮', nitro: '💎', other: '🎁' };
const REWARD_ICON = { orbs: customEmoji(EMOJI.QUEST_NITRO), decoration: '🎭', code: '🎟️', ingame: '🎮', nitro: '💎', other: '🎁' };
const TASK_WORD = { video: 'Video', play: 'Play', stream: 'Stream', activity: 'Activity' };
const shortDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function listOption(quest) {
  const reward = quest.rewards.map((entry) => (entry.kind === 'orbs' ? `${entry.amount} Orbs` : entry.name)).join(', ') || 'No reward listed';
  const task = TASK_WORD[quest.tasks[0]?.kind] ?? 'Task';
  return {
    label: quest.name.slice(0, 100),
    value: quest.id,
    description: `${reward} · ${task} · ends ${shortDate(quest.expiresAt)}`.slice(0, 100),
    emoji: REWARD_ICON[quest.rewards[0]?.kind] ?? REWARD_ICON.other,
  };
}

/** One quest of the list as text: its name, reward, task, end and limits. */
function listEntry(quest) {
  const reward = quest.rewards.map((entry) => (entry.kind === 'orbs' ? `${entry.amount} Orbs` : entry.name)).join(', ') || 'No reward listed';
  const icon = quest.rewards[0]?.kind === 'orbs' ? EMOJI.QUEST_NITRO : (REWARD_EMOJI[quest.rewards[0]?.kind] ?? REWARD_EMOJI.other);
  const limits = limitLines(quest).join(' · ');
  return [
    `### ${icon} [${quest.name}](${quest.url})`,
    `-# 🎁 ${reward} · ${TASK_WORD[quest.tasks[0]?.kind] ?? 'Task'} · ends <t:${unix(quest.expiresAt)}:R>`,
    limits ? `-# ${EMOJI.QUEST_ALERT} ${limits.length > 150 ? `${limits.slice(0, 147)}...` : limits}` : null,
  ].filter(Boolean).join('\n');
}

/** The list of active quests as a menu: pick one to see its card. Quests past the first page have page buttons. */
function buildQuestList(quests, { page = 1 } = {}) {
  const pages = Math.max(1, Math.ceil(quests.length / LIST_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const slice = quests.slice((current - 1) * LIST_PAGE_SIZE, current * LIST_PAGE_SIZE);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJI.QUEST_BADGE} Active quests\n-# ${quests.length} quest${quests.length === 1 ? '' : 's'}${pages > 1 ? ` · page ${current} of ${pages}` : ''} · pick one below to see its full card`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(slice.map(listEntry).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(SELECT_ID).setPlaceholder('See a quest in full').addOptions(slice.map(listOption)),
  ));
  if (pages > 1) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PAGE_ID}:${current - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(current <= 1),
      new ButtonBuilder().setCustomId(`${PAGE_ID}:none`).setLabel(`${current} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`${PAGE_ID}:${current + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages),
    ));
  }
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(CREDIT));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** The message to send for a quest in a server: its saved embed when the style asks for one, else the card. */
async function questMessage(guild, config, rawQuest, kind = 'new') {
  const quest = await withRewardImages(rawQuest);
  const rolePing = config.role_id ? `<@&${config.role_id}>` : null;
  if (config.style === 'template' && config.embed_template) {
    const payload = await templatePayload(guild.id, config.embed_template, { guild, quest: questContext(quest, kind) }, { v2Extras: { prefixText: rolePing ? `-# ${rolePing}` : null, suffixText: CREDIT } });
    // A Components V2 design has no text outside its components, so the ping and the credit were added inside.
    if (payload?.flags) return { ...payload, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    if (payload) {
      const content = [rolePing, payload.content, CREDIT].filter(Boolean).join('\n');
      return { ...payload, content, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    }
  }
  return buildQuestCard(quest, config, { kind, rolePing });
}

module.exports = { SECTIONS, CREDIT, LIST_PAGE_SIZE, SELECT_ID, PAGE_ID, REWARD_ICON, questContext, buildQuestCard, buildQuestList, questMessage, rewardText, taskText, limitsText };
