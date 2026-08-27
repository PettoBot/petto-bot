const { EmbedBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');

const SNOWFLAKE_RE = /\b\d{15,25}\b/;
const MAX_SUMMARY_LENGTH = 1_500;
const MAX_DETAIL_LENGTH = 2_500;

function truncate(value, length) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function redact(value) {
  return String(value ?? '')
    .replace(/((?:authorization|bearer|token|secret|password|api[_-]?key|access[_-]?token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?[REDACTED]')
    .replace(/\b[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}\b/g, '[REDACTED_TOKEN]');
}

function isErrorLike(value) {
  return value instanceof Error || (value && typeof value === 'object' && typeof value.message === 'string');
}

function safeRoute(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    const path = url.pathname
      .replace(/\/\d{15,25}(?=\/|$)/g, '/:id')
      .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token');
    return `${url.origin}${path}`;
  } catch {
    return redact(value).replace(/\/\d{15,25}(?=\/|$)/g, '/:id');
  }
}

function formatError(error) {
  if (!isErrorLike(error)) return null;
  const details = [redact(error.message)];
  const apiMessage = error.rawError?.message;
  if (apiMessage && apiMessage !== error.message) details.push(`api=${redact(apiMessage)}`);
  if (error.code !== undefined) details.push(`code=${redact(error.code)}`);
  if (error.status !== undefined) details.push(`status=${redact(error.status)}`);
  if (error.method) details.push(`method=${redact(error.method)}`);
  const route = safeRoute(error.url ?? error.route);
  if (route) details.push(`route=${route}`);
  return details.join(' · ');
}

function formatArg(value) {
  if (isErrorLike(value)) return formatError(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return redact(value);
  if (value === null || value === undefined) return '';
  try {
    return redact(JSON.stringify(value));
  } catch {
    return '[unserializable value]';
  }
}

function collectText(args) {
  return args.map(formatArg).filter(Boolean).join(' ').trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && SNOWFLAKE_RE.test(match[1])) return match[1];
  }
  return null;
}

function extractContext(args, context = null) {
  const text = collectText(args);
  return {
    guildId: context?.guildId ?? context?.serverId ?? firstMatch(text, [/(?:guild|server)(?:\s+id)?\s*[=:]?\s*(\d{15,25})/i]),
    channelId: context?.channelId ?? firstMatch(text, [/<#(\d{15,25})>/, /channel(?:\s+id)?\s*[=:]?\s*(\d{15,25})/i]),
    userId: context?.userId ?? context?.memberId ?? firstMatch(text, [/(?:user|member|author|target)(?:\s+id)?\s*[=:]?\s*(\d{15,25})/i]),
    action: context?.action ?? null,
    command: context?.command ?? null,
    source: context?.source ?? null,
  };
}

function createErrorLogEmbed(level, args, stamp, context) {
  const error = args.find(isErrorLike);
  const summary = truncate(collectText(args.filter((value) => value !== error)), MAX_SUMMARY_LENGTH) || 'No description provided.';
  const details = truncate(formatError(error) ?? collectText(args), MAX_DETAIL_LENGTH) || 'No additional details provided.';
  const ids = extractContext(args, context);
  const source = ids.command ?? ids.source;
  const isError = level === 'error';
  const embed = new EmbedBuilder()
    .setColor(isError ? 0xfe6465 : 0xf5c451)
    .setTitle(`${isError ? EMOJI.DENY : EMOJI.WARNING} Petto ${isError ? 'error' : 'warning'}`)
    .setDescription(`**Event**\n\`\`\`text\n${summary.replace(/```/g, '`​``')}\n\`\`\``)
    .addFields(
      { name: 'Server ID', value: ids.guildId ? `\`${ids.guildId}\`` : 'Not available', inline: true },
      { name: 'Channel ID', value: ids.channelId ? `\`${ids.channelId}\`` : 'Not available', inline: true },
      { name: 'User ID', value: ids.userId ? `\`${ids.userId}\`` : 'Not available', inline: true },
      { name: 'Action', value: ids.action ? `\`${truncate(ids.action, 100)}\`` : 'Not specified', inline: true },
      { name: 'Command / source', value: source ? `\`${truncate(source, 100)}\`` : 'Not specified', inline: true },
      { name: 'Details', value: `\`\`\`text\n${details.replace(/```/g, '`​``')}\n\`\`\``, inline: false },
    )
    .setFooter({ text: `Petto diagnostics · ${process.version}` })
    .setTimestamp(new Date(stamp));

  return embed;
}

function createDiscordErrorLogSink(client, channelId) {
  let channelPromise = null;
  let lastFailureAt = 0;

  async function getChannel() {
    if (!channelId || !client?.channels?.fetch) return null;
    const cached = client.channels.cache.get(channelId);
    if (cached?.isTextBased?.()) return cached;
    if (!channelPromise) {
      channelPromise = client.channels.fetch(channelId).finally(() => { channelPromise = null; });
    }
    const channel = await channelPromise.catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
  }

  return async (level, args, stamp, context) => {
    if (level === 'info') return;
    const channel = await getChannel();
    if (!channel) return;

    try {
      await channel.send({
        embeds: [createErrorLogEmbed(level, args, stamp, context)],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const now = Date.now();
      if (now - lastFailureAt >= 60_000) {
        lastFailureAt = now;
        console.error('[Petto diagnostics] Could not send a log embed:', error?.message ?? error);
      }
    }
  };
}

module.exports = { createDiscordErrorLogSink, createErrorLogEmbed };
