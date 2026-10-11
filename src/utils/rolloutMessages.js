// The messages of rollout alerts: a Components V2 card that servers can style (color, sections), or one of their saved embeds with
// the `{rollout.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, KIND_LABELS, STATUS_LABELS } = require('./rolloutApi');
const { templatePayload } = require('./templatedMessage');

const SECTIONS = ['variants', 'ranges', 'status', 'platforms', 'filters'];
const CREDIT = `-# Data from [${SOURCE_NAME}](${SOURCE_URL})`;
const EVENT_LABELS = { new: 'New experiment', increase: 'Rollout increased', decrease: 'Rollout decreased', status: 'Status changed' };
const KIND_ICONS = { user: '👤', guild: '🏠', apex_user: '🧪', installation: '📱', unknown: '🧪' };
const COLORS = { new: 0x5865f2, increase: 0x6df08e, decrease: 0xfe6465, status: 0xfed53c };
const BUTTON_STYLES = { new: ButtonStyle.Primary, increase: ButtonStyle.Success, decrease: ButtonStyle.Danger, status: ButtonStyle.Secondary };

const pct = (value) => (value == null ? '?' : `${Number(value.toFixed(2))}%`);
const signed = (value) => `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}%`;
const statusLabel = (status) => STATUS_LABELS[status ?? 'none'] ?? String(status);

/** The text on the button of the card: `+12.5% (50%)` for a change, `New` for a new one, the new status for a status change. */
function badge(event) {
  const { rollout, type, change } = event;
  if (type === 'new') return rollout.percent != null ? `New (${pct(rollout.percent)})` : 'New';
  if (type === 'status') return statusLabel(rollout.status).slice(0, 80);
  return `${signed(change)} (${pct(rollout.percent)})`.slice(0, 80);
}

/** The variants as lines for a code block: `Variant 1: 37.5% → 50% (+12.5%)`. */
function variantLines(event) {
  const before = new Map((event.before?.variants ?? []).map((variant) => [variant.variant, variant]));
  return event.rollout.variants.filter((variant) => variant.role !== 'not_eligible').map((variant) => {
    const name = variant.role === 'control' ? `Variant ${variant.variant} (control)` : `Variant ${variant.variant}`;
    const old = before.get(variant.variant);
    if (old && old.percent != null && variant.percent != null && Math.abs(old.percent - variant.percent) >= 0.01) {
      return `${name}: ${pct(old.percent)} → ${pct(variant.percent)} (${signed(variant.percent - old.percent)})`;
    }
    return `${name}: ${pct(variant.percent)}`;
  });
}

function rangeLines(event) {
  return event.rollout.variants.filter((variant) => variant.ranges.length && variant.role !== 'not_eligible').map((variant) => `Variant ${variant.variant}: ${variant.ranges.slice(0, 8).map((range) => `(${range})`).join(' ')}${variant.ranges.length > 8 ? ' …' : ''}`);
}

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
    variants: variantLines(event).join('\n'),
    ranges: rangeLines(event).join('\n'),
    platforms: rollout.platforms.join(', '),
    filters: rollout.filters.join(' · '),
    source: SOURCE_NAME,
  };
}

/** The default Components V2 card, modeled on the rollout bots of the community: the kind, the experiment and its change at the top. */
function buildRolloutCard(event, config = {}, { rolePing = null } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const { rollout, type } = event;
  const text = (content) => new TextDisplayBuilder().setContent(content);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const container = new ContainerBuilder().setAccentColor(Number.isInteger(config.accent_color) ? config.accent_color : COLORS[type]);

  const heading = new SectionBuilder()
    .addTextDisplayComponents(
      text(`${rolePing ? `-# ${rolePing}\n` : ''}${KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown} **${KIND_LABELS[rollout.kind] ?? KIND_LABELS.unknown}** · ${EVENT_LABELS[type]}`),
      text(`* **${rollout.title}**\n* \`${rollout.id}\``),
    )
    .setButtonAccessory(new ButtonBuilder().setCustomId('rollout_badge').setStyle(BUTTON_STYLES[type]).setDisabled(true).setLabel(badge(event)));
  container.addSectionComponents(heading);

  const variants = variantLines(event);
  if (!hidden.has('variants') && variants.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(`**🔁 Rollouts:**\n\`\`\`py\n${variants.join('\n')}\n\`\`\``));
  }
  const ranges = rangeLines(event);
  if (!hidden.has('ranges') && ranges.length) container.addTextDisplayComponents(text(`**🎯 Ranges:**\n\`\`\`py\n${ranges.join('\n').slice(0, 900)}\n\`\`\``));

  const info = [];
  if (!hidden.has('status')) info.push(`- **Status:** ${statusLabel(rollout.status)}`);
  if (!hidden.has('platforms') && rollout.platforms.length) info.push(`- **Platforms:** ${rollout.platforms.join(', ')}`);
  if (!hidden.has('filters') && rollout.filters.length) info.push(`- **Filters:** ${rollout.filters.join(' · ')}`);
  if (info.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(info.join('\n')));
  }
  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(text(CREDIT));
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
    const payload = await templatePayload(guild.id, name, { guild, rollout: rolloutContext(event) }, { v2Extras: { prefixText: rolePing ? `-# ${rolePing}` : null, suffixText: CREDIT } });
    if (payload?.flags) return { ...payload, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
    if (payload) return { ...payload, content: [rolePing, payload.content, CREDIT].filter(Boolean).join('\n'), allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
  }
  return buildRolloutCard(event, config, { rolePing });
}

module.exports = { SECTIONS, CREDIT, EVENT_LABELS, rolloutContext, buildRolloutCard, rolloutMessage, badge, variantLines };
