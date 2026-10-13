// The messages of rollout alerts: a Components V2 card that servers can style (color, sections), or one of their saved embeds with
// the `{rollout.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, KIND_LABELS, STATUS_LABELS } = require('./rolloutApi');
const { DISPLAY_BUTTON_PREFIX } = require('./embedV2');
const { templatePayload } = require('./templatedMessage');
const { EMOJI } = require('./emojis');

const SECTIONS = ['variants', 'ranges', 'status', 'platforms', 'filters'];
const EVENT_LABELS = { new: 'New experiment', increase: 'Rollout increased', decrease: 'Rollout decreased', status: 'Status changed' };
// Petto's own icons (never the ones of the sanctions): a person for users, the gear for servers, and so on.
const KIND_ICONS = { user: EMOJI.ROLLOUT_USERS, guild: EMOJI.ROLLOUT_GUILD, apex_user: EMOJI.ROLLOUT_EXPERIMENT, installation: EMOJI.ROLLOUT_INSTALLATION, unknown: EMOJI.ROLLOUT_NOTHING };
// The color of the button of the card says what happened: green when it grows, red when it shrinks, blue for a new one, grey for a status.
const BUTTON_STYLES = { new: ButtonStyle.Primary, increase: ButtonStyle.Success, decrease: ButtonStyle.Danger, status: ButtonStyle.Secondary };
const EVENT_ICONS = { new: EMOJI.ROLLOUT_NEW, increase: EMOJI.ROLLOUT_UP, decrease: EMOJI.ROLLOUT_DOWN, status: EMOJI.ROLLOUT_RELOAD };
const ICONS = { rollouts: EMOJI.ROLLOUT_RELOAD, ranges: EMOJI.ROLLOUT_RANGES, status: EMOJI.ROLLOUT_STATUS, platforms: EMOJI.ROLLOUT_PLATFORMS, filters: EMOJI.ROLLOUT_FILTERS };

const pct = (value) => (value == null ? '?' : `${Number(value.toFixed(2))}%`);
const signed = (value) => `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}%`;
const statusLabel = (status) => STATUS_LABELS[status ?? 'none'] ?? String(status);

/** The short text of the change: `+12.5% (50%)` for a change, `New (50%)` for a new one, the new status and its share (`A/B test (1%)`) for a status change. */
function badge(event) {
  const { rollout, type, change } = event;
  if (type === 'new') return rollout.percent != null ? `New (${pct(rollout.percent)})` : 'New';
  // A change of status keeps the share in the button too, as `A/B test (1%)`, so every button says how far the rollout is.
  if (type === 'status') return `${statusLabel(rollout.status)}${rollout.percent != null ? ` (${pct(rollout.percent)})` : ''}`.slice(0, 80);
  return `${signed(change)} (${pct(rollout.percent)})`.slice(0, 80);
}

/** `Control`, `Treatment 1`, `Variant 1`, or `No variant` for the ones the list marks with -1 or "none". */
function variantName(variant) {
  if (['-1', 'none'].includes(String(variant.variant))) return variant.role === 'control' ? 'Control' : 'No variant';
  if (variant.role === 'control') return 'Control';
  if (variant.role === 'treatment') return `Treatment ${variant.variant}`;
  return `Variant ${variant.variant}`;
}

const sameRanges = (a, b) => (a ?? []).join('|') === (b ?? []).join('|');
const moved = (old, now) => !old || (old.percent != null && now.percent != null && Math.abs(old.percent - now.percent) >= 0.01) || !sameRanges(old.ranges, now.ranges);

/**
 * The variants to show. A rollout that grew or shrank shows only the variants that moved, like the lists that follow Discord's own
 * announcements do; a new one or a change of status shows them all. If nothing moved (the share is the same), all are shown.
 */
