// The messages of quest alerts: a Components V2 card that servers can style (color, sections), or one of their saved
// embeds with the `{quest.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, TRACKER_URL, rewardLabel, taskLabel, platformLabel } = require('./questApi');
const { templatePayload } = require('./templatedMessage');
const { EMOJI } = require('./emojis');
const { withRewardImages } = require('./questImages');
const { questExtras } = require('./questTime');
const { t, tn, currentLanguage } = require('../i18n');

const SECTIONS = ['image', 'rewards', 'tasks', 'platforms', 'limits'];
/** The credit line under an alert, in `lang`. */
const creditLine = (lang = currentLanguage()) => `-# ${t(lang, 'quests.credit', { source: `[${SOURCE_NAME}](${SOURCE_URL})`, tracker: `[discord-api-diff](${TRACKER_URL})` })}`;
const CREDIT = creditLine('en');

const unix = (date) => Math.floor(date.getTime() / 1000);
const minutes = (seconds) => (seconds >= 120 ? `${Math.round(seconds / 60)} min` : seconds ? `${seconds} s` : '');

function rewardText(quest, lang = currentLanguage()) {
  return quest.rewards.map((reward) => (reward.kind === 'orbs' ? reward.name : `${reward.name} (${rewardLabel(reward.kind, lang)})`)).join(', ') || t(lang, 'quests.notListed');
}

function taskText(quest, lang = currentLanguage()) {
  return quest.tasks.map((task) => `${taskLabel(task, lang)}${task.seconds ? ` (${minutes(task.seconds)})` : ''}`).join(` ${t(lang, 'common.or')} `) || t(lang, 'quests.notListed');
}

function limitsText(quest, lang = currentLanguage()) {
  const parts = [];
  if (!quest.global && quest.regions.include.length) parts.push(t(lang, 'quests.limits.onlyIn', { regions: quest.regions.include.join(', ') }));
  if (quest.regions.exclude.length) parts.push(t(lang, 'quests.limits.notIn', { regions: quest.regions.exclude.join(', ') }));
  if (!quest.global && !quest.regions.include.length && !quest.regions.exclude.length) parts.push(t(lang, 'quests.limits.restricted'));
  if (quest.ageGate) parts.push('18+');
  return parts.join(' · ') || t(lang, 'quests.limits.none');
}

/** What `{quest.*}` gives in a saved embed. */
function questContext(quest, kind = 'new', lang = currentLanguage()) {
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
    reward: rewardText(quest, lang),
    reward_type: first ? rewardLabel(first.kind, lang) : '',
    reward_amount: orbs ? String(orbs.amount) : '',
    reward_image: first?.image ?? '',
    task: quest.tasks[0] ? taskLabel(quest.tasks[0], lang) : '',
    task_minutes: quest.tasks[0]?.seconds ? String(Math.max(1, Math.round(quest.tasks[0].seconds / 60))) : '',
    tasks: taskText(quest, lang),
    platforms: quest.platforms.map((platform) => platformLabel(platform, lang)).join(', '),
    starts: `<t:${unix(quest.startsAt)}:R>`,
    starts_at: `<t:${unix(quest.startsAt)}:f>`,
    expires: `<t:${unix(quest.expiresAt)}:R>`,
    expires_at: `<t:${unix(quest.expiresAt)}:f>`,
    limits: limitsText(quest, lang),
    age_gate: quest.ageGate ? '18+' : '',
    status: t(lang, kind === 'expiring' ? 'quests.state.expiring' : 'quests.state.new'),
    source: SOURCE_NAME,
    ...questExtras(quest, Date.now(), lang),
  };
}

function accentOf(quest, config) {
  return Number.isInteger(config.accent_color) ? config.accent_color : null;
}

