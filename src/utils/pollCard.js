const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');

const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];
const BAR_LENGTH = 12;

function bar(pct) {
  const filled = Math.round((pct / 100) * BAR_LENGTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
}

/** Builds the poll's message content (Components V2 card + vote buttons) from its current tallies. */
function buildPollCard(poll, results) {
  const total = results.voters;
  const lines = [`### 📊 ${poll.question}`, ''];

  poll.options.forEach((opt, i) => {
    const count = results.counts[i] ?? 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    lines.push(`${LETTERS[i]} **${opt}**`, `${bar(pct)}  ${pct}% (${count})`, '');
  });

  lines.push(`-# ${total} vote${total === 1 ? '' : 's'} · ${poll.multi ? 'multiple choice' : 'single choice'}${poll.closed ? ' · closed' : ''}`);

  const container = new ContainerBuilder().setAccentColor(poll.closed ? 0x8b8fa3 : 0x8399ff).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  if (poll.image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(poll.image)));
  }

  if (poll.closed) return { components: [container], rows: [] };

  const rows = [];
  for (let i = 0; i < poll.options.length; i += 5) {
    const row = new ActionRowBuilder();
    poll.options.slice(i, i + 5).forEach((opt, j) => {
      const idx = i + j;
      row.addComponents(new ButtonBuilder().setCustomId(`plv_vote::${poll.id}::${idx}`).setLabel(`${idx + 1}`).setEmoji(LETTERS[idx]).setStyle(ButtonStyle.Secondary));
    });
    rows.push(row);
  }
  const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`plv_close::${poll.id}`).setLabel('End poll').setStyle(ButtonStyle.Danger));
  rows.push(closeRow);

  return { components: [container], rows };
}

module.exports = { buildPollCard };