function shownVariants(event) {
  const all = event.rollout.variants.filter((variant) => variant.role !== 'not_eligible');
  if (!['increase', 'decrease'].includes(event.type) || !event.before) return all;
  const before = new Map((event.before.variants ?? []).map((variant) => [variant.variant, variant]));
  const changed = all.filter((variant) => moved(before.get(variant.variant), variant));
  return changed.length ? changed : all;
}

/** The variants as lines for a code block: `Treatment 1: 37.5% → 50% (+12.5%)`. */
function variantLines(event) {
  const before = new Map((event.before?.variants ?? []).map((variant) => [variant.variant, variant]));
  return shownVariants(event).map((variant) => {
    const name = variantName(variant);
    const old = before.get(variant.variant);
    if (old && old.percent != null && variant.percent != null && Math.abs(old.percent - variant.percent) >= 0.01) {
      return `${name}: ${pct(old.percent)} → ${pct(variant.percent)} (${signed(variant.percent - old.percent)})`;
    }
    return `${name}: ${pct(variant.percent)}`;
  });
}

function rangeLines(event) {
  return shownVariants(event).filter((variant) => variant.ranges.length).map((variant) => `${variantName(variant)}: ${variant.ranges.slice(0, 8).map((range) => `(${range})`).join(' ')}${variant.ranges.length > 8 ? ' …' : ''}`);
}

/** `android` -> `Android`, `ios` -> `iOS`: the platforms as people write them. */
const PLATFORM_NAMES = { android: 'Android', ios: 'iOS', desktop: 'Desktop', web: 'Web', mobile: 'Mobile', macos: 'macOS', windows: 'Windows', linux: 'Linux', xbox: 'Xbox', playstation: 'PlayStation', ps4: 'PS4', ps5: 'PS5', embedded: 'Embedded', console: 'Console' };
const platformName = (name) => PLATFORM_NAMES[String(name).toLowerCase()] ?? (String(name).charAt(0).toUpperCase() + String(name).slice(1));

/** What `{rollout.*}` gives in a saved embed. */
function rolloutContext(event) {
  const { rollout, type, change, before } = event;
  return {
    id: rollout.id,
    name: rollout.title,
    kind: KIND_LABELS[rollout.kind] ?? KIND_LABELS.unknown,
    type: EVENT_LABELS[type],
    status: statusLabel(rollout.status),
    percent: pct(rollout.percent),
    from: before ? pct(before.percent) : '',
    to: pct(rollout.percent),
    change: type === 'new' ? '' : signed(change),
    badge: badge(event),
    kind_icon: KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown,
    event_icon: EVENT_ICONS[type],
    variants: variantLines(event).join('\n'),
    ranges: rangeLines(event).join('\n'),
    platforms: rollout.platforms.map(platformName).join(', '),
    filters: rollout.filters.join(' · '),
    source: SOURCE_NAME,
  };
}

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/**
 * The default Components V2 card, laid out like the quest card: the title, a line with the event, the details, the variants and
 * the filters, one block after another, with the credit at the end.
 */
