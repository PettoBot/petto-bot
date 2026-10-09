// Turns what the Vanity bot stored into what Petto stores. Pure functions, used by scripts/import-vanity.js.

// The variables of the Vanity bot that have another name here. Anything not listed keeps its name (`{user.mention}`,
// `{guild.name}`, `{vanity.word}`, `{tag}` and the others exist in Petto as well).
const TOKEN_RENAMES = {
  '{role}': '{rule.role}',
  '{role.id}': '{rule.role_id}',
  '{action}': '{rule.action}',
  '{action.text}': '{rule.action_text}',
  '{result}': '{rule.result}',
  '{event}': '{rule.event}',
  '{event.title}': '{rule.event_title}',
  '{event.error}': '{rule.error}',
  '{event.matched_value}': '{rule.matched_value}',
  '{identity.value}': '{vanity.value}',
  '{identity.source}': '{rule.source}',
  '{date.utc_timestamp}': '{timestamp}',
};

function renameTokens(text) {
  if (typeof text !== 'string' || !text.includes('{')) return text;
  return text.replace(/\{[a-z_.]+\}/gi, (token) => TOKEN_RENAMES[token] ?? token);
}

function deep(value) {
  if (typeof value === 'string') return renameTokens(value);
  if (Array.isArray(value)) return value.map(deep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deep(entry)]));
  return value;
}

/** A message of the Vanity bot (one flat embed, link buttons) as the template Petto stores (`{ content, embeds, buttons }`). */
function toPettoTemplate(payload) {
  const source = typeof payload === 'string' ? JSON.parse(payload) : (payload ?? {});
  const author = typeof source.author === 'object' && source.author ? source.author : { name: source.author ?? '', icon: source.author_icon ?? '', url: source.author_url ?? '' };
  const footer = typeof source.footer === 'object' && source.footer ? source.footer : { text: source.footer ?? '', icon: source.footer_icon ?? '' };
  const hasEmbed = Boolean(source.title || source.description || author.name || footer.text || source.fields?.length || source.image || source.thumbnail || source.url || source.color || source.timestamp);
  return deep({
    content: source.content ?? '',
    embeds: hasEmbed ? [{
      title: source.title ?? '', description: source.description ?? '', color: source.color || null, url: source.url ?? '',
      thumbnail: source.thumbnail ?? '', image: source.image ?? '', timestamp: Boolean(source.timestamp),
      author: { name: author.name ?? '', icon: author.icon ?? '', url: author.url ?? '' },
      footer: { text: footer.text ?? '', icon: footer.icon ?? '' },
      fields: (source.fields ?? []).map((field) => ({ name: field.name, value: field.value, inline: Boolean(field.inline) })),
    }] : [],
    buttons: (source.buttons ?? []).map((row) => row.map((button) => ({ label: button.label, url: button.url, emoji: '', disabled: Boolean(button.disabled) }))),
  });
}

/** Picks a name for an imported embed that is not taken: the same name when it is free, otherwise `vanity-<name>`, then with a number. */
function freeName(name, taken) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40) || 'embed';
  for (const candidate of [base, `vanity-${base}`.slice(0, 40)]) if (!taken.has(candidate)) return candidate;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `vanity-${base}`.slice(0, 36) + `-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`No free name for the embed ${name}.`);
}

module.exports = { TOKEN_RENAMES, renameTokens, toPettoTemplate, freeName };