const REWARD_TYPES = ['orbs', 'decoration', 'code', 'ingame', 'nitro'];
const rewardType = (kind, lang) => t(lang, REWARD_TYPES.includes(kind) ? `quests.rewardType.${kind}` : 'quests.reward.unknown');
const flagOf = (code) => (/^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '');
const regionNames = new Map();
function countryName(code, lang = currentLanguage()) {
  try {
    if (!regionNames.has(lang)) regionNames.set(lang, new Intl.DisplayNames([lang], { type: 'region' }));
    return regionNames.get(lang).of(code.toUpperCase()) || code;
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
function limitLines(quest, lang = currentLanguage()) {
  const lines = [];
  const countries = (codes) => codes.map((code) => `${countryName(code, lang)} ${flagOf(code)}`.trim()).join(', ');
  if (quest.regions.include.length) lines.push(t(lang, 'quests.limits.residing', { countries: countries(quest.regions.include) }));
  else if (!quest.global && !quest.regions.exclude.length) lines.push(t(lang, 'quests.limits.someRegions'));
  if (quest.regions.exclude.length) lines.push(t(lang, 'quests.limits.notFor', { countries: countries(quest.regions.exclude) }));
  if (quest.ageGate) lines.push(t(lang, 'quests.limits.adults'));
  return lines;
}

const rewardLines = (quest, lang) => quest.rewards.flatMap((reward) => {
  const lines = [`* \`🥇\` ${t(lang, 'quests.card.type', { type: rewardType(reward.kind, lang) })}`];
  if (reward.kind === 'orbs') lines.push(`* \`💸\` ${t(lang, 'quests.card.amount', { amount: reward.amount })}${reward.premiumAmount ? ` | ${EMOJI.QUEST_NITRO} ${reward.premiumAmount}` : ''}`);
  else lines.push(`* \`🔮\` ${t(lang, 'quests.card.name', { name: reward.name })}`);
  if (reward.expiresAt) lines.push(`* \`⏰\` ${t(lang, 'quests.card.expires', { time: `<t:${unix(reward.expiresAt)}:R>` })}`);
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
function buildQuestCard(quest, config = {}, { kind = 'new', rolePing = null, lang = currentLanguage() } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const container = new ContainerBuilder();
  const accent = accentOf(quest, config);
  if (accent !== null) container.setAccentColor(accent);
  const name = kind === 'expiring' ? t(lang, 'quests.card.endingSoon', { name: quest.name }) : quest.name;
  const title = `# ${EMOJI.QUEST_BADGE} [${name}](${quest.url})`;
  container.addTextDisplayComponents(text(`${rolePing ? `-# ${rolePing}\n` : ''}${title}`));
  if (mediaUrl(quest.image) && !hidden.has('image')) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(quest.image)));
  container.addSeparatorComponents(divider());
  const info = [`- \`⏰\` ${t(lang, 'quests.card.dates', { starts: `<t:${unix(quest.startsAt)}:R>`, ends: `<t:${unix(quest.expiresAt)}:R>` })}`];
  if (!hidden.has('platforms') && quest.platforms.length) info.push(`- \`💿\` ${t(lang, 'quests.card.platforms', { platforms: quest.platforms.map((platform) => platformLabel(platform, lang)).join(', ') })}`);
  if (!hidden.has('tasks')) for (const task of quest.tasks.slice(0, 4)) info.push(`- \`🧫\` ${t(lang, 'quests.card.task', { task: `${taskLabel(task, lang)}${task.seconds ? ` (${clock(task.seconds)})` : ''}` })}`);
  container.addTextDisplayComponents(text(info.join('\n')));
  if (!hidden.has('rewards') && quest.rewards.length) {
    container.addSeparatorComponents(divider());
    const reward = text(`## 🎁 ${t(lang, 'quests.card.rewards')}\n${rewardLines(quest, lang).join('\n')}`);
    const picture = mediaUrl(quest.rewards.find((entry) => mediaUrl(entry.image))?.image);
    if (picture) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(reward).setThumbnailAccessory(new ThumbnailBuilder().setURL(picture)));
    else container.addTextDisplayComponents(reward);
  }
  const limits = limitLines(quest, lang);
  if (!hidden.has('limits') && limits.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(`## ${EMOJI.QUEST_ALERT} ${t(lang, 'quests.card.limitations')}\n${limits.map((line) => `* ${line}`).join('\n')}`));
  }
  // Discord refuses a link button whose address is longer than 512 characters, and with it the whole message, so a button
  // whose address does not fit is left out (the title of the card still links to the quest).
  const buttons = [];
  if (buttonUrl(quest.url)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'quests.card.accept.button')).setURL(quest.url));
  if (buttonUrl(quest.link)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'quests.card.gamePage.button')).setURL(quest.link));
  const rows = buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

const LIST_PAGE_SIZE = 10; // quests shown in a page, each with its details, so the text stays under Discord's limit
const SELECT_ID = 'quests:view';
const PAGE_ID = 'quests:page';

// One icon for each kind of reward, for the options of the list.
const customEmoji = (text) => { const match = /^<(a?):(\w+):(\d+)>$/.exec(text); return match ? { id: match[3], name: match[2], animated: Boolean(match[1]) } : text; };
const REWARD_EMOJI = { decoration: '🎭', code: '🎟️', ingame: '🎮', nitro: '💎', other: '🎁' };
const REWARD_ICON = Object.fromEntries(Object.entries({ orbs: EMOJI.QUEST_NITRO, decoration: EMOJI.MASK, code: EMOJI.TICKET, ingame: EMOJI.GAME, nitro: EMOJI.GEM, other: EMOJI.GIVEAWAY }).map(([kind, emoji]) => [kind, customEmoji(emoji)]));
const TASK_WORDS = ['video', 'play', 'stream', 'activity'];
const taskWord = (quest, lang) => t(lang, TASK_WORDS.includes(quest.tasks[0]?.kind) ? `quests.taskWord.${quest.tasks[0].kind}` : 'quests.taskWord.unknown');
const DATE_LOCALES = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };
const shortDate = (date, lang) => date.toLocaleDateString(DATE_LOCALES[lang] ?? DATE_LOCALES.en, { month: 'short', day: 'numeric', timeZone: 'America/Bogota' });
const listReward = (quest, lang) => quest.rewards.map((entry) => (entry.kind === 'orbs' ? `${entry.amount} Orbs` : entry.name)).join(', ') || t(lang, 'quests.list.noReward');

