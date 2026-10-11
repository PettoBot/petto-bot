// The messages of rollout alerts: a Components V2 card that servers can style (color, sections), or one of their saved embeds with
// the `{rollout.*}` variables. A saved embed that is missing or broken falls back to the card.
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SOURCE_NAME, SOURCE_URL, KIND_LABELS, STATUS_LABELS } = require('./rolloutApi');
const { templatePayload } = require('./templatedMessage');
const { EMOJI } = require('./emojis');

const SECTIONS = ['variants', 'ranges', 'status', 'platforms', 'filters'];
const CREDIT = `-# Data from [${SOURCE_NAME}](${SOURCE_URL})`;
const EVENT_LABELS = { new: 'New experiment', increase: 'Rollout increased', decrease: 'Rollout decreased', status: 'Status changed' };
const COLORS = { new: 0x5865f2, increase: 0x6df08e, decrease: 0xfe6465, status: 0xfed53c };
// Petto's own icons (never the ones of the sanctions): a person for users, the gear for servers, and so on.
const KIND_ICONS = { user: EMOJI.MEMBERS, guild: EMOJI.RELEASE_SETTINGS, apex_user: EMOJI.RELEASE_EXPERIENCE, installation: EMOJI.RELEASE_ROCKET, unknown: EMOJI.RELEASE_MAGIC };
const EVENT_ICONS = { new: EMOJI.RELEASE_MAGIC, increase: EMOJI.RELEASE_MORE, decrease: EMOJI.RELEASE_MINUS, status: EMOJI.RELEASE_RELOAD };
const ICONS = { rollouts: EMOJI.RELEASE_RELOAD, ranges: EMOJI.RELEASE_NOTE, status: EMOJI.RELEASE_CHANGELOG, platforms: EMOJI.RELEASE_PC, filters: EMOJI.RELEASE_EYES };

const pct = (value) => (value == null ? '?' : `${Number(value.toFixed(2))}%`);
const signed = (value) => `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}%`;
const statusLabel = (status) => STATUS_LABELS[status ?? 'none'] ?? String(status);

/** The short text of the change: `+12.5% (50%)` for a change, `New (50%)` for a new one, the new status for a status change. */
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
    kind_icon: KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown,
    event_icon: EVENT_ICONS[type],
    variants: variantLines(event).join('\n'),
    ranges: rangeLines(event).join('\n'),
    platforms: rollout.platforms.join(', '),
    filters: rollout.filters.join(' · '),
    source: SOURCE_NAME,
  };
}

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const sourceRow = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Rollout list').setURL(SOURCE_URL));

/**
 * The default Components V2 card, laid out like the quest card: the title, a line with the event, the details, the variants and
 * the filters, one block after another, with the credit at the end.
 */
function buildRolloutCard(event, config = {}, { rolePing = null } = {}) {
  const hidden = new Set(config.hide_sections ?? []);
  const { rollout, type } = event;
  const container = new ContainerBuilder().setAccentColor(Number.isInteger(config.accent_color) ? config.accent_color : COLORS[type]);
  container.addTextDisplayComponents(text(`${rolePing ? `-# ${rolePing}\n` : ''}# ${KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown} ${rollout.title}\n-# ${EVENT_ICONS[type]} ${EVENT_LABELS[type]} · **${badge(event)}**`));
  container.addSeparatorComponents(divider());

  const info = [`- ${KIND_ICONS[rollout.kind] ?? KIND_ICONS.unknown} **Kind:** ${KIND_LABELS[rollout.kind] ?? KIND_LABELS.unknown}`];
  if (!hidden.has('status')) info.push(`- ${ICONS.status} **Status:** ${statusLabel(rollout.status)}`);
  if (!hidden.has('platforms') && rollout.platforms.length) info.push(`- ${ICONS.platforms} **Platforms:** ${rollout.platforms.join(', ')}`);
  info.push(`-# \`${rollout.id}\``);
  container.addTextDisplayComponents(text(info.join('\n')));

  const variants = variantLines(event);
  const ranges = rangeLines(event);
  if ((!hidden.has('variants') && variants.length) || (!hidden.has('ranges') && ranges.length)) {
    container.addSeparatorComponents(divider());
    const blocks = [];
    if (!hidden.has('variants') && variants.length) blocks.push(`## ${ICONS.rollouts} Rollouts\n\`\`\`py\n${variants.join('\n')}\n\`\`\``);
    if (!hidden.has('ranges') && ranges.length) blocks.push(`## ${ICONS.ranges} Ranges\n\`\`\`py\n${ranges.join('\n').slice(0, 900)}\n\`\`\``);
    container.addTextDisplayComponents(text(blocks.join('\n')));
  }
  if (!hidden.has('filters') && rollout.filters.length) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(`## ${ICONS.filters} Filters\n${rollout.filters.map((line) => `* ${line}`).join('\n')}`));
  }
  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(text(CREDIT));
  return { components: [container, sourceRow()], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
}

/** Many changes at once as one card: a line for each, so a big day is a few messages and not hundreds. */
function buildRolloutDigest(events, config = {}, { rolePing = null } = {}) {
  const container = new ContainerBuilder().setAccentColor(Number.isInteger(config.accent_color) ? config.accent_color : COLORS.new);
  container.addTextDisplayComponents(text(`${rolePing ? `-# ${rolePing}\n` : ''}# ${EMOJI.RELEASE_EXPERIENCE} Rollout updates\n-# ${events.length} changes`));
  container.addSeparatorComponents(divider());
  const lines = events.map((event) => `${KIND_ICONS[event.rollout.kind] ?? KIND_ICONS.unknown} **${event.rollout.title}**\n-# ${EVENT_ICONS[event.type]} ${EVENT_LABELS[event.type]} · ${badge(event)} · \`${event.rollout.id}\``);
  container.addTextDisplayComponents(text(lines.join('\n').slice(0, 3800)));
  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(text(CREDIT));
  return { components: [container, sourceRow()], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], roles: config.role_id ? [config.role_id] : [] } };
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

module.exports = { SECTIONS, CREDIT, EVENT_LABELS, rolloutContext, buildRolloutCard, buildRolloutDigest, rolloutMessage, badge, variantLines };