function buildRolloutCard(event, config = {}, { rolePing = null } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const { rollout, type } = event;
  // No color unless the server chose one.
  const container = new ContainerBuilder();
  if (Number.isInteger(config.accent_color)) container.setAccentColor(config.accent_color);
  if (rolePing) container.addTextDisplayComponents(text(`-# ${rolePing}`));
  // The title, and a button that only shows the change, such as `+12.5% (50%)`. It has no emoji: with one, Discord puts the button under the text.
  const changeButton = new ButtonBuilder().setStyle(BUTTON_STYLES[type] ?? ButtonStyle.Secondary).setCustomId(`${DISPLAY_BUTTON_PREFIX}:rollout`).setLabel(badge(event).replace(/\*\*/g, '').slice(0, 80));
  const info = [`- ${KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown} **Kind:** ${KIND_LABELS[rollout.kind] ?? KIND_LABELS.unknown}`];
  if (!hidden.has('status')) info.push(`- ${ICONS.status} **Status:** ${statusLabel(rollout.status)}`);
  if (rollout.aaMode) info.push(`- ${ICONS.status} **A/A mode:** only measuring, nothing changes for anyone`);
  if (rollout.employeePercent != null && rollout.employeePercent > 0) info.push(`- ${ICONS.filters} **Employees only:** ${pct(rollout.employeePercent)}`);
  if (!hidden.has('platforms') && rollout.platforms.length) info.push(`- ${ICONS.platforms} **Platforms:** ${rollout.platforms.map(platformName).join(', ')}`);
  info.push(`- [\`${rollout.id}\`](${SOURCE_URL})`);
  // The title and the details are in the section, so it is tall enough and Discord puts the button beside the text, not under it.
  container.addSectionComponents(new SectionBuilder()
    .addTextDisplayComponents(text(`**${KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown} ${rollout.title}**`), text(info.join('\n')))
    .setButtonAccessory(changeButton));

  const variants = variantLines(event);
  const ranges = rangeLines(event);
  if ((!hidden.has('variants') && variants.length) || (!hidden.has('ranges') && ranges.length)) {
    container.addSeparatorComponents(divider());
    const blocks = [];
    if (!hidden.has('variants') && variants.length) blocks.push(`### ${ICONS.rollouts} Rollouts\n\`\`\`py\n${variants.join('\n')}\n\`\`\``);
    if (!hidden.has('ranges') && ranges.length) blocks.push(`### ${ICONS.ranges} Ranges\n\`\`\`py\n${ranges.join('\n').slice(0, 900)}\n\`\`\``);
    container.addTextDisplayComponents(text(blocks.join('\n')));
  }
  if (!hidden.has('filters') && rollout.filters.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(`### ${ICONS.filters} Filters\n${rollout.filters.map((line) => `* ${line}`).join('\n')}`));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

/** Many changes at once as one card: a line for each, so a big day is a few messages and not hundreds. */
function buildRolloutDigest(events, config = {}, { rolePing = null } = {}) {
  const container = new ContainerBuilder();
  if (Number.isInteger(config.accent_color)) container.setAccentColor(config.accent_color);
  container.addTextDisplayComponents(text(`${rolePing ? `-# ${rolePing}\n` : ''}# ${EMOJI.ROLLOUT_EXPERIMENT} Rollout updates\n-# ${events.length} changes`));
  container.addSeparatorComponents(divider());
  const lines = events.map((event) => `${KIND_ICONS[event.rollout.kind] ?? KIND_ICONS.unknown} **${event.rollout.title}**\n-# ${EVENT_ICONS[event.type]} ${EVENT_LABELS[event.type]} · ${badge(event)} · \`${event.rollout.id}\``);
  container.addTextDisplayComponents(text(lines.join('\n').slice(0, 3800)));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

/** The saved embed a server chose for the kind of experiment (`{ guild: 'servers-alert' }`), or null. */
function templateForRollout(map, rollout) {
  const name = map && typeof map === 'object' ? map[rollout.kind] : null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function rolloutMessage(guild, config, event) {
  const rolePing = config.role_id ? `<@&${config.role_id}>` : null;
  const names = [templateForRollout(config.type_templates, event.rollout), config.style === 'template' ? config.embed_template : null].filter((name, index, all) => name && all.indexOf(name) === index);
  for (const name of names) {
    const payload = await templatePayload(guild.id, name, { guild, rollout: rolloutContext(event) }, { v2Extras: { prefixText: rolePing ? `-# ${rolePing}` : null } });
    if (payload?.flags) return { ...payload, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    if (payload) return { ...payload, content: [rolePing, payload.content].filter(Boolean).join('\n'), allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
  }
  return buildRolloutCard(event, config, { rolePing });
}

module.exports = { SECTIONS, EVENT_LABELS, rolloutContext, buildRolloutCard, buildRolloutDigest, rolloutMessage, badge, variantLines };