function listOption(quest, lang = currentLanguage()) {
  return {
    label: quest.name.slice(0, 100),
    value: quest.id,
    description: `${listReward(quest, lang)} · ${taskWord(quest, lang)} · ${t(lang, 'quests.list.ends', { date: shortDate(quest.expiresAt, lang) })}`.slice(0, 100),
    emoji: REWARD_ICON[quest.rewards[0]?.kind] ?? REWARD_ICON.other,
  };
}

/** One quest of the list as text: its name, reward, task, end and limits. */
function listEntry(quest, lang = currentLanguage()) {
  const icon = quest.rewards[0]?.kind === 'orbs' ? EMOJI.QUEST_NITRO : (REWARD_EMOJI[quest.rewards[0]?.kind] ?? REWARD_EMOJI.other);
  const limits = limitLines(quest, lang).join(' · ');
  return [
    `### ${icon} [${quest.name}](${quest.url})`,
    `-# 🎁 ${listReward(quest, lang)} · ${taskWord(quest, lang)} · ${t(lang, 'quests.list.ends', { date: `<t:${unix(quest.expiresAt)}:R>` })}`,
    limits ? `-# ${EMOJI.QUEST_ALERT} ${limits.length > 150 ? `${limits.slice(0, 147)}...` : limits}` : null,
  ].filter(Boolean).join('\n');
}

/** The list of active quests as a menu: pick one to see its card. Quests past the first page have page buttons. */
function buildQuestList(quests, { page = 1, lang = currentLanguage() } = {}) {
  const pages = Math.max(1, Math.ceil(quests.length / LIST_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const slice = quests.slice((current - 1) * LIST_PAGE_SIZE, current * LIST_PAGE_SIZE);
  const container = new ContainerBuilder();
  const count = tn(lang, 'quests.list.count', quests.length, { count: quests.length });
  const subtitle = pages > 1 ? t(lang, 'quests.list.subtitlePages', { count, page: current, pages }) : t(lang, 'quests.list.subtitle', { count });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${t(lang, 'quests.list.title', { emoji: EMOJI.QUEST_BADGE })}\n-# ${subtitle}`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(slice.map((quest) => listEntry(quest, lang)).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(SELECT_ID).setPlaceholder(t(lang, 'quests.list.pick.menu')).addOptions(slice.map((quest) => listOption(quest, lang))),
  ));
  if (pages > 1) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PAGE_ID}:${current - 1}`).setLabel(t(lang, 'quests.list.previous.button')).setStyle(ButtonStyle.Secondary).setDisabled(current <= 1),
      new ButtonBuilder().setCustomId(`${PAGE_ID}:none`).setLabel(`${current} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`${PAGE_ID}:${current + 1}`).setLabel(t(lang, 'quests.list.next.button')).setStyle(ButtonStyle.Secondary).setDisabled(current >= pages),
    ));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** The message to send for a quest in a server: its saved embed when the style asks for one, else the card. */
/**
 * The saved embed a server chose for the kind of reward of a quest (`{ orbs: 'orbs-alert' }`), or null. A quest with several
 * rewards uses the first one that has an embed.
 */
function templateForQuest(map, quest) {
  if (!map || typeof map !== 'object') return null;
  for (const reward of quest.rewards ?? []) {
    const name = map[reward.kind];
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

async function questMessage(guild, config, rawQuest, kind = 'new', lang = currentLanguage()) {
  const quest = await withRewardImages(rawQuest);
  const credit = creditLine(lang);
  const rolePing = config.role_id ? `<@&${config.role_id}>` : null;
  // The embed of the kind of reward wins over the general one, even when the style is the card (choosing it is choosing to use it), and the
  // general one is the fallback when it is missing or broken, then the card.
  const names = [templateForQuest(config.type_templates, quest), config.style === 'template' ? config.embed_template : null].filter((name, index, all) => name && all.indexOf(name) === index);
  for (const name of names) {
    const payload = await templatePayload(guild.id, name, { guild, quest: questContext(quest, kind, lang) }, { v2Extras: { prefixText: rolePing ? `-# ${rolePing}` : null, suffixText: credit } });
    // A Components V2 design has no text outside its components, so the ping and the credit were added inside.
    if (payload?.flags) return { ...payload, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    if (payload) {
      const content = [rolePing, payload.content, credit].filter(Boolean).join('\n');
      return { ...payload, content, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    }
  }
  return buildQuestCard(quest, config, { kind, rolePing, lang });
}

module.exports = { templateForQuest, SECTIONS, CREDIT, LIST_PAGE_SIZE, SELECT_ID, PAGE_ID, REWARD_ICON, questContext, buildQuestCard, buildQuestList, questMessage, rewardText, taskText, limitsText };
